export type SharedRead<T> = { promise: Promise<T>; release: () => void };

/** Share an in-flight read until its last observer leaves. Results belong in the caller's cache. */
export function createSharedRequestPool<T>(timeoutMs: number) {
  type Entry = { controller: AbortController; observers: number; promise: Promise<T> };
  const pending = new Map<string, Entry>();
  return (key: string, read: (signal: AbortSignal) => Promise<T>): SharedRead<T> => {
    let entry = pending.get(key);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const next: Entry = { controller, observers: 0,
        promise: Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return read(controller.signal);
        }).finally(() => {
          clearTimeout(timeout);
          if (pending.get(key) === next) pending.delete(key);
        }),
      };
      pending.set(key, next);
      entry = next;
    }
    entry.observers += 1;
    const observed = entry;
    let released = false;
    return { promise: observed.promise, release() {
      if (released) return;
      released = true;
      observed.observers -= 1;
      // React cleans up the old observer before mounting the next one. Let a
      // foreground click join its prefetch before cancelling an unused read.
      queueMicrotask(() => {
        if (observed.observers === 0 && pending.get(key) === observed) observed.controller.abort();
      });
    } };
  };
}
