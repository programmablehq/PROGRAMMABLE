import "server-only";
import { after } from "next/server";
import { erc20Abi, keccak256, type PublicClient } from "viem";
import { CANONICAL_LAUNCH_STAMP_V1, CANONICAL_LAUNCH_STAMP_24H_V1 } from "@/lib/tokens";
import { createLaunchStampReaderV1, launchStampLaunchEvent, launchStampRouterReadAbi,
  LAUNCH_STAMP_ROUTER_INITIAL_CURSOR, LAUNCH_STAMP_POOL_MANAGER_RUNTIME_CODE_HASH } from "@/lib/alchemy/launch-stamp.server";
import { ETHEREUM_MODULE_SOURCES } from "@/lib/module-foundation/ethereum-release";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import { liveLaunchObservations, type ConfirmingLaunch } from "@/lib/confirming-launches";
import { foundationMainnetReadClient, foundationMainnetRpcs } from "./module-foundation/rpc";

const bindings = [CANONICAL_LAUNCH_STAMP_V1, CANONICAL_LAUNCH_STAMP_24H_V1] as const;
const readers = bindings.map(binding => createLaunchStampReaderV1({
  routerAddress: binding.routerAddress, routerRuntimeCodeHash: binding.routerRuntimeCodeHash,
  routerStartBlock: BigInt(binding.routerStartBlock), initialCursor: binding === CANONICAL_LAUNCH_STAMP_V1
    ? LAUNCH_STAMP_ROUTER_INITIAL_CURSOR
    : { blockNumber: "26152285", blockHash: "0x107bb00ee9e213c54edff92c851c361d4b1eb02f0ffef86bde6a68aef5cea6c8" },
}));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const json = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);
const WINDOW = 256n, MAX_LAUNCHES = 32, FRESH_MS = 30_000;
const text = (value: unknown, limit: number) => typeof value === "string" && value.trim().length > 0
  && value.length <= limit && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) ? value.trim() : null;

/** Bounded, independent receipt discovery. This intentionally returns no
 * provenance/finality object and is never used by signing or claim readers. */
