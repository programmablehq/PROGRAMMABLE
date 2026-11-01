import { keccak256, type Hex } from "viem";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { errorIsExplicitWalletRejection, WalletRequestNotSubmittedError } from "@/lib/wallet-request-lock";

export type GraphWalletChain = "1" | "8453" | "999";
export type GraphWalletAction = Readonly<{ chainId: string; from: string; to: string; data: Hex; value: Hex }>;
export type GraphWalletContext = Readonly<{ requestId: string; requestHash: `sha256:${string}`; actionHash: `sha256:${string}` }>;
export type GraphWalletAttempt = GraphWalletContext & Readonly<{
  controller: string; chainId: GraphWalletChain; to: string; value: Hex; dataHash: Hex; startedAt: string; transactionHash: Hex | null;
}>;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StoredAttempt = { -readonly [K in keyof GraphWalletAttempt]: GraphWalletAttempt[K] };
type Journal = { schemaVersion: "programmable.custom-ai-graph-wallet-journal.v1"; controller: string; chainId: GraphWalletChain; attempts: StoredAttempt[] };
const PREFIX = "programmable:custom-ai-graph-wallet:v1", EVENT = "programmable:custom-ai-graph-wallet-change";
const digest = (v: unknown): v is `sha256:${string}` => typeof v === "string" && /^sha256:[a-f0-9]{64}$/u.test(v);
const address = (v: unknown): v is string => typeof v === "string" && /^0x[a-f0-9]{40}$/iu.test(v);
const hash = (v: unknown): v is Hex => typeof v === "string" && /^0x(?!0{64}$)[a-f0-9]{64}$/u.test(v);
const quantity = (v: unknown): v is Hex => typeof v === "string" && /^0x(?:0|[1-9a-f][a-f0-9]{0,63})$/u.test(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
const chain = (v: unknown): v is GraphWalletChain => v === "1" || v === "8453" || v === "999";
const bad = (): never => { throw Error("The saved wallet attempt cannot be read. Recover its original transaction before continuing."); };
const storage = () => window.localStorage;
function key(controller: string, chainId: GraphWalletChain) {
  if (!address(controller) || !chain(chainId)) return bad();
  return `${PREFIX}:${chainId}:${controller.toLowerCase()}`;
}
function actionDigest(value: { chainId: string; controller: string; to: string; value: Hex; dataHash: Hex }): `sha256:${string}` {
  return canonicalBrowserSha256V2("programmable.custom-ai-graph-wallet-action.v1", value);
}
/** Bookkeeping only. This digest cannot authorize an unreviewed transaction;
 * the existing canonical wallet codec and WalletProvider remain mandatory. */
export function graphWalletActionHash(action: GraphWalletAction): `sha256:${string}` {
  if (!chain(action.chainId) || !address(action.from) || !address(action.to) || !quantity(action.value)
    || typeof action.data !== "string" || !/^0x(?:[a-f0-9]{2})+$/iu.test(action.data)) return bad();
  return actionDigest({ chainId: action.chainId, controller: action.from.toLowerCase(), to: action.to.toLowerCase(), value: action.value, dataHash: keccak256(action.data) });
}
function read(controller: string, chainId: GraphWalletChain, store: StorageLike) {
  const raw = store.getItem(key(controller, chainId));
  if (raw === null) return { raw, journal: { schemaVersion: "programmable.custom-ai-graph-wallet-journal.v1", controller: controller.toLowerCase(), chainId, attempts: [] } as Journal };
  try {
    if (raw.length > 512_000) return bad();
    const v = JSON.parse(raw) as Journal;
    if (!v || Object.keys(v).sort().join() !== "attempts,chainId,controller,schemaVersion" || v.schemaVersion !== "programmable.custom-ai-graph-wallet-journal.v1"
      || v.controller !== controller.toLowerCase() || v.chainId !== chainId || !Array.isArray(v.attempts) || v.attempts.length > 256) return bad();
    const ids = new Set<string>(), actions = new Set<string>(); let unknown = 0;
    for (const item of v.attempts) {
      if (!item || Object.keys(item).sort().join() !== "actionHash,chainId,controller,dataHash,requestHash,requestId,startedAt,to,transactionHash,value"
        || item.controller !== v.controller || item.chainId !== chainId || !id(item.requestId) || !digest(item.requestHash) || !digest(item.actionHash)
        || !address(item.to) || item.to !== item.to.toLowerCase() || !quantity(item.value) || !hash(item.dataHash)
        || !(item.transactionHash === null || hash(item.transactionHash)) || typeof item.startedAt !== "string"
        || !Number.isFinite(Date.parse(item.startedAt)) || new Date(item.startedAt).toISOString() !== item.startedAt
        || item.actionHash !== actionDigest({ chainId, controller: v.controller, to: item.to, value: item.value, dataHash: item.dataHash })
        || ids.has(item.requestId) || actions.has(item.actionHash)) return bad();
      ids.add(item.requestId); actions.add(item.actionHash); if (item.transactionHash === null) unknown++;
    }
    if (unknown > 1) return bad();
    return { raw, journal: v };
  } catch { return bad(); }
}
function write(current: ReturnType<typeof read>, store: StorageLike) {
  const { journal } = current, location = key(journal.controller, journal.chainId), raw = journal.attempts.length ? JSON.stringify(journal) : null;
  if (store.getItem(location) !== current.raw) throw Error("The wallet recovery record changed. Check the original attempt.");
  if (raw === null) store.removeItem(location); else store.setItem(location, raw);
  if (store.getItem(location) !== raw) throw Error("The wallet recovery record could not be saved. No new transaction can be requested.");
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}
export function readGraphWalletAttempts(controller: string, chainId: GraphWalletChain, store: StorageLike = storage()): GraphWalletAttempt[] {
  return structuredClone(read(controller, chainId, store).journal.attempts);
}
/** Call inside the controller/network's exclusive wallet lock, directly before
 * the actual wallet send. An unknown send never expires out of this journal. */
export function beginGraphWalletAttempt(context: GraphWalletContext, action: GraphWalletAction, store: StorageLike = storage(), now = Date.now()): GraphWalletAttempt {
  if (!id(context.requestId) || !digest(context.requestHash) || context.actionHash !== graphWalletActionHash(action) || !chain(action.chainId)) return bad();
  const current = read(action.from, action.chainId, store), attempts = current.journal.attempts;
  if (attempts.some(item => item.transactionHash === null)) throw Error("An earlier wallet transaction needs recovery before another launch can be sent.");
  if (attempts.some(item => item.requestId === context.requestId || item.actionHash === context.actionHash)) throw Error("This launch already has a saved wallet attempt. Continue its original transaction.");
  if (attempts.length >= 256) throw Error("Reconcile the previous wallet transactions before starting another launch.");
  const attempt: StoredAttempt = { requestId: context.requestId, requestHash: context.requestHash, actionHash: context.actionHash,
    controller: action.from.toLowerCase(), chainId: action.chainId, to: action.to.toLowerCase(),
    value: action.value, dataHash: keccak256(action.data), startedAt: new Date(now).toISOString(), transactionHash: null };
  attempts.push(attempt); write(current, store); return structuredClone(attempt);
}
function selected(attempt: GraphWalletAttempt, store: StorageLike) {
  const current = read(attempt.controller, attempt.chainId, store), item = current.journal.attempts.find(value => value.requestId === attempt.requestId);
  if (!item || item.actionHash !== attempt.actionHash || item.requestHash !== attempt.requestHash || item.startedAt !== attempt.startedAt) return bad();
  return { current, item };
}
/** The normal path receives a hash only from the existing WalletProvider send.
 * A manual recovery must verify original transaction fields before using it. */
export function rememberGraphWalletHash(attempt: GraphWalletAttempt, transactionHash: Hex, store: StorageLike = storage()): GraphWalletAttempt {
  if (!hash(transactionHash)) return bad();
  const { current, item } = selected(attempt, store);
  if (item.transactionHash && item.transactionHash !== transactionHash) return bad();
  item.transactionHash = transactionHash; write(current, store); return structuredClone(item);
}
export function rejectGraphWalletAttempt(attempt: GraphWalletAttempt, error: unknown, store: StorageLike = storage()): void {
  if (!(error instanceof WalletRequestNotSubmittedError) && !errorIsExplicitWalletRejection(error)) return;
  const { current, item } = selected(attempt, store); if (item.transactionHash !== null) return;
  current.journal.attempts = current.journal.attempts.filter(value => value !== item); write(current, store);
}
export function finalizeGraphWalletAttempt(attempt: GraphWalletAttempt, proof: { requestId: string; requestHash: string; transactionHash: Hex; finality: "final" | "pending" }, store: StorageLike = storage()): void {
  if (proof.finality !== "final" || proof.requestId !== attempt.requestId || proof.requestHash !== attempt.requestHash || proof.transactionHash !== attempt.transactionHash) return;
  const { current, item } = selected(attempt, store); if (!item.transactionHash || item.transactionHash !== proof.transactionHash) return;
  current.journal.attempts = current.journal.attempts.filter(value => value !== item); write(current, store);
}
export function assertGraphWalletSendAvailable(action: GraphWalletAction, store: StorageLike = storage()): void {
  if (!chain(action.chainId)) return bad();
  const attempts = readGraphWalletAttempts(action.from, action.chainId, store), actionHash = graphWalletActionHash(action);
  if (attempts.some(item => item.transactionHash === null || item.actionHash === actionHash)) throw Error("An original launch transaction is saved. Recover or track it before sending it again.");
}
export function subscribeGraphWalletAttempts(callback: () => void): () => void {
  window.addEventListener("storage", callback); window.addEventListener(EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(EVENT, callback); };
}
