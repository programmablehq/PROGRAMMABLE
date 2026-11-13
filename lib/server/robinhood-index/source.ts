import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { createPublicClient, decodeEventLog, erc20Abi, http, keccak256, toHex, zeroAddress,
  type Abi, type Address, type Hex } from "viem";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import { IndexBlockIncomplete, IndexRangeTooWide, type IndexSource } from "./sync";
import { verifyLaunchStampWithViem } from "./verify-launch-stamp";

const DISCOVERY = "https://developers.programmable.family/.well-known/programmable.json";
// The read endpoint used by the Developer integration example supports the
// finalized historical reads needed here. Operators may supply their own RPC.
const DEFAULT_RPC = "https://rpc-robinhood.blockmachine.io";
const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const requireMatch = (condition: unknown) => { if (!condition) throw new Error("Robinhood stamp verification failed"); };
const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Developer response");
  return value as Record<string, unknown>;
};
const hash = (value: unknown): Hex => {
  if (typeof value !== "string" || !/^0x[\da-f]{64}$/i.test(value) || /^0x0{64}$/i.test(value)) throw new Error("Invalid hash");
  return value as Hex;
};
const address = (value: unknown): Address => {
  if (typeof value !== "string" || !/^0x[\da-f]{40}$/i.test(value) || same(value, zeroAddress)) throw new Error("Invalid address");
  return value as Address;
};
const blockNumber = (value: unknown) => {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,19})$/.test(value)) throw new Error("Invalid block");
  return BigInt(value);
};

async function developerText(value: unknown) {
  const url = new URL(String(value));
  requireMatch(url.origin === "https://developers.programmable.family" && !url.username && !url.password);
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error("Developer discovery unavailable");
  const text = await response.text();
  if (Buffer.byteLength(text) > 1_000_000) throw new Error("Developer response too large");
  return text;
}

let schemaValidator: ReturnType<Ajv2020["compileAsync"]> | undefined;
async function validateManifest(manifest: Record<string, unknown>) {
  const schemaUrl = "https://developers.programmable.family/schemas/v2/manifest.schema.json";
  requireMatch(manifest.$schema === schemaUrl);
  if (!schemaValidator) {
    const ajv = new Ajv2020({ strict: false, loadSchema: async (uri) => {
      requireMatch(uri.startsWith("https://developers.programmable.family/schemas/v2/"));
      return JSON.parse(await developerText(uri));
    } });
    addFormats(ajv);
    schemaValidator = ajv.compileAsync(JSON.parse(await developerText(schemaUrl))).catch((error) => {
      schemaValidator = undefined;
      throw error;
    });
  }
  requireMatch((await schemaValidator)(manifest));
}

