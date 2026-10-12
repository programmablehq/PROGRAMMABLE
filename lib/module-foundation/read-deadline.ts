export class FoundationReadTimeoutError extends Error {
  constructor() { super("Launch checks timed out. Your coin details are saved. Try again."); }
}

/** Bound read-only work even when an RPC transport ignores cancellation. Late results cannot be reused. */
export function withFoundationReadDeadline<T>(read: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", cancel, { once: true });
  if (parent?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new FoundationReadTimeoutError()), timeoutMs);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", aborted, { once: true });
    if (controller.signal.aborted) aborted();
    try {
      controller.signal.throwIfAborted();
      void read(controller.signal).then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", aborted));
    } catch (error) {
      controller.signal.removeEventListener("abort", aborted);
      reject(error);
    }
  }).finally(() => { clearTimeout(timer); parent?.removeEventListener("abort", cancel); });
}
