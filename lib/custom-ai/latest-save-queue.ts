/** Finish the write already in flight, then save only the newest pending
 * snapshot. A slow connection must not replay every intermediate keystroke. */
export function createLatestSaveQueue() {
  let generation = 0;
  let tail = Promise.resolve();
  return {
    invalidate() { generation++; },
    enqueue(work: () => Promise<void>) {
      const current = ++generation;
      // The caller owns each failure; a failed save must not poison the queue.
      const next = tail.catch(() => undefined).then(async () => {
        if (current === generation) await work();
      });
      tail = next;
      return next;
    },
    idle() { return tail; },
  };
}
