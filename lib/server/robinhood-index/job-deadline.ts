/** Bound the complete job; every store operation also receives this signal so
 * a dependency settling after the response cannot publish a late checkpoint. */
export function withIndexJobDeadline<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs = 165_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Robinhood index job timed out")), timeoutMs);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", aborted, { once: true });
    void Promise.resolve().then(() => run(controller.signal)).then(resolve, reject)
      .finally(() => controller.signal.removeEventListener("abort", aborted));
  }).finally(() => clearTimeout(timer));
}
