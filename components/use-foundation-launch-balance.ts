"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { Address, PublicClient } from "viem";
import { FoundationLaunchBalance, FoundationLaunchBalanceError, foundationLaunchBalanceError } from "@/lib/module-foundation/launch-balance";

const unknownBalance = () => undefined;
const noSubscription = () => () => {};

export function useFoundationLaunchBalance(client: PublicClient, account: Address | undefined, chainName: string) {
  const reader = useMemo(() => account ? new FoundationLaunchBalance(() => client.getBalance({ address: account, blockTag: "latest" })) : undefined, [client, account]);
  const balance = useSyncExternalStore(reader?.subscribe ?? noSubscription, reader?.getSnapshot ?? unknownBalance, unknownBalance);

  const refresh = useCallback((force = false) => reader?.read(force) ?? Promise.resolve(undefined), [reader]);

  useEffect(() => {
    void refresh();
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    // Reuse the same short cache for empty wallets and focus/visibility events.
    // Clicking Launch still refreshes an insufficient balance immediately.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, reader]);

  const check = useCallback(async (initialBuy: string) => {
    // Recheck an insufficient balance so a deposit or reduced buy is usable immediately.
    const value = await refresh(Boolean(foundationLaunchBalanceError(reader?.getSnapshot(), initialBuy, chainName)));
    const error = foundationLaunchBalanceError(value, initialBuy, chainName);
    if (error) throw new FoundationLaunchBalanceError(error);
  }, [refresh, reader, chainName]);

  return { balance, check };
}
