import { HttpRequestError, RpcRequestError, SocketClosedError, TimeoutError } from "viem";

const RETRY_DELAYS_MS = [250, 700] as const;
const TEMPORARY_PREPARATION_ERRORS = new Set([
  "A current price for this quote token is unavailable. Try again or choose another quote token.",
  "The automatic starting price is unavailable or expired. Review again to refresh it.",
  "Current source-bound chain state is unavailable.",
  "Chain state changed during simulation. Review again.",
  "The starting price changed with chain state. Review again.",
]);
const TEMPORARY_RPC_MESSAGE = /rate.?limit|too many requests|capacity|timed? out|timeout|temporarily unavailable|upstream|gateway|header not found|block not found|busy/i;

/** Retry only read-only launch preparation. Contract reverts and wallet requests never enter this boundary. */
export function isTemporaryFoundationPreparationError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof TimeoutError || current instanceof SocketClosedError) return true;
    if (current instanceof HttpRequestError && (current.status === undefined || current.status === 408
      || current.status === 429 || current.status >= 500)) return true;
    if (current instanceof RpcRequestError && (current.code === 429 || current.code === -32_005
      || (TEMPORARY_RPC_MESSAGE.test(current.details ?? "") && !/execution reverted/i.test(current.details ?? "")))) return true;
    if (current instanceof Error && (TEMPORARY_PREPARATION_ERRORS.has(current.message)
      || (current instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(current.message)))) return true;
    current = typeof current === "object" && "cause" in current ? current.cause : undefined;
  }
  return false;
}

export async function retryFoundationReadOnlyPreparation<T>(prepare: () => Promise<T>, assertCurrent: () => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await prepare();
      assertCurrent();
      return result;
    } catch (error) {
      assertCurrent();
      if (!isTemporaryFoundationPreparationError(error)) throw error;
      if (attempt >= RETRY_DELAYS_MS.length) {
        throw new Error("The Robinhood launch checks are temporarily unavailable. Your coin details are kept. Please try again in a moment.", { cause: error });
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      assertCurrent();
    }
  }
}
