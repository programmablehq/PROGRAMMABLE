import type { AISessionHeaders } from "./client";
import { aiRequest } from "./client";
import { decodeLaunchValue, encodeLaunchValue } from "./wallet";
import type { LaunchStep, StoredLaunchSession, StoredWalletSession, WalletAction } from "./launch-session";

export async function requestLaunch(headers: AISessionHeaders, input: unknown): Promise<StoredLaunchSession> {
  return requestWalletAction("launch", headers, input) as Promise<StoredLaunchSession>;
}
export async function requestWalletAction(action: WalletAction, headers: AISessionHeaders, input: unknown): Promise<StoredWalletSession> {
  return decodeLaunchValue(JSON.stringify(await aiRequest(`/${action}`, headers, input))) as StoredWalletSession;
}
const storageKey = (action: WalletAction, account: string) => `programmable.custom-ai.${action === "launch" ? "active" : "trade"}.v1:${account.toLowerCase()}`;
export function saveLocalWalletAction(action: WalletAction, saved: StoredWalletSession) {
  const key = storageKey(action,saved.session.account);
  const value = encodeLaunchValue(saved);
  localStorage.setItem(key, value);
  if (localStorage.getItem(key) !== value) throw Error("This browser could not save the launch. Keep this tab open.");
}
export function saveLocalLaunch(saved: StoredLaunchSession) { saveLocalWalletAction("launch",saved); }
export function readLocalLaunch(account: string): StoredLaunchSession | null { return readLocalWalletAction("launch",account) as StoredLaunchSession | null; }
export function readLocalWalletAction(action: WalletAction, account: string): StoredWalletSession | null {
  const value = localStorage.getItem(storageKey(action,account));
  if (!value) return null;
  if (value.length > 500_000) throw Error("The saved launch could not be read.");
  const saved = decodeLaunchValue(value) as StoredWalletSession;
  if (saved.session.account.toLowerCase() !== account.toLowerCase()) throw Error("The saved launch belongs to another wallet.");
  return saved;
}
export function sameLaunchStep(left: LaunchStep, right: LaunchStep) {
  return left.id === right.id && left.kind === right.kind && left.expiresAt === right.expiresAt
    && JSON.stringify(left.transaction) === JSON.stringify(right.transaction);
}

export function launchRequestId(account: string, payload: unknown) {
  const key = `programmable.custom-ai.request.v1:${account.toLowerCase()}`;
  const encoded = JSON.stringify(payload);
  const prior = localStorage.getItem(key);
  if (prior) {
    const saved = JSON.parse(prior);
    if (saved.payload === encoded && typeof saved.id === "string") return saved.id as string;
  }
  const value = JSON.stringify({ id: crypto.randomUUID(), payload: encoded });
  localStorage.setItem(key, value);
  if (localStorage.getItem(key) !== value) throw Error("This browser could not save your launch request.");
  return (JSON.parse(value) as { id: string }).id;
}

export function isFinishedLaunchDismissed(saved:StoredLaunchSession) {
  return saved.session.state === "confirmed" && localStorage.getItem(`programmable.custom-ai.dismissed.v1:${saved.session.account.toLowerCase()}`) === saved.session.id;
}
export function dismissFinishedLaunch(saved:StoredLaunchSession) {
  if (saved.session.state !== "confirmed") throw Error("Finish checking the saved launch first.");
  const account=saved.session.account.toLowerCase();
  localStorage.setItem(`programmable.custom-ai.completed.v1:${saved.session.id}`,encodeLaunchValue(saved));
  localStorage.setItem(`programmable.custom-ai.dismissed.v1:${account}`,saved.session.id);
  localStorage.removeItem(`programmable.custom-ai.request.v1:${account}`);
}
