"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createGeneralLaunchClient, type GeneralLaunchState, type GeneralPrepareInput } from "@/lib/custom-ai/general-preparation";
import type { AISessionHeaders } from "@/lib/custom-ai/client";

export function useGeneralLaunch({ enabled, account, scope, headers }: { enabled: boolean; account: string; scope: string; headers: AISessionHeaders }) {
  const key = JSON.stringify([enabled, account.toLowerCase(), scope]);
  const initial: GeneralLaunchState = { preparation: null, phase: enabled ? "loading" : "idle", error: "", loaded: false };
  const [saved, setSaved] = useState<{ key: string; state: GeneralLaunchState }>();
  const client = useRef<{ key: string; current: ReturnType<typeof createGeneralLaunchClient> } | null>(null), headersRef = useRef(headers);
  useLayoutEffect(() => { headersRef.current = headers; }, [headers]);
  useEffect(() => {
    if (!enabled) return;
    const lifetime = new AbortController();
    const current = createGeneralLaunchClient({ account, headers: () => headersRef.current(), signal: lifetime.signal,
      update: state => { if (!lifetime.signal.aborted) setSaved({ key, state }); } });
    client.current = { key, current };
    void current.refresh(); // Owner-only GET. No prepare or submit on mount.
    return () => { lifetime.abort(); if (client.current?.current === current) client.current = null; };
  }, [key, enabled, account]);
  const state = saved?.key === key ? saved.state : initial;
  const current = () => client.current?.key === key ? client.current.current : undefined;
  return { ...state, busy: state.phase !== "idle", locked: state.phase === "preparing" || state.phase === "submitting",
    submit: (input: (signal: AbortSignal) => Promise<GeneralPrepareInput>) => current()?.submit(input),
    recover: () => current()?.recover(), refresh: () => current()?.refresh() };
}
