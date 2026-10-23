import "server-only";
import { decodeFunctionResult, encodeFunctionData, keccak256, type Hex, type Address } from "viem";
import bundle from "@/scripts/custom-ai/core-bundle.json";
import { bytesV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { currentCustomAIDeployment, verifyCustomAIDeployment, customAICanaryAccount } from "./deployment.server";
import { readCustomAIToken } from "./index.server";
import { customAIChain, type CustomAIChain } from "./chain.server";
import { customAIFactoryAbi } from "./launch-plan";
import { inspectCustomAIQuote } from "./quote.server";
import { matchesRuntime } from "./runtime";
import { readProgram } from "./program-actions.server";
import { CustomAIError } from "./types";

export async function verifiedAIMarket(chain: CustomAIChain, address: string, options: { account?: string; executionReady?: boolean } = {}) {
  const deployment = currentCustomAIDeployment(chain.chainId);
  const token = await readCustomAIToken(chain.chainId,address,customAICanaryAccount(options.account));
  if (!deployment || deployment.status !== "active" && !customAICanaryAccount(options.account) || !token) throw new CustomAIError("market", "This coin's market is not available yet.", 404);
  await verifyCustomAIDeployment(chain,deployment);
  const result = decodeFunctionResult({abi:customAIFactoryAbi,functionName:"launchOf",data:await chain.agreed("eth_call",[{
    to:deployment.factory.address,data:encodeFunctionData({abi:customAIFactoryAbi,functionName:"launchOf",args:[token.creator,token.launchSalt]})
  },chain.reference],bytesV1)});
  for (const [actual,expected] of [[result.token,token.tokenAddress],[result.hook,token.hookAddress],[result.ledger,token.ledger],
    [result.rewardVault,token.rewardVault],[result.liquidityVault,token.liquidityVault],[result.poolId,token.poolId],[result.planHash,token.launchId]]) {
    if (actual.toLowerCase() !== expected.toLowerCase()) throw Error("Custom AI market provenance changed");
  }
  for (const [address,name] of [[result.token,"CustomAITokenV1"],[result.hook,"CustomAIHookV1"],[result.ledger,"CustomAIFeeLedgerV1"],
    [result.rewardVault,"CustomAIRewardVaultV1"],[result.liquidityVault,"CustomAILiquidityVaultV1"]] as const) {
    const artifact = bundle.contracts[name];
    if (!matchesRuntime(await chain.code(address),{...artifact,runtimeTemplate:artifact.runtimeTemplate as Hex})) throw Error("Custom AI market runtime changed");
  }
  const expected = [[token.hookAddress,"token",token.tokenAddress],[token.hookAddress,"quote",token.quoteAsset],
    [token.hookAddress,"poolId",token.poolId],[token.hookAddress,"initializer",deployment.factory.address],
    [token.ledger,"additionalRecipient",token.rewardVault],[token.ledger,"hook",token.hookAddress],[token.ledger,"quote",token.quoteAsset]] as const;
  await Promise.all(expected.map(async ([address,getter,value]) => {
    const actual = await chain.call(address,`function ${getter}() view returns (${value.length===42?"address":"bytes32"})`);
    if (String(actual).toLowerCase() !== value.toLowerCase()) throw Error("Custom AI market binding changed");
  }));
  const quote = options.executionReady === false ? null : await inspectCustomAIQuote(chain.chainId,token.quoteAsset,chain,options.account as Address | undefined);
  if (quote && (quote.status !== "compatible" || quote.decimals !== token.quoteDecimals
    || String(await chain.call(token.hookAddress,"function quoteCodeHash() view returns (bytes32)")).toLowerCase() !== quote.runtimeHash)) {
    throw new CustomAIError("quote", "The pair token needs another compatibility check before trading.", 503);
  }
  const feeModule = await chain.call(token.hookAddress,"function feeModule() view returns (address)") as Address;
  const moduleHash = String(await chain.call(token.hookAddress,"function moduleCodeHash() view returns (bytes32)"));
  if (BigInt(feeModule) === 0n ? BigInt(moduleHash) !== 0n : keccak256(await chain.code(feeModule)) !== moduleHash) throw Error("Custom AI fee module changed");
  await chain.finish();
  return {token,deployment,quote};
}

export async function readAIMarketBalances(chainId:1|4663,address:string,account?:Address) {
  const chain = await customAIChain(chainId);
  const {token,deployment,quote} = await verifiedAIMarket(chain,address,{account,executionReady:false});
  const read = (address:Address,method:string) => chain.call(address,`function ${method}() view returns (uint256)`) as Promise<bigint>;
  const [platformReceived,platformClaimed,additionalReceived,additionalClaimed,totalReceived,creatorClaimed,vaultAccounted,vaultBalance,creatorRecipient,creatorShareBps] = await Promise.all([
    read(token.ledger,"platformReceived"),read(token.ledger,"platformClaimed"),read(token.ledger,"additionalReceived"),read(token.ledger,"additionalClaimed"),
    read(token.rewardVault,"totalReceived"),read(token.rewardVault,"creatorClaimed"),read(token.rewardVault,"accountedBalance"),
    chain.call(token.quoteAsset,"function balanceOf(address) view returns (uint256)",[token.rewardVault]) as Promise<bigint>,
    chain.call(token.rewardVault,"function creatorRecipient() view returns (address)") as Promise<Address>,
    chain.call(token.rewardVault,"function creatorShareBps() view returns (uint16)") as Promise<number>,
  ] as const);
  const incoming = vaultBalance > vaultAccounted ? vaultBalance-vaultAccounted : 0n;
  const additional = additionalReceived-additionalClaimed;
  const creatorAvailable = (totalReceived+incoming+additional)*BigInt(creatorShareBps)/10000n-creatorClaimed;
  const program = await readProgram(chain, token, deployment.factory.address, account);
  const balances = account ? await Promise.all([
    chain.call(token.tokenAddress,"function balanceOf(address) view returns (uint256)",[account]),
    chain.call(token.quoteAsset,"function balanceOf(address) view returns (uint256)",[account]),
    chain.agreed("eth_getBalance",[account,chain.reference],value=>BigInt(String(value)).toString()),
    chain.call(token.rewardVault,"function claimable(address) view returns (uint256)",[account]),
  ]) : null;
  await chain.finish();
  return {program,chainId,address:token.tokenAddress,router:deployment.router.address,quoteAddress:token.quoteAsset,quoteDecimals:token.quoteDecimals,
    wrappedNative:token.quoteAsset.toLowerCase() === chain.profile.wrappedEth.address.toLowerCase(),quoteNotice:quote?.message ?? (token.quoteAsset.toLowerCase() !== chain.profile.wrappedEth.address.toLowerCase() ? "The pair token may have admin rights, including freezes, upgrades or balance changes." : chainId === 4663 ? "The pair token is upgradeable, and its bridge can burn balances." : null),
    creatorRecipient,creatorAvailable:creatorAvailable.toString(),platformAvailable:(platformReceived-platformClaimed).toString(),
    balances:balances?{token:String(balances[0]),quote:String(balances[1]),native:String(balances[2]),reward:String(balances[3])}:null,
    block:{number:chain.block.number,hash:chain.block.hash},checkedAt:Date.now(),platformFeeBps:50,maximumTotalFeeBps:1500};
}
export type AIMarketBalances = Awaited<ReturnType<typeof readAIMarketBalances>>;
