import "server-only";
import { getAddress, type Address, type Hex } from "viem";
import { parseFoundationAvailability } from "@/lib/module-foundation/availability";
import { createFoundationClient } from "@/lib/module-foundation/client";
import {
  FOUNDATION_DISCOVERY_MAX_BLOCKS, locateFoundationCreationTransaction, readFoundationLaunchIndex,
} from "@/lib/module-foundation/discovery";
import { readFoundationAvailabilityResponse } from "./availability";

export interface FoundationLocateResponse {
  transactionHash: Hex | null;
  reason?: string;
  search?: { fromBlock: string; toBlock: string };
}
interface LocateQuery { token: Address; range: { fromBlock: bigint; toBlock: bigint } | null }
export class FoundationLocateInputError extends Error {}
const releaseUnavailable = "Launch history is temporarily unavailable while the current release is being verified.";
const historyUnavailable = "Launch history is temporarily unavailable. Please try again.";

/** Only token and an optional bounded window are accepted. Release and source authority never come from a request. */
export function parseFoundationLocateQuery(params: URLSearchParams): LocateQuery {
  for (const key of params.keys()) {
    if (!["token", "fromBlock", "toBlock"].includes(key) || params.getAll(key).length !== 1) {
      throw new FoundationLocateInputError("Use one token address and, optionally, one fromBlock and toBlock.");
    }
  }
  const raw = params.get("token");
  let token: Address;
  try {
    if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error();
    token = getAddress(raw);
    if (raw !== token || BigInt(token) === 0n) throw new Error();
  } catch { throw new FoundationLocateInputError("Enter a valid checksummed token address."); }
  const from = params.get("fromBlock"), to = params.get("toBlock");
  if (from === null && to === null) return { token, range: null };
  if (from === null || to === null || !/^(0|[1-9][0-9]{0,19})$/.test(from) || !/^(0|[1-9][0-9]{0,19})$/.test(to)) {
    throw new FoundationLocateInputError("Provide both block numbers as nonnegative decimal integers.");
  }
  const fromBlock = BigInt(from), toBlock = BigInt(to);
  if (toBlock < fromBlock || toBlock - fromBlock + 1n > FOUNDATION_DISCOVERY_MAX_BLOCKS) {
    throw new FoundationLocateInputError("Choose a range of at most 5,000 blocks.");
  }
  return { token, range: { fromBlock, toBlock } };
}

async function locate(query: LocateQuery, signal: AbortSignal): Promise<FoundationLocateResponse> {
  signal.throwIfAborted();
  let availability;
  try { availability = parseFoundationAvailability(await readFoundationAvailabilityResponse(fetch, 12_000, query.token)); }
  catch { return { transactionHash: null, reason: releaseUnavailable }; }
  const binding = availability.binding;
  if (!availability.available || !binding) return { transactionHash: null, reason: releaseUnavailable };
  signal.throwIfAborted();
  if (query.range && query.range.fromBlock < binding.startBlock) {
    throw new FoundationLocateInputError("The requested window starts before this release.");
  }
  const client = createFoundationClient();
  let latest: bigint;
  try { latest = await client.getBlockNumber({ cacheTime: 0 }); }
  catch { return { transactionHash: null, reason: historyUnavailable }; }
  signal.throwIfAborted();
  if (latest < binding.startBlock) return { transactionHash: null, reason: releaseUnavailable };
  if (query.range && query.range.toBlock > latest) throw new FoundationLocateInputError("The requested window extends beyond the current chain.");
  const toBlock = query.range?.toBlock ?? latest;
  const recentFrom = toBlock >= FOUNDATION_DISCOVERY_MAX_BLOCKS - 1n ? toBlock - FOUNDATION_DISCOVERY_MAX_BLOCKS + 1n : 0n;
  const fromBlock = query.range?.fromBlock ?? (recentFrom > binding.startBlock ? recentFrom : binding.startBlock);

  try {
    const candidate = await locateFoundationCreationTransaction(query.token, { signal });
    signal.throwIfAborted();
    if (candidate && /^0x[0-9a-fA-F]{64}$/.test(candidate) && BigInt(candidate) !== 0n) return { transactionHash: candidate };
  } catch { signal.throwIfAborted(); /* A challenged or missing explorer response never becomes authority. */ }

  const search = { fromBlock: fromBlock.toString(), toBlock: toBlock.toString() };
  try {
    // One token-indexed window, never a cursor loop or an implicit historical scan.
    const page = await readFoundationLaunchIndex({ client, binding, token: query.token, fromBlock, toBlock, pageSize: 2, signal });
    signal.throwIfAborted();
    if (page.entries.length === 1 && !page.nextCursor) return { transactionHash: page.entries[0].transactionHash, search };
    return { transactionHash: null, search, reason: page.entries.length === 0
      ? "No launch was found in this block window. You can provide its transaction hash directly."
      : "The launch history could not be resolved to one transaction." };
  } catch { return { transactionHash: null, search, reason: historyUnavailable }; }
}

/** Read-only candidate service. The caller still verifies the full transaction through discoverFoundationLaunch. */
export async function readFoundationLocateResponse(params: URLSearchParams, requestSignal?: AbortSignal): Promise<FoundationLocateResponse> {
  const query = parseFoundationLocateQuery(params);
  const controller = new AbortController();
  const cancel = () => controller.abort(requestSignal?.reason ?? new Error("Lookup cancelled."));
  requestSignal?.addEventListener("abort", cancel, { once: true });
  if (requestSignal?.aborted) cancel();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<FoundationLocateResponse>(resolve => {
    timer = setTimeout(() => {
      controller.abort(new Error("Lookup timed out."));
      resolve({ transactionHash: null, reason: historyUnavailable });
    }, 45_000);
  });
  try {
    return await Promise.race([locate(query, controller.signal).catch(error => {
      if (error instanceof FoundationLocateInputError) throw error;
      return { transactionHash: null, reason: historyUnavailable };
    }), deadline]);
  } finally {
    clearTimeout(timer);
    requestSignal?.removeEventListener("abort", cancel);
    controller.abort();
  }
}
