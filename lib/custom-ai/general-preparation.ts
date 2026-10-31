import { aiRequest, type AISessionHeaders } from "./client";
import type { BuilderChainId } from "./execution-routing";
import { parseCoinSetupPatch, type CoinSetup } from "./coin-setup";

export type GeneralExchangeView = {
  state: "sending" | "unknown" | "rejected" | "completed";
  httpStatus?: number; code?: string; disposition?: string; findingCodes?: string[];
  resourceId?: string; backendState?: string;
};
/** Owner-only journal facts. These are neither a live lifecycle query nor
 * authorization to sign, broadcast, or call a wallet. */
export type GeneralPreparationView = {
  version: 1; id: string; account: string; chainId: BuilderChainId;
  sourceId: string; conversationId: string; coin?: { name: string; symbol: string };
  editor?: { settings: CoinSetup; imageId: string };
  projectHash: `sha256:${string}`; artifactHash: `sha256:${string}`;
  packState: "packing" | "interrupted" | "failed" | "complete";
  code?: string; requestHash?: `sha256:${string}`;
  createdAt: number; updatedAt: number; expiresAt: number;
  preflight?: GeneralExchangeView; submission?: GeneralExchangeView; launchReady: false;
};
export type GeneralPrepareSelection = {
  id: string; account: string; conversation: string; studioRevision: number; chainId: BuilderChainId;
  projectHash: `sha256:${string}`; artifactHash: `sha256:${string}`; intentRevision: string;
};
export type GeneralPrepareInput = { selection: GeneralPrepareSelection; controllerKind?: "eoa" };
export type GeneralLaunchStatus = {
  schemaVersion: "programmable.wallet-launch-status.v1"; kind: "graph-v3" | "plan-v1";
  chainId: "1" | "4663" | "8453" | "999"; resourceId: string; controller: string;
  requestHash: `sha256:${string}`; rawRequestSha256: `sha256:${string}` | null;
  status: string; errorCode: string | null; createdAt: string; updatedAt: string; checkedAt: string;
  deadline: string | null; launchReady: false;
};
export type GeneralStatusBinding = { account: string; chainId: BuilderChainId; resourceId: string;
  requestHash: string; rawRequestSha256?: string; deadline: string };
