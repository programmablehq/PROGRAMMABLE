"use client";

import { useEffect, useState } from "react";
import { mergeRobinhoodPresentations, ROBINHOOD_MARKET_MAX_AGE_MS, type RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import {
  readRememberedRobinhoodPresentation,
  rememberRobinhoodPresentation,
  rememberRobinhoodTokenPresentations,
} from "@/components/robinhood-presentation-cache";

export function useRobinhoodPresentation(query: string, enabled = true, initialPresentation?: Promise<RobinhoodCoinPresentation | null>) {
  const [state, setState] = useState<{
    query: string; items: readonly RobinhoodCoinPresentation[]; loading: boolean; delayed: boolean;
  }>(() => ({
    query,
    ...(enabled ? readRememberedRobinhoodPresentation(query) : null) ?? { items: [], delayed: false },
    loading: true,
  }));

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let misses = 0;
    let items = readRememberedRobinhoodPresentation(query)?.items ?? [];
    const isVisible = () => document.visibilityState !== "hidden";
    function accept(incoming: readonly RobinhoodCoinPresentation[] | null) {
      const next = rememberRobinhoodPresentation(query, mergeRobinhoodPresentations(items, incoming));
      items = next.items;
      rememberRobinhoodTokenPresentations(items);
      setState({ query, ...next, loading: false });
      clearTimeout(expiryTimer);
      const expiries = items.flatMap(item => item.market ? [Date.parse(item.market.observedAt) + ROBINHOOD_MARKET_MAX_AGE_MS + 1] : []);
      if (expiries.length) expiryTimer = setTimeout(() => { if (!disposed) accept(items); }, Math.max(0, Math.min(...expiries) - Date.now()));
      misses = items.length && items.every(item => item.market !== null) ? 0 : misses + 1;
    }
    function schedule() {
      clearTimeout(timer);
      if (!disposed && isVisible()) timer = setTimeout(load, misses > 0 && misses <= 3 ? 5_000 : 60_000);
    }
    async function load() {
      if (disposed || controller || !isVisible()) return;
      controller = new AbortController();
      const active = controller;
      const timeout = setTimeout(() => active.abort(), 15_000);
      try {
        const response = await fetch(`/api/explore/robinhood/presentation?${query}`, {
          signal: active.signal, cache: "no-store", headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error("Presentation unavailable");
        const body = await response.json();
        if (!Array.isArray(body.items) || body.items.length > 50) throw new Error("Invalid presentation");
        if (disposed || active.signal.aborted) return;
        accept(body.items);
      } catch {
        if (!disposed && active.signal.reason !== "hidden") {
          accept(null);
        }
      } finally {
        clearTimeout(timeout);
        controller = null;
        schedule();
      }
    }
    function onVisibility() {
      clearTimeout(timer);
      if (!isVisible()) controller?.abort("hidden");
      else { accept(items); void load(); }
    }
    if (initialPresentation) {
      // React's streamed thenable is not necessarily a chainable native Promise.
      void Promise.resolve(initialPresentation).then(item => {
        if (disposed) return;
        if (item) { accept([item]); schedule(); }
        else void load();
      }).catch(() => { if (!disposed) void load(); });
    } else void load();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timer);
      clearTimeout(expiryTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, query, initialPresentation]);

  if (!enabled) return { query, items: [], loading: false, delayed: false };
  // A route or account change can reuse only its own saved presentation.
  return state.query === query ? state : {
    query,
    ...readRememberedRobinhoodPresentation(query) ?? { items: [], delayed: false },
    loading: true,
  };
}
