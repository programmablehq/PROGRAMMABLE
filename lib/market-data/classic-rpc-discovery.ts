import { decodeEventLog, type Hex } from "viem";
import release from "../../config/classic-launch-catalog.v1.json";
import { CLASSIC_MAIN_TOKEN, classicV2Events, parseClassicLaunchLogs, type ClassicRawLog } from "./classic-launch-proof";

export const CLASSIC_RPC_LOG_WINDOW = 10_000n;
export type ClassicLaunchCandidate = { poolId: string; token: string; hook: string; transaction: Hex; block: number };
type ReadWindow = (fromBlock: bigint, toBlock: bigint) => Promise<readonly ClassicRawLog[]>;
const fail = () => new Error("Canonical Classic launch discovery is unavailable");

/** Discover known launchers directly; a market-data quota must not hide launches. */
export async function discoverClassicRpcLaunches(asOfBlock: bigint, readWindow: ReadWindow): Promise<{ candidates: ClassicLaunchCandidate[]; logs: ClassicRawLog[] }> {
  const start = BigInt(Math.min(...release.sources.map(source => source.startBlock)));
  if (asOfBlock < start || asOfBlock > BigInt(Number.MAX_SAFE_INTEGER)) throw fail();
  const windows: { from: bigint; to: bigint }[] = [];
  for (let from = start; from <= asOfBlock; from += CLASSIC_RPC_LOG_WINDOW) {
    windows.push({ from, to: from + CLASSIC_RPC_LOG_WINDOW - 1n < asOfBlock ? from + CLASSIC_RPC_LOG_WINDOW - 1n : asOfBlock });
  }
  if (windows.length > 2_000) throw fail();
  const logs: ClassicRawLog[] = [];
  for (let offset = 0; offset < windows.length; offset += 6) {
    const groups = await Promise.all(windows.slice(offset, offset + 6).map(async ({ from, to }) => {
      const result = await readWindow(from, to);
      if (result.length > 20_000 || result.some(log => !/^\d+$/.test(log.blockNumber)
        || BigInt(log.blockNumber) < from || BigInt(log.blockNumber) > to)) throw fail();
      return result;
    }));
    for (const group of groups) for (const log of group) {
      const source = release.sources.find(source => source.launcher === log.address.toLowerCase());
      if (!source) throw fail();
      // The existing public catalog includes only V4's main token from V2.
      if (source.version === "classic-v2") {
        const event = decodeEventLog({ abi: classicV2Events, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]], strict: true });
        if (String(event.args.token).toLowerCase() !== CLASSIC_MAIN_TOKEN) continue;
      }
      logs.push(log);
      if (logs.length > 20_000) throw fail();
    }
    // The provider transport budgets actual RPC calls. Cache hits must not
    // inherit a delay intended for a cold historical scan.
  }
  const candidates = parseClassicLaunchLogs(logs).map(proof => ({ poolId: proof.poolId.toLowerCase(), token: proof.tokenAddress.toLowerCase(),
    hook: proof.hookAddress.toLowerCase(), transaction: proof.launchTransactionHash! as Hex, block: Number(proof.launchBlockNumber) }));
  return { candidates, logs };
}
