/** Optional usage must not poll hidden/offline tabs or overlap slow requests. */
export function passiveRefresh(read: () => Promise<unknown>, eligible: () => boolean, now = Date.now, intervalMs = 60_000) {
  let active = false, disposed = false, lastStarted = -Infinity;
  return {
    async refresh() {
      if (disposed || active || !eligible() || now() - lastStarted < intervalMs) return;
      active = true; lastStarted = now();
      try { await read(); } finally { active = false; }
    },
    dispose() { disposed = true; },
  };
}