export async function observeEthereumLaunches(clients: readonly PublicClient[], now = Date.now(), verified?: Map<string, ConfirmingLaunch>): Promise<ConfirmingLaunch[]> {
  if (clients.length !== 2) throw new Error("Two launch providers are required.");
  const heads = await Promise.all(clients.map(async client => {
    const [chainId, height] = await Promise.all([client.getChainId(), client.getBlockNumber({ cacheTime: 0 })]);
    if (chainId !== 1) throw new Error("Launch provider network mismatch.");
    return height;
  }));
  // Two successor blocks on both providers; the canonical 64-block rule stays intact.
  const toBlock = (heads[0] < heads[1] ? heads[0] : heads[1]) - 2n;
  const fromBlock = toBlock - WINDOW + 1n;
  const scans = await Promise.all(clients.map(async client => {
    const [checkpoint, logs] = await Promise.all([client.getBlock({ blockNumber: toBlock }),
      client.getLogs({ address: bindings.map(binding => binding.routerAddress), event: launchStampLaunchEvent,
        fromBlock, toBlock, strict: true })]);
    if (!checkpoint.hash || checkpoint.number !== toBlock || logs.length > 256) throw new Error("Invalid observation window.");
    const anchors = logs.map(log => {
      const index = bindings.findIndex(binding => same(binding.routerAddress, log.address));
      if (index < 0 || log.removed) throw new Error("Invalid launch source.");
      const anchor = readers[index].anchorFromLog(log);
      if (anchor.blockNumber < fromBlock || anchor.blockNumber > toBlock
        || anchor.blockNumber < BigInt(bindings[index].routerStartBlock)) throw new Error("Invalid launch height.");
      return { index, anchor };
    }).sort((a, b) => a.anchor.blockNumber === b.anchor.blockNumber
      ? b.anchor.logIndex - a.anchor.logIndex : a.anchor.blockNumber > b.anchor.blockNumber ? -1 : 1);
    return { hash: checkpoint.hash, anchors };
  }));
  if (json(scans[0]) !== json(scans[1])) throw new Error("Launch providers disagree.");
  const candidates = scans[0].anchors.slice(0, MAX_LAUNCHES);
  if (!candidates.length) return [];
  const active = [...new Set(candidates.map(item => item.index))];
  await Promise.all(clients.flatMap(client => [
    ...active.map(index => ({ address: bindings[index].routerAddress, hash: bindings[index].routerRuntimeCodeHash })),
    { address: CANONICAL_LAUNCH_STAMP_V1.poolManagerAddress, hash: LAUNCH_STAMP_POOL_MANAGER_RUNTIME_CODE_HASH },
  ].map(async source => {
    const code = await client.getCode({ address: source.address, blockNumber: toBlock });
    if (!code || !same(keccak256(code), source.hash)) throw new Error("Launch source runtime mismatch.");
  })));

  const output: ConfirmingLaunch[] = [];
  // Keep provider work bounded even during a launch burst.
  for (let offset = 0; offset < candidates.length; offset += 3) {
    const rows = await Promise.all(candidates.slice(offset, offset + 3).map(async ({ index, anchor }) => {
      const key = `${index}:${anchor.blockHash}:${anchor.transactionHash}:${anchor.logIndex}`;
      const cached = verified?.get(key);
      if (cached) return { ...cached, observationExpiresAt: now + FRESH_MS };
      const observations = await Promise.all(clients.map(async client => {
        const [receipt, block, stamp] = await Promise.all([
          client.getTransactionReceipt({ hash: anchor.transactionHash }),
          client.getBlock({ blockNumber: anchor.blockNumber }),
          client.readContract({ address: bindings[index].routerAddress, abi: launchStampRouterReadAbi,
            functionName: "launchStamp", args: [anchor.launchId], blockNumber: anchor.blockNumber }),
        ]);
        if (block.number !== anchor.blockNumber || !block.hash || !same(block.hash, anchor.blockHash)
          || !same(stamp.token, anchor.token) || !same(stamp.hook, anchor.hook)
          || !same(stamp.poolId, anchor.poolId) || !same(stamp.stampHash, anchor.stampHash)) {
          throw new Error("Launch observation changed.");
        }
        if (receipt.logs.some(log => log.removed)) throw new Error("Removed launch receipt.");
        const parsed = readers[index].parseLaunchStampReceipt(anchor, receipt);
        if (stamp.kind !== parsed.route.kind || !same(stamp.poolManager, anchor.poolManager)
          || !same(stamp.routePayloadHash, parsed.route.routePayloadHash)
          || !same(stamp.expectedResultHash, parsed.route.expectedResultHash)
          || !same(stamp.permitDigest, parsed.route.permitDigest)) throw new Error("Launch stamp differs from receipt.");
        return { parsed, stamp, timestamp: block.timestamp };
      }));
      if (json(observations[0]) !== json(observations[1])) throw new Error("Launch receipts disagree.");
      const { parsed, stamp, timestamp } = observations[0];
      const moduleLaunch = same(bindings[index].routerAddress, ethereum.canonicalStamp.router.address)
        && same(stamp.routeLauncher, ethereum.canonicalStamp.graphFactory.address) && parsed.components.length === 3
        && ETHEREUM_MODULE_SOURCES.some(source => anchor.blockNumber >= source.startBlock
          && parsed.components.filter(component => component.kind === 2 && same(component.runtimeCodeHash, source.proxyRuntimeCodeHash)).length === 1);
      // Optional token presentation cannot block identity discovery.
      const metadata = await Promise.race([
        Promise.allSettled(["name", "symbol", "decimals"].map(functionName => clients[0].readContract({
          address: anchor.token, abi: erc20Abi, functionName: functionName as "name" | "symbol" | "decimals",
          blockNumber: anchor.blockNumber,
        }))).then(values => values.map(value => value.status === "fulfilled" ? value.value : null)),
        new Promise<null[]>(resolve => setTimeout(() => resolve([null, null, null]), 1_000)),
      ]);
      const row = { chainId: 1, confirmation: "confirming", observationExpiresAt: now + FRESH_MS,
        category: "custom", mode: moduleLaunch ? "module" : "custom", launchId: anchor.launchId,
        tokenAddress: anchor.token, hookAddress: anchor.hook, creator: stamp.launchWallet,
        transactionHash: anchor.transactionHash, blockNumber: anchor.blockNumber.toString(), blockHash: anchor.blockHash,
        poolId: anchor.poolId, quoteAsset: same(parsed.poolKey.currency0, anchor.token) ? parsed.poolKey.currency1 : parsed.poolKey.currency0,
        launchedAt: new Date(Number(timestamp) * 1000).toISOString(), name: text(metadata[0], 128), symbol: text(metadata[1], 32),
        decimals: typeof metadata[2] === "number" && metadata[2] >= 0 && metadata[2] <= 255 ? metadata[2] : null,
      } satisfies ConfirmingLaunch;
      if (verified) {
        if (verified.size >= 128) verified.delete(verified.keys().next().value!);
        verified.set(key, row);
      }
      return row;
    }));
    output.push(...rows);
  }
  const checkpoints = await Promise.all(clients.map(client => client.getBlock({ blockNumber: toBlock })));
  if (checkpoints.some(block => !block.hash || !same(block.hash, scans[0].hash))) throw new Error("Observation window changed.");
  return output;
}

/** Keep the canonical page responsive while sustaining discovery after the response. */
export function createLaunchObservationCache(read: () => Promise<ConfirmingLaunch[]>, sustain: (work: Promise<void>) => void) {
  let current: { expires: number; value: Promise<ConfirmingLaunch[]> } | undefined;
  let previous: ConfirmingLaunch[] = [];
  return async (): Promise<ConfirmingLaunch[]> => {
    if (!current || current.expires <= Date.now()) {
      const value = read();
      const job = { expires: Number.POSITIVE_INFINITY, value };
      current = job;
      sustain(value.then(rows => { previous = rows; job.expires = Date.now() + 10_000; }, () => {
        previous = []; job.expires = Date.now() + 3_000;
      }));
    }
    const fresh = liveLaunchObservations(previous);
    if (fresh.length) return fresh;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([current.value,
        new Promise<ConfirmingLaunch[]>(resolve => { timer = setTimeout(() => resolve([]), 750); }),
      ]);
    } finally { clearTimeout(timer); }
  };
}
const verified = new Map<string, ConfirmingLaunch>();
export const readConfirmingEthereumLaunches = createLaunchObservationCache(
  async () => observeEthereumLaunches(foundationMainnetRpcs().map(foundationMainnetReadClient), Date.now(), verified),
  work => after(async () => { await work; }),
);
