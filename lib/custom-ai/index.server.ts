import "server-only";
import { createHash } from "node:crypto";
import { decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeFunctionData, encodeAbiParameters, encodeEventTopics,
  keccak256, parseAbi, toHex, type Abi, type Address, type Hex } from "viem";
import bundle from "@/scripts/custom-ai/core-bundle.json";
import { bytesV1, objectV1, quantityV1, tradeBlockV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { asAddress, asHash, customAIChain, type CustomAIChain } from "./chain.server";
import { currentCustomAIDeployment, verifyCustomAIDeployment } from "./deployment.server";
import { customAIFactoryAbi, customAIPlanHash, predictCustomAIToken, type LaunchParameters } from "./launch-plan";
import { encodeLaunchValue } from "./wallet";
import { matchesRuntime } from "./runtime";
import { productionAIStore, type AIStore } from "./store.server";
import type { CustomAIPublicToken } from "./public-types";

const id = (value: string) => createHash("sha256").update(value).digest("hex");
const publicId = (chain: number, token: string) => id(`${chain}:${token.toLowerCase()}`);
type Cursor = { number: string; hash: Hex; updatedAt: string; bundleHash: string; factory: Address; status: "current" | "syncing" };
export async function finalizedCustomAIBlock(chain: CustomAIChain) {
  const tips = await Promise.all(chain.rpcs.map(async rpc => tradeBlockV1(await rpc("eth_getBlockByNumber", ["finalized",false]))));
  const height = tips.reduce((number,tip) => BigInt(tip.number) < number ? BigInt(tip.number) : number, BigInt(chain.block.number));
  return chain.agreed("eth_getBlockByNumber", [toHex(height),false], tradeBlockV1);
}

export async function syncCustomAIIndex(chainId: 1 | 4663, store: AIStore = productionAIStore()) {
  const deployment = currentCustomAIDeployment(chainId);
  if (!deployment?.deploymentBlock) return { status: "inactive" as const, added: 0 };
  const chain = await customAIChain(chainId);
  await verifyCustomAIDeployment(chain,deployment);
  const finalized = await finalizedCustomAIBlock(chain);
  const cursorId = id(`${chainId}:${deployment.factory.address}:${deployment.bundleHash}`);
  const saved = await store.readObject<Cursor>("public","index",cursorId);
  if (saved) {
    const old = await chain.agreed("eth_getBlockByNumber", [toHex(BigInt(saved.value.number)),false], tradeBlockV1);
    if (old.hash !== saved.value.hash) throw Error("Custom AI finalized index changed; investigation required");
  }
  const from = saved ? BigInt(saved.value.number)+1n : BigInt(deployment.deploymentBlock);
  if (from > BigInt(finalized.number)) {
    if (saved) await store.saveIndexBatch(cursorId,saved.revision,{...saved.value,updatedAt:new Date().toISOString(),status:"current"},[]);
    return { status: "current" as const, added: 0 };
  }
  let to = from + 499n < BigInt(finalized.number) ? from + 499n : BigInt(finalized.number);
  const factoryAbi = bundle.contracts.CustomAIFactoryV1.abi as Abi;
  const readLogs = () => chain.agreed("eth_getLogs", [{ address: deployment.factory.address, topics:encodeEventTopics({abi:factoryAbi,eventName:"Launched"}), fromBlock: toHex(from),toBlock: toHex(to) }], value => {
    if (!Array.isArray(value)) throw Error("Invalid Custom AI index response");
    return value.map(value => {
      const log = objectV1(value);
      if (log.removed || asAddress(log.address).toLowerCase() !== deployment.factory.address.toLowerCase() || !Array.isArray(log.topics)) throw Error("Invalid launch log");
      return { data: bytesV1(log.data), topics: log.topics.map(asHash) as [Hex,...Hex[]], blockNumber: quantityV1(log.blockNumber).toString(),
        blockHash: asHash(log.blockHash), transactionHash: asHash(log.transactionHash), logIndex: Number(quantityV1(log.logIndex)) };
    }).sort((a,b) => Number(BigInt(a.blockNumber)-BigInt(b.blockNumber)) || a.logIndex-b.logIndex);
  });
  let logs = await readLogs();
  while (logs.length > 100 && to > from) { to = from + (to-from)/2n; logs = await readLogs(); }
  if (logs.length > 1000) throw Error("Custom AI index block exceeds processing limit");
  const end = await chain.agreed("eth_getBlockByNumber", [toHex(to),false], tradeBlockV1);
  const tokens: CustomAIPublicToken[] = [];
  const reference = { blockHash: finalized.hash, requireCanonical: true };
  const call = async (address: Address, signature: string, args: readonly unknown[] = []) => {
    const abi = parseAbi([signature]) as Abi, functionName = signature.match(/^function (\w+)/)![1];
    return decodeFunctionResult({ abi,functionName,data: await chain.agreed("eth_call",[{to:address,data:encodeFunctionData({abi,functionName,args})},reference],bytesV1) });
  };
  for (const log of logs) {
    const decoded = decodeEventLog({ abi:factoryAbi,...log });
    if (decoded.eventName !== "Launched") continue;
    const event = decoded.args as unknown as { creator: Address; launchSalt: Hex; planHash: Hex; result: {
      token: Address; hook: Address; ledger: Address; rewardVault: Address; liquidityVault: Address; poolId: Hex; planHash: Hex } };
    const block = await chain.agreed("eth_getBlockByNumber",[toHex(BigInt(log.blockNumber)),false],tradeBlockV1);
    if (block.hash !== log.blockHash || BigInt(block.number)<from || BigInt(block.number)>to) throw Error("Launch log block mismatch");
    const tx = await chain.agreed("eth_getTransactionByHash",[log.transactionHash],value => {
      const tx = objectV1(value);
      return { from: asAddress(tx.from),to:asAddress(tx.to),data:bytesV1(tx.input),blockHash:asHash(tx.blockHash),hash:asHash(tx.hash) };
    });
    if (tx.blockHash !== block.hash || tx.hash !== log.transactionHash || tx.to.toLowerCase() !== deployment.factory.address.toLowerCase()
      || tx.from.toLowerCase() !== event.creator.toLowerCase()) throw Error("Launch transaction mismatch");
    const decodedTx = decodeFunctionData({ abi:customAIFactoryAbi,data:tx.data });
    if (decodedTx.functionName !== "launch") throw Error("Unexpected launch method");
    const parameters = decodedTx.args[0] as LaunchParameters;
    const expectedHash = customAIPlanHash(chainId,deployment.factory.address,event.creator,parameters);
    if (expectedHash !== event.planHash || event.result.planHash !== expectedHash || parameters.launchSalt !== event.launchSalt
      || predictCustomAIToken(deployment.factory.address,event.creator,parameters).toLowerCase() !== event.result.token.toLowerCase()) throw Error("Launch plan mismatch");
    const result = decodeFunctionResult({ abi:customAIFactoryAbi,functionName:"launchOf",data:await chain.agreed("eth_call",[{to:deployment.factory.address,
      data:encodeFunctionData({abi:customAIFactoryAbi,functionName:"launchOf",args:[event.creator,event.launchSalt]})},reference],bytesV1) });
    if (encodeLaunchValue(result) !== encodeLaunchValue(event.result)) throw Error("Finalized launch record mismatch");
    for (const [address,name] of [[result.token,"CustomAITokenV1"],[result.hook,"CustomAIHookV1"],[result.ledger,"CustomAIFeeLedgerV1"],
      [result.rewardVault,"CustomAIRewardVaultV1"],[result.liquidityVault,"CustomAILiquidityVaultV1"]] as const) {
      const artifact = bundle.contracts[name];
      const code = await chain.agreed("eth_getCode",[address,reference],bytesV1);
      if (!matchesRuntime(code,{...artifact,runtimeTemplate:artifact.runtimeTemplate as Hex})) throw Error("Unrecognized launched runtime");
    }
    const poolKey = { currency0: BigInt(result.token)<BigInt(parameters.quote)?result.token:parameters.quote,
      currency1: BigInt(result.token)<BigInt(parameters.quote)?parameters.quote:result.token, fee:0 as const,tickSpacing:60 as const,hooks:result.hook };
    const poolId = keccak256(encodeAbiParameters([{type:"address"},{type:"address"},{type:"uint24"},{type:"int24"},{type:"address"}],
      [poolKey.currency0,poolKey.currency1,0,60,result.hook]));
    if (poolId !== result.poolId || String(await call(result.token,"function factory() view returns (address)")).toLowerCase() !== deployment.factory.address.toLowerCase()
      || String(await call(result.hook,"function initializer() view returns (address)")).toLowerCase() !== deployment.factory.address.toLowerCase()
      || await call(result.token,"function totalSupply() view returns (uint256)") !== 10n**27n) throw Error("Launch binding mismatch");
    tokens.push({ version:1,schema:"programmable.custom-ai-launch.v1",sourceKind:"custom-ai-v1",chainId,mode:"custom",category:"custom",factory:deployment.factory.address,coreBundleHash:deployment.bundleHash,
      tokenAddress:result.token,hookAddress:result.hook,creator:event.creator,launchId:event.planHash,launchSalt:event.launchSalt,
      transactionHash:log.transactionHash,blockNumber:log.blockNumber,blockHash:log.blockHash,logIndex:log.logIndex,launchedAt:new Date(Number(block.timestamp)*1000).toISOString(),
      name:parameters.metadata.name,symbol:parameters.metadata.symbol,description:parameters.metadata.description,imageUrl:parameters.metadata.imageURI,decimals:18,
      quoteAsset:parameters.quote,quoteDecimals:parameters.quoteDecimals,poolId,poolKey,ledger:result.ledger,rewardVault:result.rewardVault,liquidityVault:result.liquidityVault,
      finalizedAt:{number:finalized.number,hash:finalized.hash} });
  }
  await chain.finish();
  if ((await chain.agreed("eth_getBlockByNumber",[toHex(to),false],tradeBlockV1)).hash !== end.hash) throw Error("Index checkpoint changed");
  await store.saveIndexBatch(cursorId,saved?.revision??0,{number:end.number,hash:end.hash,updatedAt:new Date().toISOString(),bundleHash:deployment.bundleHash,factory:deployment.factory.address,status:to === BigInt(finalized.number)?"current":"syncing"},
    tokens.map(value=>({id:publicId(chainId,value.tokenAddress),value})));
  return { status: to === BigInt(finalized.number) ? "current" as const : "syncing" as const, added:tokens.length };
}

export async function readCustomAICatalog() {
  const enabled = ([1,4663] as const).filter(chainId=>currentCustomAIDeployment(chainId)?.status === "active");
  if (!enabled.length) return { status:"inactive" as const,updatedAt:null,items:[] as CustomAIPublicToken[] };
  const store = productionAIStore();
  const cursors = await Promise.all(enabled.map(chainId=> {
    const deployment = currentCustomAIDeployment(chainId)!;
    return store.readObject<Cursor>("public","index",id(`${chainId}:${deployment.factory.address}:${deployment.bundleHash}`));
  }));
  const tokens = await store.listObjects<CustomAIPublicToken>("public","token");
  const status = cursors.some(cursor=>!cursor) ? "syncing" as const
    : cursors.some(cursor=>Date.now()-Date.parse(cursor!.value.updatedAt)>600_000) ? "stale" as const
      : cursors.some(cursor=>cursor!.value.status !== "current") ? "syncing" as const : "ready" as const;
  return { status,updatedAt:cursors.map(cursor=>cursor?.value.updatedAt).filter((value):value is string=>!!value).sort()[0]??null,items:tokens.filter(token=> enabled.includes(token.chainId)
    && currentCustomAIDeployment(token.chainId)?.factory.address.toLowerCase() === token.factory.toLowerCase()
    && currentCustomAIDeployment(token.chainId)?.bundleHash === token.coreBundleHash) };
}
export async function readCustomAIToken(chainId:1|4663,address:string, allowStaged = false) {
  const deployment = currentCustomAIDeployment(chainId);
  if (!deployment || deployment.status !== "active" && !allowStaged) return null;
  const saved = await productionAIStore().readObject<CustomAIPublicToken>("public","token",publicId(chainId,address));
  return saved?.value.factory.toLowerCase() === deployment.factory.address.toLowerCase() && saved.value.coreBundleHash === deployment.bundleHash ? saved.value : null;
}