export type GeneralLaunchState = {
  preparation: GeneralPreparationView | null;
  phase: "loading" | "idle" | "preparing" | "submitting" | "checking";
  error: string; loaded: boolean; unconfirmedId?: string; currentStatus?: GeneralLaunchStatus; statusError?: string;
};
const identifier = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9-]{16,64}$/u.test(v);
const hash = (v: unknown): v is `sha256:${string}` => typeof v === "string" && /^sha256:[a-f0-9]{64}$/u.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(v);
const text = (v: unknown, max = 128): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const invalid = (): never => { throw Error("The saved submission could not be matched to this wallet. Check it again before continuing."); };
const exactKeys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(key => allowed.includes(key));
export function readGeneralLaunchStatus(value: unknown, binding: GeneralStatusBinding): GeneralLaunchStatus {
  const bad = (): never => { throw Error("The current launch status could not be matched to the original submission."); };
  if (!object(value) || !exactKeys(value, ["status"]) || !object(value.status)) return bad();
  const v = value.status;
  const date = (item: unknown): item is string => typeof item === "string" && Number.isFinite(Date.parse(item)) && new Date(item).toISOString() === item;
  if (!exactKeys(v, ["schemaVersion", "kind", "chainId", "resourceId", "controller", "requestHash", "rawRequestSha256", "status", "errorCode",
    "createdAt", "updatedAt", "checkedAt", "deadline", "launchReady"]) || v.schemaVersion !== "programmable.wallet-launch-status.v1"
    || v.kind !== (binding.chainId === 4663 ? "plan-v1" : "graph-v3") || v.chainId !== String(binding.chainId) || !uuid(v.resourceId) || v.resourceId !== binding.resourceId
    || typeof v.controller !== "string" || !/^0x[a-f0-9]{40}$/iu.test(v.controller) || v.controller.toLowerCase() !== binding.account.toLowerCase()
    || !hash(v.requestHash) || v.requestHash !== binding.requestHash || typeof v.deadline !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/u.test(v.deadline)
    || BigInt(v.deadline) >= 2n ** 64n || v.deadline !== binding.deadline || v.launchReady !== false
    || (binding.chainId === 4663 ? !hash(v.rawRequestSha256) || binding.rawRequestSha256 !== undefined && v.rawRequestSha256 !== binding.rawRequestSha256 : v.rawRequestSha256 !== null)
    || typeof v.status !== "string" || !/^[a-z][a-z0-9_]{0,63}$/u.test(v.status)
    || v.errorCode !== null && (typeof v.errorCode !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(v.errorCode))
    || !date(v.createdAt) || !date(v.updatedAt) || !date(v.checkedAt) || Date.parse(v.updatedAt) < Date.parse(v.createdAt)) return bad();
  return structuredClone(v) as GeneralLaunchStatus;
}
function exchange(value: unknown): GeneralExchangeView {
  if (!object(value) || !exactKeys(value, ["state", "httpStatus", "code", "disposition", "findingCodes", "resourceId", "backendState"])
    || !["sending", "unknown", "rejected", "completed"].includes(String(value.state))
    || value.httpStatus !== undefined && (!Number.isInteger(value.httpStatus) || Number(value.httpStatus) < 100 || Number(value.httpStatus) > 599)
    || ["code", "disposition", "backendState"].some(key => value[key] !== undefined && !text(value[key]))
    || value.resourceId !== undefined && !uuid(value.resourceId)
    || value.findingCodes !== undefined && (!Array.isArray(value.findingCodes) || value.findingCodes.length > 256
      || value.findingCodes.some(code => !text(code) || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(code)))) return invalid();
  return structuredClone(value) as GeneralExchangeView;
}
function readEditor(value: unknown, chainId: unknown): GeneralPreparationView["editor"] {
  if (!object(value) || !exactKeys(value, ["settings", "imageId"]) || typeof value.imageId !== "string" || !/^[a-f0-9]{64}$/u.test(value.imageId)
    || !object(value.settings)) return invalid();
  const settings = value.settings;
  if (!exactKeys(settings, ["name", "symbol", "chainId", "pairToken", "initialBuy", "description", "website", "x"])
    || settings.chainId !== chainId || ["name", "symbol", "pairToken", "initialBuy"].some(key => typeof settings[key] !== "string")) return invalid();
  try { return { settings: parseCoinSetupPatch(settings) as CoinSetup, imageId: value.imageId }; } catch { return invalid(); }
}
export function sameGeneralEditor(saved: GeneralPreparationView, settings: CoinSetup, imageId?: string): boolean {
  return saved.editor?.imageId === imageId && Boolean(saved.editor) &&
    (["name", "symbol", "chainId", "pairToken", "initialBuy", "description", "website", "x"] as const)
      .every(key => (saved.editor!.settings[key] ?? "") === (settings[key] ?? ""));
}
export function readGeneralPreparation(value: unknown, account: string, id?: string): GeneralPreparationView | null {
  if (!object(value) || !exactKeys(value, ["preparation"]) || !("preparation" in value)) return invalid();
  const v = value.preparation;
  if (v === null) return null;
  if (!object(v) || !exactKeys(v, ["version", "id", "account", "chainId", "sourceId", "conversationId", "coin", "editor", "projectHash", "artifactHash",
    "packState", "code", "requestHash", "createdAt", "updatedAt", "expiresAt", "preflight", "submission", "launchReady"])
    || v.version !== 1 || v.launchReady !== false || !identifier(v.id) || id !== undefined && v.id !== id
    || typeof v.account !== "string" || !/^0x[a-f0-9]{40}$/iu.test(v.account) || v.account.toLowerCase() !== account.toLowerCase()
    || ![1, 4663, 8453, 999].includes(Number(v.chainId)) || typeof v.chainId !== "number"
    || !identifier(v.sourceId) || !identifier(v.conversationId) || !hash(v.projectHash) || !hash(v.artifactHash)
    || !["packing", "interrupted", "failed", "complete"].includes(String(v.packState))
    || ["createdAt", "updatedAt", "expiresAt"].some(key => !Number.isSafeInteger(v[key]) || Number(v[key]) < 0)
    || v.code !== undefined && !text(v.code) || v.requestHash !== undefined && !hash(v.requestHash)
    || v.coin !== undefined && (!object(v.coin) || !exactKeys(v.coin, ["name", "symbol"]) || !text(v.coin.name, 256) || !text(v.coin.symbol, 64))) return invalid();
  return { ...structuredClone(v), ...(v.editor === undefined ? {} : { editor: readEditor(v.editor, v.chainId) }), ...(v.preflight === undefined ? {} : { preflight: exchange(v.preflight) }),
    ...(v.submission === undefined ? {} : { submission: exchange(v.submission) }) } as GeneralPreparationView;
}

