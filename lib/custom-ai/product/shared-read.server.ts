import "server-only";

/** One bounded read with independently cancellable callers. Only the last
 * departing caller cancels the provider work; a closed tab cannot fail others. */
export function sharedProductRead<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("The read timed out.", "TimeoutError")), timeoutMs);
  let waiters = 0, settled = false;
  const promise = Promise.resolve().then(() => work(controller.signal))
    .finally(() => {settled = true; clearTimeout(timer);});
  void promise.catch(() => undefined);
  return {get aborted() {return controller.signal.aborted;}, wait(signal: AbortSignal): Promise<T> {
    signal.throwIfAborted(); waiters++;
    return new Promise<T>((resolve,reject) => {
      let done = false;
      const finish = (result: {value: T} | {error: unknown}) => {
        if (done) return; done = true; signal.removeEventListener("abort",abort); waiters--;
        if ("error" in result) reject(result.error); else resolve(result.value);
        if (!settled && waiters === 0) controller.abort(signal.reason);
      };
      const abort = () => finish({error: signal.reason});
      signal.addEventListener("abort",abort,{once:true});
      promise.then(value=>finish({value}),error=>finish({error}));
    });
  }};
}
export type SharedProductRead<T> = ReturnType<typeof sharedProductRead<T>>;
