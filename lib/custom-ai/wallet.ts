import { getAddress, toHex, type Address, type Hex } from "viem";
import { bindCustomAILaunch, type LaunchOrder } from "./launch-plan";

export type WalletProvider = { request(input: { method: string; params?: unknown[] }): Promise<unknown> };
export type LaunchJournal = {
  version: 1; order: LaunchOrder; state: "prepared" | "dispatching" | "submitted" | "rejected" | "confirmed";
  transactionHash?: Hex; updatedAt: number;
};
export type LaunchStorage = Pick<Storage, "getItem" | "setItem">;
export type CanonicalLaunchState = { state: "not-sent" | "pending" | "confirmed" | "expired" | "failed" | "conflict"; canSend: boolean };
export type WalletLock = <T>(name: string, task: () => Promise<T>) => Promise<T>;
const key = (chainId: number, account: Address) => `programmable.custom-ai.launch.v1:${chainId}:${account.toLowerCase()}`;
export const encodeLaunchValue = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? { $bigint: item.toString() } : item);
export const decodeLaunchValue = (value: string): unknown => JSON.parse(value, (_key, item) => {
  if (item && typeof item === "object" && Object.keys(item).length === 1 && typeof item.$bigint === "string") {
    if (!/^(0|[1-9][0-9]{0,77})$/.test(item.$bigint)) throw Error("The saved launch is invalid.");
    return BigInt(item.$bigint);
  }
  return item;
});

export function readLaunchJournal(storage: LaunchStorage, chainId: number, account: Address): LaunchJournal | null {
  const raw = storage.getItem(key(chainId, account));
  if (!raw) return null;
  try {
    if (raw.length > 100_000) throw Error();
    const record = decodeLaunchValue(raw) as LaunchJournal;
    if (record.version !== 1 || !["prepared", "dispatching", "submitted", "rejected", "confirmed"].includes(record.state)
      || record.order.chainId !== chainId || getAddress(record.order.account) !== getAddress(account)
      || !/^0x[0-9a-f]{64}$/i.test(record.order.planHash)
      || (record.transactionHash !== undefined && !/^0x[0-9a-f]{64}$/i.test(record.transactionHash))) throw Error();
    return record;
  } catch { throw Error("The saved launch could not be read. Keep it for recovery before starting another launch."); }
}

export function saveLaunchJournal(storage: LaunchStorage, journal: LaunchJournal) {
  const value = encodeLaunchValue(journal), activeKey = key(journal.order.chainId, journal.order.account);
  // Keep each order as well as the active pointer. Storage failure is a hard
  // stop before a wallet request; an unresolved record is never deleted.
  storage.setItem(`${activeKey}:${journal.order.planHash}`, value);
  storage.setItem(activeKey, value);
  if (storage.getItem(activeKey) !== value) throw Error("The launch could not be saved on this device.");
}

export const browserWalletLock: WalletLock = async (name, task) => {
  if (!navigator.locks) throw Error("Use a browser with Web Locks to launch safely.");
  return navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw Error("This wallet is already handling a launch in another tab.");
    return task();
  });
};

async function assertWallet(provider: WalletProvider, order: LaunchOrder) {
  const [chainId, accounts] = await Promise.all([
    provider.request({ method: "eth_chainId" }), provider.request({ method: "eth_accounts" }),
  ]);
  if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/i.test(chainId) || BigInt(chainId) !== BigInt(order.chainId)) {
    throw Error(`Switch your wallet to ${order.chainId === 1 ? "Ethereum" : "Robinhood Chain"} first.`);
  }
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || getAddress(accounts[0]) !== getAddress(order.account)) {
    throw Error("Select the wallet used to prepare this launch.");
  }
}

/** Called only by an explicit launch button. No account requests or chain changes
 * run in effects. The canonical callback must use independent server RPC reads. */
export async function sendCustomAILaunch(input: {
  order: LaunchOrder; provider: WalletProvider; storage: LaunchStorage; lock: WalletLock;
  canonical: (order: LaunchOrder, record: LaunchJournal | null) => Promise<CanonicalLaunchState>;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const candidate = structuredClone(input.order);
  return input.lock(key(candidate.chainId, candidate.account), async () => {
    const stored = readLaunchJournal(input.storage, candidate.chainId, candidate.account);
    if (stored && stored.order.planHash !== candidate.planHash && stored.state !== "confirmed" && stored.state !== "rejected") {
      throw Error("Finish checking the saved launch before starting another one.");
    }
    const prior = stored?.order.planHash === candidate.planHash ? stored : null;
    const state = await input.canonical(candidate, prior);
    if (state.state === "confirmed") {
      const record: LaunchJournal = { version: 1, order: candidate, ...prior, state: "confirmed", updatedAt: now() };
      saveLaunchJournal(input.storage, record);
      return record;
    }
    if (!state.canSend || state.state !== "not-sent" || prior && ["dispatching", "submitted", "confirmed"].includes(prior.state)) {
      throw Error("The saved launch needs a network check. Do not send it again.");
    }
    const order = await bindCustomAILaunch(candidate, BigInt(Math.floor(now() / 1000)));
    if (order.planHash !== candidate.planHash || order.transaction.data !== candidate.transaction.data) throw Error("The prepared launch changed.");
    await assertWallet(input.provider, order);
    if (BigInt(Math.floor(now() / 1000)) >= order.parameters.deadline - 5n) throw Error("Refresh the launch price before signing.");
    const record: LaunchJournal = { version: 1, order, state: "dispatching", updatedAt: now() };
    saveLaunchJournal(input.storage, record);
    try {
      const hash = await input.provider.request({ method: "eth_sendTransaction", params: [{
        from: order.account, to: order.factory, data: order.transaction.data, value: "0x0", chainId: toHex(order.chainId),
      }] });
      if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash)) throw Error("The wallet did not return a transaction hash.");
      const sent: LaunchJournal = { ...record, state: "submitted", transactionHash: hash as Hex, updatedAt: now() };
      saveLaunchJournal(input.storage, sent);
      return sent;
    } catch (error) {
      // Only the standardized explicit user rejection establishes no dispatch.
      // Timeout, disconnect, invalid response and persistence failures remain uncertain.
      if (error && typeof error === "object" && "code" in error && error.code === 4001) {
        saveLaunchJournal(input.storage, { ...record, state: "rejected", updatedAt: now() });
        throw Error("The wallet request was cancelled. Nothing was sent.");
      }
      throw Error("The wallet response is unclear. Check the saved launch before trying again.");
    }
  });
}
