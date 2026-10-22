import "server-only";
import { createHash } from "node:crypto";
import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi, toHex, type Address, type Hex } from "viem";
import { bytesV1, objectV1, quantityV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { asAddress, asHash, customAIChain, type CustomAIChain } from "./chain.server";
import { verifiedAIMarket } from "./market.server";
import { CustomAIError } from "./types";
import { initialBuyRaw } from "./preview";
import { makeStep, pendingNonce, verifiedStepReceipt } from "./transaction.server";
import { reconcileWalletStep } from "./reconcile-step.server";
import { decodeLaunchValue, encodeLaunchValue } from "./wallet";
import { readSwapFees, verifyAIClaimSettlement, verifyAISwapSettlement, type AIReceiptLog } from "./trade-settlement";
import type { AIStore } from "./store.server";
import type { LaunchStep } from "./launch-session";
import type { AITradeIntent, AITradeSession, StoredAITrade } from "./trade-types";

export const aiRouterABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
  "function swap(PoolKey key,SwapParams params,uint256 limit,uint16 maxFeeBps,address recipient,uint64 deadline) returns (uint256 paid,uint256 received)",
]);
const assetABI = parseAbi(["function approve(address,uint256) returns (bool)","function deposit() payable"]);
const claimsABI = parseAbi(["function claimAdditional() returns (uint256)","function claimCreator() returns (uint256)",
  "function claimPlatform() returns (uint256)","function claimReward(address) returns (uint256)"]);
