"use client";

import { useEffect, useRef } from "react";

/** Status reads only. Never retries a wallet send or overlaps a slow request. */
export function useLaunchStatusPolling(scope: string, enabled: boolean,
  refresh: (signal: AbortSignal) => Promise<void> | void, intervalMs = 20_000) {
  const latest = useRef(refresh);
  useEffect(() => { latest.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let active: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let nextReadAt = Date.now() + intervalMs;
    const schedule = () => { timer = setTimeout(() => void run(), Math.max(0, nextReadAt - Date.now())); };
    const run = async () => {
      if (stopped || active || document.visibilityState !== "visible") return;
      clearTimeout(timer);
      if (Date.now() < nextReadAt) { schedule(); return; }
      const controller = new AbortController(); active = controller;
      const timeout = setTimeout(() => controller.abort(), 15_000);
      let retryDelay = intervalMs;
      try { await latest.current(controller.signal); }
      catch (error) {
        // Preserve the last verified view, including across focus changes.
        const requested = error && typeof error === "object" && "retryAfterMs" in error ? error.retryAfterMs : null;
        if (typeof requested === "number" && Number.isFinite(requested)) retryDelay = Math.max(intervalMs, Math.min(3_600_000, requested));
      }
      finally {
        clearTimeout(timeout); active = null;
        nextReadAt = Date.now() + retryDelay;
        if (!stopped) schedule();
      }
    };
    const resume = () => { if (document.visibilityState === "visible") void run(); };
    schedule();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      stopped = true; clearTimeout(timer); active?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [scope, enabled, intervalMs]);
}