export async function robinhoodSource(rpcUrl = process.env.ROBINHOOD_RPC_URL?.trim() || DEFAULT_RPC, signal?: AbortSignal): Promise<IndexSource> {
  signal?.throwIfAborted();
  const url = new URL(rpcUrl);
  requireMatch(url.protocol === "https:" && !url.username && !url.password);
  const discovery = asObject(JSON.parse(await developerText(DISCOVERY)));
  const chain = Array.isArray(discovery.chains) ? discovery.chains.map(asObject).find((value) => value.chainId === 4663) : null;
  requireMatch(chain);
  const manifest = asObject(JSON.parse(await developerText(chain?.manifestUrl)));
  await validateManifest(manifest);
  requireMatch(manifest.chainId === 4663 && manifest.caip2 === "eip155:4663");
  const router = asObject(manifest.launchStampRouter);
  requireMatch(router.status === "live");
  const routerAddress = address(router.address);
  const startBlock = blockNumber(router.startBlock);
  const abiText = await developerText(router.abiUrl);
  requireMatch(`sha256:${createHash("sha256").update(abiText).digest("hex")}` === router.abiSha256);
  const abi = JSON.parse(abiText) as Abi;
  requireMatch(Array.isArray(abi));
  const events = Object.values(asObject(router.events)).map((value) => hash(asObject(value).topic0));
  requireMatch(events.length === 3);
  // One modest request stream, shared with point verification and metadata reads.
  // No provider fallback cascade; a failed range resumes on the next scheduled run.
  let nextRequestAt = 0;
  const rpcFetch: typeof fetch = async (input, init) => {
    signal?.throwIfAborted();
    const requestSignal = signal ? AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) : init?.signal;
    const at = Math.max(Date.now(), nextRequestAt);
    nextRequestAt = at + 350;
    await wait(Math.max(0, at - Date.now()), undefined, { signal: requestSignal ?? undefined });
    return fetch(input, { ...init, signal: requestSignal });
  };
  const client = createPublicClient({ transport: http(rpcUrl, { fetchFn: rpcFetch, timeout: 8_000, retryCount: 0 }) });
  requireMatch(await client.getChainId() === 4663);
  const final = await client.getBlock({ blockTag: "finalized" });
  requireMatch(final.number >= startBlock && final.hash);
  // Validate the canonical Router and its published getter/event descriptors once
  // per pass. Each launch below then uses those bound getters at this same block.
  const root = await verifyLaunchStampWithViem({ chainId: 4663, rpcUrl, rpcFetch,
    query: { kind: "token", address: zeroAddress }, block: final.number });
  requireMatch(root.state === "not-stamped" && "router" in root && same(root.router, routerAddress)
    && "blockHash" in root && same(root.blockHash, final.hash));
  const deployment = asObject(router.deploymentEvidence);
  const canary = asObject(router.canaryEvidence);
  const [deploymentReceipt, canaryReceipt] = await Promise.all([
    client.getTransactionReceipt({ hash: hash(deployment.deploymentTransactionHash) }),
    client.getTransactionReceipt({ hash: hash(canary.transactionHash) }),
  ]);
  for (const [receipt, number, blockHash] of [
    [deploymentReceipt, deployment.deploymentBlockNumber, deployment.deploymentBlockHash],
    [canaryReceipt, canary.blockNumber, canary.blockHash],
  ] as const) {
    requireMatch(receipt.status === "success" && receipt.blockNumber === blockNumber(number)
      && same(receipt.blockHash, blockHash) && receipt.blockNumber <= final.number);
    requireMatch(same((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, blockHash));
  }
  const canaryLaunches = canaryReceipt.logs.filter((log) => same(log.address, routerAddress)
    && same(log.topics[0], asObject(asObject(router.events).launchStamped).topic0)
    && same(log.topics[1], canary.launchId));
  requireMatch(canaryLaunches.length === 1);

  const read = (functionName: string, args: readonly unknown[]) => client.readContract({
    address: routerAddress, abi, functionName, args, blockNumber: final.number,
  });
  const block = async (number: bigint) => {
    const value = await client.getBlock({ blockNumber: number });
    requireMatch(value.number === number && value.hash);
    return { number: number.toString(), hash: value.hash };
  };
  type Event = { name: string; args: Record<string, unknown>; transactionHash: Hex; blockHash: Hex; blockNumber: bigint; logIndex: number };

  async function hydrate(launch: Event, related: Event[]): Promise<RobinhoodLaunch> {
    const launchId = hash(launch.args.launchId);
    const tokenAddress = address(launch.args.token);
    const hookAddress = address(launch.args.hook);
    const record = asObject(await read("launchStamp", [launchId]));
    requireMatch(Number(record.kind) === 1);
    for (const field of ["poolId", "poolKeyHash", "componentSetHash", "routePayloadHash",
      "routeLauncherRuntimeCodeHash", "expectedResultHash", "permitDigest", "stampHash"]) hash(record[field]);
    const bindings = asObject(router.bindings);
    requireMatch(same(record.poolManager, bindings.poolManager) && same(record.routeLauncher, bindings.graphFactory)
      && same(record.routeLauncherRuntimeCodeHash, bindings.graphFactoryRuntimeCodeHash));
    for (const key of ["token", "hook", "poolManager", "poolId", "stampHash"]) requireMatch(same(record[key], launch.args[key]));
    const routes = related.filter((row) => row.name === "ProgrammableLaunchRouteStampedV1");
    requireMatch(routes.length === 1 && Number(routes[0].args.kind) === 1);
    for (const key of ["routePayloadHash", "expectedResultHash", "permitDigest"]) requireMatch(same(record[key], routes[0].args[key]));
    const [tokenLaunchId, poolLaunchId, tokenProof, hookProof, tokenRuntime, hookRuntime, launchedBlock] = await Promise.all([
      read("launchIdByToken", [tokenAddress]),
      read("launchIdByPool", [record.poolManager, record.poolId]), read("stampProof", [tokenAddress]),
      read("stampProof", [hookAddress]), read("componentRuntimeCodeHash", [tokenAddress]),
      read("componentRuntimeCodeHash", [hookAddress]),
      client.getBlock({ blockNumber: launch.blockNumber }),
    ]);
    requireMatch(same(tokenLaunchId, launchId) && same(poolLaunchId, launchId) && same(launchedBlock.hash, launch.blockHash));
    for (const proof of [tokenProof, hookProof]) requireMatch(Array.isArray(proof)
      && same(proof[0], launchId) && same(proof[1], record.stampHash));
    // Recorded code hashes establish launch evidence. Current proxy/runtime changes
    // must not erase a valid historical origin stamp.
    hash(tokenRuntime);
    hash(hookRuntime);
    for (const [component, kind, runtime] of [[tokenAddress, 1, tokenRuntime],
      [hookAddress, 2, hookRuntime]] as const) {
      const evidence = related.filter((row) => row.name === "ProgrammableComponentStampedV1" && same(row.args.component, component));
      requireMatch(evidence.length === 1 && Number(evidence[0].args.kind) === kind && same(evidence[0].args.runtimeCodeHash, runtime));
    }
    // ERC-20 metadata is presentation only. Reverts and nonstandard tokens still list.
    const metadata = await Promise.allSettled((["name", "symbol", "decimals"] as const).map((functionName) =>
      client.readContract({ address: tokenAddress, abi: erc20Abi, functionName, blockNumber: final.number })));
    const text = (index: number) => {
      const result = metadata[index];
      return result.status === "fulfilled" && typeof result.value === "string"
        ? result.value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 128) || null : null;
    };
    const decimals = metadata[2].status === "fulfilled" ? Number(metadata[2].value) : NaN;
    return {
      routerAddress, launchId, tokenAddress, hookAddress, creator: address(record.launchWallet),
      poolManager: address(record.poolManager), poolId: hash(record.poolId), stampHash: hash(record.stampHash),
      transactionHash: launch.transactionHash, blockHash: launch.blockHash, blockNumber: launch.blockNumber.toString(), logIndex: launch.logIndex,
      launchedAt: new Date(Number(launchedBlock.timestamp) * 1000).toISOString(), name: text(0), symbol: text(1),
      decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : null,
    };
  }

  return {
    routerAddress, startBlock, binding: keccak256(toHex(JSON.stringify([routerAddress.toLowerCase(), router.startBlock, router.runtimeCodeHash, router.abiSha256, router.bindings]))),
    finalized: { number: final.number.toString(), hash: final.hash }, block,
    async launches(from, to, known) {
      const raw = await client.request({ method: "eth_getLogs", params: [{ address: routerAddress,
        fromBlock: toHex(from), toBlock: toHex(to), topics: [events] }] }).catch((error: unknown) => {
        if (from < to && error instanceof Error && /block range|too many results|response size/i.test(error.message)) {
          throw new IndexRangeTooWide();
        }
        throw error;
      });
      if (raw.length >= 10_000) throw new IndexRangeTooWide();
      const seen = new Set<string>();
      const decoded: Event[] = raw.map((log) => {
        requireMatch(same(log.address, routerAddress) && !log.removed && log.blockNumber && log.blockHash && log.transactionHash && log.logIndex);
        const number = BigInt(log.blockNumber!);
        const index = Number(BigInt(log.logIndex!));
        requireMatch(number >= from && number <= to && Number.isSafeInteger(index));
        const identity = `${log.blockHash}:${index}`;
        requireMatch(!seen.has(identity));
        seen.add(identity);
        const event = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true });
        requireMatch(typeof event.eventName === "string");
        return { name: String(event.eventName), args: asObject(event.args), transactionHash: hash(log.transactionHash),
          blockHash: hash(log.blockHash), blockNumber: number, logIndex: index };
      });
      const launches = decoded.filter((row) => row.name === "ProgrammableLaunchStampedV1");
      const existingLaunch = (launch: Event) => known.find((row) => same(row.launchId, launch.args.launchId)
        && same(row.blockHash, launch.blockHash) && row.logIndex === launch.logIndex);
      if (from < to && launches.filter((launch) => !existingLaunch(launch)).length > 3) throw new IndexRangeTooWide();
      // Every correlated event must have its final launch in this same transaction.
      for (const row of decoded) requireMatch(launches.some((launch) => same(launch.args.launchId, row.args.launchId)
        && same(launch.transactionHash, row.transactionHash) && same(launch.blockHash, row.blockHash)));
      const rows: RobinhoodLaunch[] = [];
      let verified = 0;
      for (const launch of launches) {
        const existing = existingLaunch(launch);
        if (existing) rows.push(existing);
        else {
          if (verified >= 3) throw new IndexBlockIncomplete(rows);
          rows.push(await hydrate(launch, decoded.filter((row) => same(row.args.launchId, launch.args.launchId)
            && same(row.transactionHash, launch.transactionHash) && same(row.blockHash, launch.blockHash))));
          verified += 1;
        }
      }
      return rows;
    },
  };
}