type Market = Awaited<ReturnType<typeof verifiedAIMarket>>;
const json = (value:unknown) => JSON.parse(encodeLaunchValue(value));
export async function loadAITrade(store:AIStore,owner:string,id:string):Promise<StoredAITrade> {
  const saved = await store.readObject(owner,"trade",id);
  if (!saved) throw new CustomAIError("missing","This trade could not be found.",404);
  return {revision:saved.revision,session:decodeLaunchValue(JSON.stringify(saved.value)) as AITradeSession};
}
export async function saveAITrade(store:AIStore,owner:string,saved:StoredAITrade) {
  saved.revision=await store.saveWalletAction(owner,"trade",json(saved.session),saved.revision);
  return saved;
}
export async function createAITrade(store:AIStore,owner:string,wallets:readonly Address[],input:{id:string;account:string;chainId:number;token:string;intent:AITradeIntent;amount?:string;slippageBps?:number}) {
  if (input.chainId!==1 && input.chainId!==4663 || !["buy","sell","claim-creator","claim-platform","claim-reward"].includes(input.intent)) throw new CustomAIError("input","Choose a supported trade.");
  const account=getAddress(input.account),token=getAddress(input.token);
  if (!wallets.some(wallet=>wallet.toLowerCase()===account.toLowerCase())) throw new CustomAIError("wallet","Reconnect the selected wallet.",403);
  const amount=input.amount??"0",slippageBps=input.slippageBps??100;
  if (!Number.isSafeInteger(slippageBps) || slippageBps<1 || slippageBps>500 || !/^(0|[1-9][0-9]{0,38})(\.[0-9]{1,36})?$/.test(amount)) throw new CustomAIError("input","Check the amount and slippage.");
  const inputHash=createHash("sha256").update(JSON.stringify({account,token,chainId:input.chainId,intent:input.intent,amount,slippageBps})).digest("hex");
  const previous=await store.readObject<AITradeSession>(owner,"trade",input.id);
  if (previous) {
    if (previous.value.inputHash!==inputHash) throw new CustomAIError("conflict","This trade already has different settings.",409);
    return loadAITrade(store,owner,input.id);
  }
  const chain=await customAIChain(input.chainId),market=await verifiedAIMarket(chain,token,{account,executionReady:false});
  if (["buy","sell"].includes(input.intent) && BigInt(initialBuyRaw(amount,input.intent==="buy"?market.token.quoteDecimals:18))===0n) throw new CustomAIError("amount","Enter an amount to trade.");
  const session:AITradeSession={id:input.id,account,chainId:input.chainId,token,intent:input.intent,amount,slippageBps,inputHash,state:"preparing",steps:[]};
  await store.createLaunch(owner,input.id,json(session),`${input.chainId}:${account.toLowerCase()}`,"trade");
  return loadAITrade(store,owner,input.id);
}
export function parseAIReceiptLogs(value:unknown):AIReceiptLog[] {
  if (!Array.isArray(value)) throw Error("Missing receipt logs");
  return value.flatMap(value=> {
    const log=objectV1(value);
    if (!Array.isArray(log.topics) || log.topics.length>4 || log.removed) throw Error("Invalid receipt log");
    return log.topics.length ? [{address:asAddress(log.address),data:bytesV1(log.data),topics:log.topics.map(asHash) as [Hex,...Hex[]]}] : [];
  });
}
async function prepareSwap(chain:CustomAIChain,session:AITradeSession,market:Market) {
  await verifiedAIMarket(chain,session.token,{account:session.account});
  const {token,deployment}=market,buy=session.intent==="buy";
  const input=buy?token.quoteAsset:token.tokenAddress,output=buy?token.tokenAddress:token.quoteAsset;
  const inputDecimals=buy?token.quoteDecimals:18,outputDecimals=buy?18:token.quoteDecimals;
  const amount=BigInt(initialBuyRaw(session.amount,inputDecimals));
  if (amount===0n) throw new CustomAIError("amount","Enter an amount to trade.");
  const [balance,allowance]=await Promise.all([
    chain.call(input,"function balanceOf(address) view returns (uint256)",[session.account]) as Promise<bigint>,
    chain.call(input,"function allowance(address,address) view returns (uint256)",[session.account,deployment.router.address]) as Promise<bigint>,
  ]);
  type Call={from:Address;to:Address;data:Hex;value:Hex;gas:Hex};
  const calls:Call[]=[];
  const approval=(value:bigint):Call=>({from:session.account,to:input,data:encodeFunctionData({abi:assetABI,functionName:"approve",args:[deployment.router.address,value]}),value:"0x0",gas:"0x7a120"});
  if (balance<amount) {
    if (!buy || input.toLowerCase()!==chain.profile.wrappedEth.address.toLowerCase()) throw new CustomAIError("balance","Your wallet does not have enough tokens for this trade.",422);
    const native=BigInt(await chain.agreed("eth_getBalance",[session.account,chain.reference],value=>quantityV1(value).toString()));
    if (native<=amount-balance) throw new CustomAIError("balance","Your wallet needs enough ETH for this trade and network fees.",422);
    calls.push({from:session.account,to:input,data:encodeFunctionData({abi:assetABI,functionName:"deposit"}),value:toHex(amount-balance),gas:"0x7a120"});
  }
  if (allowance<amount) { if (allowance) calls.push(approval(0n)); calls.push(approval(amount)); }
  const zeroForOne=token.poolKey.currency0.toLowerCase()===input.toLowerCase();
  const params={zeroForOne,amountSpecified:-amount,sqrtPriceLimitX96:zeroForOne?4295128740n:1461446703485210103287273052203988822378723970341n};
  const expiresAt=Math.min(Math.floor(Date.now()/1000)+120,Number(chain.block.timestamp)+120);
  const swap=(minimum:bigint):Call=>({from:session.account,to:deployment.router.address,value:"0x0",gas:"0x7a1200",
    data:encodeFunctionData({abi:aiRouterABI,functionName:"swap",args:[token.poolKey,params,minimum,1500,session.account,BigInt(expiresAt)]})});
  const simulation=await chain.agreed("eth_simulateV1",[{blockStateCalls:[{calls:[...calls,swap(1n)]}],validation:false,traceTransfers:false},toHex(BigInt(chain.block.number))],value=> {
    if (!Array.isArray(value) || value.length!==1) throw Error("Incomplete trade simulation");
    const results=objectV1(value[0]).calls;
    if (!Array.isArray(results) || results.length!==calls.length+1) throw Error("Incomplete trade simulation");
    const parsed=results.map(objectV1);
    if (parsed.some(call=>quantityV1(call.status)!==1n || call.error)) throw new CustomAIError("liquidity","This amount could not be traded at the current price. Try a smaller amount.",422);
    const last=parsed.at(-1)!;
    return {data:bytesV1(last.returnData),logs:parseAIReceiptLogs(last.logs)};
  });
  const [paid,received]=decodeFunctionResult({abi:aiRouterABI,functionName:"swap",data:simulation.data});
  if (paid!==amount || received<=0n) throw Error("Unexpected simulated swap amount");
  const fees=readSwapFees(simulation.logs,token,deployment.router.address,buy);
  const minimum=received*BigInt(10000-session.slippageBps)/10000n;
  if (!minimum) throw new CustomAIError("amount","This amount is too small to trade.",422);
  session.quote={input,output,amount:amount.toString(),expected:received.toString(),minimum:minimum.toString(),inputDecimals,outputDecimals,
    platform:fees.platformQuote.toString(),additional:fees.additionalQuote.toString(),expiresAt,blockHash:chain.block.hash};
  const next=calls[0]??swap(minimum);
  const kind:LaunchStep["kind"]=next.to===deployment.router.address?"swap":BigInt(next.value)>0n?"wrap":allowance>0n?"reset-approval":"approve";
  return {...await makeStep(chain,session,kind,next.to,next.data,BigInt(next.value),expiresAt),tradeQuote:session.quote};
}
async function prepareClaim(chain:CustomAIChain,session:AITradeSession,market:Market) {
  const token=market.token;
  if (session.intent==="claim-creator" && !session.steps.some(step=>step.kind==="collect-fees" && step.state==="confirmed")) {
    const received=await chain.call(token.ledger,"function additionalReceived() view returns (uint256)") as bigint;
    const claimed=await chain.call(token.ledger,"function additionalClaimed() view returns (uint256)") as bigint;
    if (received>claimed) return makeStep(chain,session,"collect-fees",token.ledger,encodeFunctionData({abi:claimsABI,functionName:"claimAdditional"}));
  }
  const kind=session.intent as "claim-creator"|"claim-platform"|"claim-reward";
  const target=kind==="claim-platform"?token.ledger:token.rewardVault;
  const data=kind==="claim-reward"?encodeFunctionData({abi:claimsABI,functionName:"claimReward",args:[session.account]}):
    encodeFunctionData({abi:claimsABI,functionName:kind==="claim-platform"?"claimPlatform":"claimCreator"});
  const amount=await chain.agreed("eth_call",[{from:session.account,to:target,data},chain.reference],bytesV1);
  if (amount.length!==66 || BigInt(amount)===0n) throw new CustomAIError("empty","There are no fees ready to claim.",422);
  return makeStep(chain,session,kind,target,data);
}
export async function advanceAITrade(store:AIStore,owner:string,saved:StoredAITrade) {
  const session=saved.session;
  if (["confirmed","failed"].includes(session.state)) return saved;
  const chain=await customAIChain(session.chainId),market=await verifiedAIMarket(chain,session.token,{account:session.account,executionReady:false});
  if (await reconcileWalletStep(chain,session)) {
    const recovered=session.steps.at(-1);
    if (recovered?.tradeQuote) session.quote=recovered.tradeQuote;
    saved=await saveAITrade(store,owner,saved);
    if (session.state==="failed") return saved;
  }
  const last=session.steps.at(-1);
  if (last?.state==="dispatching" && !last.hash) {
    last.state="prepared";session.state="ready";
    saved=await saveAITrade(store,owner,saved);
  }
  if (last && ["dispatching","submitted"].includes(last.state)) {
    const verified=await verifiedStepReceipt(chain,last);
    const state=verified.state;
    if (state==="pending") {session.state="waiting";return saved;}
    last.state=state;
    if (state==="failed") {session.state="failed";return saveAITrade(store,owner,saved);}
    if (["swap","collect-fees","claim-creator","claim-platform","claim-reward"].includes(last.kind)) {
      if (!verified.receipt) throw Error("Missing validated transaction receipt");
      const receipt = { logs: parseAIReceiptLogs(verified.receipt.logs), blockNumber: verified.receipt.block, blockHash: verified.receipt.blockHash };
      if (last.kind === "swap") session.settlement={...verifyAISwapSettlement(receipt.logs,session,market.token,market.deployment.router.address),
          blockNumber:receipt.blockNumber,blockHash:receipt.blockHash};
      else {
        const creator=await chain.call(market.token.rewardVault,"function creatorRecipient() view returns (address)") as Address;
        session.claimSettlement={...verifyAIClaimSettlement(receipt.logs,last.kind,market.token,session.account,creator),
          blockNumber:receipt.blockNumber,blockHash:receipt.blockHash};
      }
    }
    await chain.finish();
    if (["swap","claim-creator","claim-platform","claim-reward"].includes(last.kind)) session.state="confirmed";
    saved=await saveAITrade(store,owner,saved);
    if (session.state==="confirmed") return saved;
  }
  if (last?.state==="prepared" && last.expiresAt>Math.floor(Date.now()/1000)+10) return saved;
  const step=await (["buy","sell"].includes(session.intent)?prepareSwap(chain,session,market):prepareClaim(chain,session,market));
  if (last?.state==="prepared") last.state="rejected";
  session.steps.push(step);session.state="ready";
  return saveAITrade(store,owner,saved);
}
export async function dispatchAITrade(store:AIStore,owner:string,saved:StoredAITrade,stepId:string) {
  const step=saved.session.steps.at(-1);
  if (!step || step.id!==stepId || step.state!=="prepared" || step.expiresAt<=Math.floor(Date.now()/1000)+5) throw new CustomAIError("step","Refresh this trade before opening your wallet.",409);
  const chain=await customAIChain(saved.session.chainId);
  await verifiedAIMarket(chain,saved.session.token,{account:saved.session.account,executionReady:["buy","sell"].includes(saved.session.intent)});
  if (await pendingNonce(chain,saved.session.account)!==BigInt(step.transaction.nonce)) throw new CustomAIError("nonce","Your wallet changed. Refresh this trade.",409);
  const gas=await Promise.all(chain.rpcs.map(async rpc=>quantityV1(await rpc("eth_estimateGas",[{...step.transaction,chainId:toHex(chain.chainId)}]))));
  if (gas.some(value=>value>BigInt(step.transaction.gas))) throw new CustomAIError("gas","Refresh the trade before signing.",409);
  await chain.finish();
  step.state="dispatching";step.walletRejected=false;step.dispatchedAt??=Date.now();saved.session.state="waiting";
  return saveAITrade(store,owner,saved);
}
