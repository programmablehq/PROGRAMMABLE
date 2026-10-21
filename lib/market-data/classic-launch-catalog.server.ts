import "server-only";
import { unstable_cache } from "next/cache";
import { createPublicClient, formatUnits, http, keccak256, toEventSelector, type Address, type Hex, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import release from "../../config/classic-launch-catalog.v1.json";
import { canonicalTokenExploreEntryV1 } from "../explore-entry-v1";
import { getWebsiteReadOnchainDeployment } from "../onchain/config";
import { withOperationalRpcFailover } from "../onchain/operational-rpc-failover.server";
import { uerc20ReadAbi } from "../onchain/abis";
import { buildTokenLinks, sanitizeImageUrl } from "../onchain/metadata";
import { canonicalSha256 } from "../server/projection-target/hashing";
import { PROGRAMMABLE_MAIN_TOKEN_PRESENTATION } from "../programmable-main-token-presentation";
import { hasUnsafeDisplayCharacters, characterLength, MAX_TOKEN_NAME_CHARACTERS } from "../metadata-policy";
import { isValidClassicDisplaySymbol } from "./classic-launch-metadata";
import { discoverCodexLaunches, type CodexLaunchCandidate } from "../server/codex-launch-discovery";
import type { CanonicalTokenExploreEntry, LauncherToken } from "../tokens";
import { CLASSIC_MAIN_TOKEN, classicLaunchEvents, classicV2Events, parseClassicLaunchLogs, type ClassicRawLog } from "./classic-launch-proof";

export const CLASSIC_CATALOG_SOURCE = "codex-classic-launches" as const;
export const CLASSIC_CATALOG_RELEASE = canonicalSha256("programmable.classic-launch-catalog.v1", release);
type ReadOptions = { signal?: AbortSignal; deadlineMs?: number };
export type ClassicLaunchCatalogV1 = {
  source: typeof CLASSIC_CATALOG_SOURCE;
  status: "current" | "last-known-good";
  generatedAt: string;
  asOfBlock: string;
  asOfBlockHash: Hex;
  entries: readonly CanonicalTokenExploreEntry[];
  evidence: { commitment: `sha256:${string}`; releaseDigest: `sha256:${string}`; provider: "codex"; observedAt: string };
};
const fail = () => new Error("Canonical Classic launch data is unavailable");

async function withClient<T>(read: (client: PublicClient) => Promise<T>): Promise<T> {
  const deployment = getWebsiteReadOnchainDeployment("production");
  if (deployment.status !== "ready") throw fail();
  return withOperationalRpcFailover(deployment, selected => read(createPublicClient({
    chain: mainnet, transport: http(selected.rpcUrl, { batch: { batchSize: 50, wait: 5 }, retryCount: 0, timeout: 6_000 }),
  }) as PublicClient));
}

async function batches<T, R>(values: readonly T[], size: number, read: (values: readonly T[]) => Promise<R[]>): Promise<R[]> {
  const result: R[] = [];
  for (let i=0;i<values.length;i+=size) result.push(...await read(values.slice(i,i+size)));
  return result;
}

/** Cache immutable launch provenance separately from the current chain boundary. */
const hydrate = unstable_cache(async (serialized: string, metadataBucket: number) => {
  if (!Number.isSafeInteger(metadataBucket)) throw fail();
  const proofs = parseClassicLaunchLogs(JSON.parse(serialized) as ClassicRawLog[]);
  return withClient(async client => {
    const blocks = [...new Set(proofs.map(proof=>proof.launchBlockNumber!))];
    const headers = await batches(blocks, 50, batch=>Promise.all(batch.map(blockNumber=>client.getBlock({ blockNumber:BigInt(blockNumber), includeTransactions:false }))));
    const headersByNumber = new Map(headers.map(header=>[String(header.number),header]));
    const metadata = await batches(proofs, 24, async batch => {
      const results = await client.multicall({ allowFailure:true, contracts:batch.flatMap(proof=>[
        {address:proof.tokenAddress,abi:uerc20ReadAbi,functionName:"name" as const},
        {address:proof.tokenAddress,abi:uerc20ReadAbi,functionName:"symbol" as const},
        {address:proof.tokenAddress,abi:uerc20ReadAbi,functionName:"decimals" as const},
        {address:proof.tokenAddress,abi:uerc20ReadAbi,functionName:"metadata" as const},
        {address:proof.tokenAddress,abi:uerc20ReadAbi,functionName:"creator" as const},
      ]) });
      return batch.map((proof,index)=>{
        const [name,symbol,decimals,extended,creator]=results.slice(index*5,index*5+5);
        if (name?.status!=="success" || typeof name.result!=="string" || !name.result.trim()
          || hasUnsafeDisplayCharacters(name.result) || characterLength(name.result)>MAX_TOKEN_NAME_CHARACTERS
          || symbol?.status!=="success" || !isValidClassicDisplaySymbol(symbol.result)
          || decimals?.status!=="success" || typeof decimals.result!=="number" || decimals.result>36
          || creator?.status!=="success" || typeof creator.result!=="string" || creator.result.toLowerCase()!==proof.launcherAddress.toLowerCase()) throw fail();
        const header=headersByNumber.get(proof.launchBlockNumber!);
        if (!header?.hash || header.hash.toLowerCase()!==proof.launchBlockHash.toLowerCase()) throw fail();
        const values=extended?.status==="success" && Array.isArray(extended.result) ? extended.result : null;
        const {launchBlockHash,launcherAddress,custody,...identity}=proof;
        if (!launchBlockHash || !launcherAddress) throw fail();
        const initialBuyCustody: LauncherToken["initialBuyCustody"] = custody ? {
          custodyAddress:custody.address==="0x0000000000000000000000000000000000000000"?null:custody.address,
          mode:(["unlocked","fixed-lock","linear","cliff-linear"] as const)[custody.mode]!,
          durationDays:custody.durationDays,cliffDays:custody.cliffDays,configurationHash:custody.configurationHash,
          cliffTimestamp:new Date(Number(header.timestamp+BigInt(custody.mode===1?custody.durationDays:custody.mode===3?custody.cliffDays:0)*86_400n)*1000).toISOString(),
          releaseTimestamp:new Date(Number(header.timestamp+BigInt(custody.durationDays)*86_400n)*1000).toISOString(),
        }:undefined;
        return canonicalTokenExploreEntryV1({ ...identity,name:name.result,symbol:symbol.result,tokenDecimals:decimals.result,
          totalSupply:formatUnits(BigInt(proof.totalSupplyRaw!),decimals.result), launchedAt:new Date(Number(header.timestamp)*1000).toISOString(),
          ...(initialBuyCustody?{initialBuyCustody}:{}),
          ...(values ? {description:String(values[0]),imageUrl:sanitizeImageUrl(String(values[2]))??undefined,links:buildTokenLinks(String(values[1]),values[3] as Hex)}:{}),
          ...(proof.tokenAddress.toLowerCase()===CLASSIC_MAIN_TOKEN?PROGRAMMABLE_MAIN_TOKEN_PRESENTATION:{}),
        });
      });
    });
    return metadata;
  });
}, ["canonical-classic-hydration-v1",CLASSIC_CATALOG_RELEASE], {revalidate:300});

type Candidate = { poolId: string; token: string; hook: string; transaction: Hex; block: number };
const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const topics = new Set([...classicLaunchEvents, ...classicV2Events].map(event => toEventSelector(event)));
const receipts = unstable_cache(async (candidates: readonly Candidate[]) => withClient(async client => {
  const responses = await Promise.all(candidates.map(candidate => client.getTransactionReceipt({ hash: candidate.transaction })));
  return responses.flatMap((receipt, index): ClassicRawLog[] => {
    const candidate = candidates[index]!;
    const source = release.sources.find(source => source.hook === candidate.hook)!;
    if (receipt.status !== "success" || receipt.blockNumber !== BigInt(candidate.block)
      || receipt.transactionHash.toLowerCase() !== candidate.transaction) throw fail();
    const logs = receipt.logs.filter(log => log.address.toLowerCase() === source.launcher
      && topics.has(log.topics[0]!) && log.topics.some(topic => topic.toLowerCase() === `0x${candidate.token.slice(2).padStart(64, "0")}`));
    const raw = logs.map(log => ({ address: log.address, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash,
      transactionHash: receipt.transactionHash, transactionIndex: receipt.transactionIndex, logIndex: log.logIndex!,
      data: log.data, topics: [...log.topics], removed: log.removed }));
    const proofs = parseClassicLaunchLogs(raw);
    if (proofs.length !== 1 || proofs[0]!.tokenAddress.toLowerCase() !== candidate.token
      || proofs[0]!.poolId.toLowerCase() !== candidate.poolId
      || proofs[0]!.hookAddress.toLowerCase() !== candidate.hook) throw fail();
    return raw;
  });
}), ["codex-classic-receipts-v1", CLASSIC_CATALOG_RELEASE], { revalidate: 300 });

function classicCandidate(pair: CodexLaunchCandidate): Candidate | null {
  const source = release.sources.find(source => source.hook === pair.hookAddress);
  if (!source) throw fail();
  const token = pair.tokens.find(token => token.address !== weth && token.address !== "0x0000000000000000000000000000000000000000");
  if (!token || ![weth, "0x0000000000000000000000000000000000000000"].some(quote => pair.token0 === quote || pair.token1 === quote)) throw fail();
  // Retain the same historical V2 scope as the existing public catalog.
  if (source.version === "classic-v2" && token.address !== CLASSIC_MAIN_TOKEN) return null;
  if (!token.creationTransaction || token.creationBlock === null || token.creationBlock < Number(source.startBlock)) throw fail();
  return { poolId: pair.poolId, token: token.address, hook: pair.hookAddress, transaction: token.creationTransaction as Hex, block: token.creationBlock };
}

async function readCurrent(): Promise<ClassicLaunchCatalogV1> {
  const anchor = await withClient(async client => {
    const [chainId, head] = await Promise.all([client.getChainId(), client.getBlockNumber({ cacheTime: 0 })]);
    if (chainId !== 1 || head < BigInt(release.confirmations)) throw fail();
    const block = head - BigInt(release.confirmations);
    const [anchor, codes] = await Promise.all([
      client.getBlock({ blockNumber: block, includeTransactions: false }),
      Promise.all(release.sources.flatMap(source => [
        client.getCode({ address: source.launcher as Address, blockNumber: block }),
        client.getCode({ address: source.hook as Address, blockNumber: block }),
      ])),
    ]);
    if (!anchor.hash || anchor.number !== block) throw fail();
    release.sources.forEach((source, index) => {
      const launcher = codes[index*2], hook = codes[index*2+1];
      if (!launcher || !hook || keccak256(launcher) !== source.launcherRuntimeCodeHash || keccak256(hook) !== source.hookRuntimeCodeHash) throw fail();
    });
    return anchor;
  });
  const discovered = await discoverCodexLaunches(1, release.sources.map(source => source.hook), Number(anchor.timestamp));
  const observedAt = new Date().toISOString();
  const candidates = discovered.map(classicCandidate).filter((candidate): candidate is Candidate => candidate !== null);
  if (candidates.some(candidate => BigInt(candidate.block) > anchor.number)
    || new Set(candidates.map(candidate => candidate.token)).size !== candidates.length) throw fail();
  candidates.sort((a,b) => a.block-b.block || a.token.localeCompare(b.token));
  const chunks: Candidate[][] = [];
  for (let offset=0; offset<candidates.length; offset+=24) chunks.push(candidates.slice(offset,offset+24));
  const groups = await batches(chunks, 4, batch => Promise.all(batch.map(chunk => receipts(chunk))));
  const logs = groups.flat();
  parseClassicLaunchLogs(logs);
  const entries = await batches(groups, 4, async batch => (await Promise.all(batch.map(group =>
    hydrate(JSON.stringify(group), Math.floor(Date.now()/300_000))
  ))).flat());
  if (!entries.some(entry => entry.tokenAddress.toLowerCase() === CLASSIC_MAIN_TOKEN)) throw fail();
  await withClient(async client => {
    const [head, current] = await Promise.all([client.getBlockNumber({cacheTime:0}), client.getBlock({blockNumber:anchor.number,includeTransactions:false})]);
    const lag = head-anchor.number;
    if (current.hash !== anchor.hash || lag < BigInt(release.confirmations) || lag > BigInt(release.confirmations+8)) throw fail();
  });
  return { source: CLASSIC_CATALOG_SOURCE, status:"current", generatedAt:observedAt,
    asOfBlock:String(anchor.number), asOfBlockHash:anchor.hash!, entries,
    evidence:{provider:"codex",observedAt,releaseDigest:CLASSIC_CATALOG_RELEASE,commitment:canonicalSha256("programmable.codex-classic-launch-catalog-evidence.v1",{
      releaseDigest:CLASSIC_CATALOG_RELEASE, blockNumber:String(anchor.number), blockHash:anchor.hash, candidates, logs,
    })} };
}

let cached: {catalog:ClassicLaunchCatalogV1;at:number}|undefined;
let pending: Promise<ClassicLaunchCatalogV1>|undefined;
export async function readClassicLaunchCatalogV1(options:ReadOptions={}): Promise<ClassicLaunchCatalogV1> {
  if (options.signal?.aborted || options.deadlineMs!==undefined && (!Number.isFinite(options.deadlineMs)||options.deadlineMs<=Date.now())) throw fail();
  if (cached && Date.now()-cached.at<15_000) return cached.catalog;
  pending ??= readCurrent().then(catalog=>{cached={catalog,at:Date.now()};return catalog;}).finally(()=>{pending=undefined;});
  const operation=pending;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let abort:(()=>void)|undefined;
  try {
    return await Promise.race([operation,new Promise<never>((_resolve,reject)=>{
      timer=setTimeout(()=>reject(fail()),Math.max(1,Math.min(12_000,(options.deadlineMs??Date.now()+12_000)-Date.now())));
      abort=()=>reject(fail());options.signal?.addEventListener("abort",abort,{once:true});
    })]);
  } catch {
    if (!options.signal?.aborted && cached && Date.now()-cached.at<300_000) return {...cached.catalog,status:"last-known-good"};
    throw fail();
  } finally {if(timer)clearTimeout(timer);if(abort)options.signal?.removeEventListener("abort",abort);}
}