export function generalSubmissionUrl(preparation: GeneralPreparationView): string | undefined {
  const id = preparation.submission?.state === "completed" ? preparation.submission.resourceId : undefined;
  if (!uuid(id) || ![1, 4663, 8453, 999].includes(preparation.chainId)) return;
  const query = new URLSearchParams(preparation.chainId === 4663 ? { view: "history", chainId: "4663", launchId: id }
    : { launchId: id, ...(preparation.chainId === 1 ? {} : { chainId: String(preparation.chainId) }) });
  return `/developers/api-keys?${query}`;
}

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
});

/** One explicit action at a time. Reload and uncertain responses only GET the
 * private journal. A retry can POST only the original immutable ticket. */
export function createGeneralLaunchClient(options: {
  account: string; headers: AISessionHeaders; signal: AbortSignal;
  update: (state: GeneralLaunchState) => void;
  request?: typeof aiRequest; now?: () => number; delay?: typeof wait;
}) {
  const { account, signal } = options, request = options.request ?? aiRequest, now = options.now ?? Date.now;
  let state: GeneralLaunchState = { preparation: null, phase: "loading", error: "", loaded: false }, active = false, statusActive = false;
  function update(patch: Partial<GeneralLaunchState>) {
    if (patch.preparation !== undefined && (!patch.preparation || patch.preparation.id !== state.preparation?.id
      || patch.preparation.requestHash !== state.preparation?.requestHash || patch.preparation.submission?.state !== "completed"
      || patch.preparation.submission.resourceId !== state.preparation?.submission?.resourceId)) {
      patch = { ...patch, currentStatus: undefined, statusError: "" };
    }
    signal.throwIfAborted(); state = { ...state, ...patch }; options.update(state);
  }
  async function read(id?: string) {
    const value = await request(`/general-launch?${new URLSearchParams(id ? { id } : { account })}`, options.headers, undefined, signal);
    signal.throwIfAborted();
    const preparation = readGeneralPreparation(value, account, id);
    update({ preparation, loaded: true, ...(preparation?.submission?.state === "completed" ? { unconfirmedId: undefined } : {}) });
    return preparation;
  }
  async function action(phase: GeneralLaunchState["phase"], work: () => Promise<void>) {
    if (active || signal.aborted) return;
    active = true; update({ phase, error: "" });
    try { await work(); }
    catch (error) { if (!signal.aborted) update({ error: error instanceof Error ? error.message : "Check the saved submission before continuing." }); }
    finally { active = false; if (!signal.aborted) update({ phase: "idle" }); }
  }
  async function create(preparation: GeneralPreparationView) {
    if (preparation.submission?.state === "completed") return;
    if (preparation.submission?.state === "sending") { await read(preparation.id); return; }
    update({ phase: "submitting", unconfirmedId: preparation.id });
    try {
      const value = await request("/general-launch", options.headers, { action: "create", id: preparation.id }, signal);
      signal.throwIfAborted();
      const saved = readGeneralPreparation(value, account, preparation.id); if (!saved) return invalid();
      update({ preparation: saved, ...(saved.submission?.state === "completed" ? { unconfirmedId: undefined } : {}) });
    } catch (error) {
      // No retry and no second ticket after a lost or rejected create reply.
      if (!signal.aborted) await read(preparation.id).catch(() => undefined);
      throw error;
    }
  }
  async function currentStatus() {
    const original = state.preparation, resourceId = original?.submission?.state === "completed" ? original.submission.resourceId : undefined;
    if (!original || !resourceId || !original.requestHash || statusActive || signal.aborted) return;
    statusActive = true;
    const stillSelected = () => state.preparation?.id === original.id && state.preparation.requestHash === original.requestHash
      && state.preparation.submission?.state === "completed" && state.preparation.submission.resourceId === resourceId;
    try {
      const value = await request(`/general-launch?${new URLSearchParams({ id: original.id, view: "status" })}`, options.headers, undefined, signal);
      signal.throwIfAborted(); if (!stillSelected()) return;
      update({ currentStatus: readGeneralLaunchStatus(value, { account, chainId: original.chainId, resourceId,
        requestHash: original.requestHash, deadline: String(original.expiresAt / 1000) }), statusError: "" });
    } catch (error) {
      if (!signal.aborted && stillSelected()) update({ statusError: error instanceof Error ? error.message : "The current status could not be checked. Your submission is saved." });
    } finally { statusActive = false; }
  }
  return {
    observeStatus: async () => { if (!active) await currentStatus(); },
    refreshStatus: () => action("checking", currentStatus),
    refresh: () => action("checking", async () => { await read(state.unconfirmedId); }),
    submit: (select: (signal: AbortSignal) => Promise<GeneralPrepareInput>) => action("preparing", async () => {
      if (!state.loaded) throw Error("Check the saved submission before preparing another one.");
      if (state.unconfirmedId || state.preparation?.submission && state.preparation.submission.state !== "completed")
        throw Error("Recover the original submission before preparing another one.");
      const input = await select(signal); signal.throwIfAborted();
      if (input.selection.account.toLowerCase() !== account.toLowerCase()) return invalid();
      const id = crypto.randomUUID();
      let preparation: GeneralPreparationView | null;
      try {
        const value = await request("/general-launch", options.headers, { action: "prepare", id, ...input }, signal);
        signal.throwIfAborted(); preparation = readGeneralPreparation(value, account); if (!preparation) return invalid();
        if (preparation.sourceId !== input.selection.id || preparation.conversationId !== input.selection.conversation
          || preparation.chainId !== input.selection.chainId || preparation.projectHash !== input.selection.projectHash
          || preparation.artifactHash !== input.selection.artifactHash) return invalid();
        update({ preparation });
      } catch (error) {
        // A deduplicated ticket may have a different ID. A read of the active
        // pointer can recover it, but cannot prove this input: stop here.
        if (!signal.aborted) await read().catch(() => undefined);
        throw error;
      }
      const deadline = now() + 130_000;
      while (preparation.packState === "packing" && now() < deadline) {
        await (options.delay ?? wait)(5000, signal); preparation = await read(preparation.id); if (!preparation) return invalid();
      }
      if (preparation.packState !== "complete") throw Error(preparation.packState === "packing"
        ? "Preparation is still saved. Check it again shortly."
        : "Preparation stopped. Your source is saved. Try preparing this design again.");
      signal.throwIfAborted(); await create(preparation);
    }),
    recover: () => action("checking", async () => {
      const id = state.unconfirmedId ?? state.preparation?.id;
      if (!id) throw Error("Check the saved submission first.");
      const preparation = await read(id); if (!preparation || preparation.packState !== "complete") throw Error("The original preparation is not complete yet.");
      if (!state.unconfirmedId && !preparation.submission) throw Error("Prepare the current saved design before submitting it.");
      await create(preparation);
    }),
  };
}
