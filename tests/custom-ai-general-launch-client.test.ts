import { describe, expect, it, vi } from "vitest";
import { createGeneralLaunchClient, generalSubmissionUrl, readGeneralPreparation, sameGeneralEditor, type GeneralLaunchState, type GeneralPreparationView, type GeneralPrepareInput } from "../lib/custom-ai/general-preparation";
import type { aiRequest } from "../lib/custom-ai/client";

const account = `0x${"11".repeat(20)}`, other = `0x${"22".repeat(20)}`;
const sourceId = "source-general-client-0001", conversation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectHash = `sha256:${"a".repeat(64)}` as const, artifactHash = `sha256:${"b".repeat(64)}` as const;
const input: GeneralPrepareInput = { selection: { id: sourceId, account, conversation, chainId: 1, projectHash, artifactHash, studioRevision: 3, intentRevision: "c".repeat(64) } };
function record(overrides: Partial<GeneralPreparationView> = {}): GeneralPreparationView {
  return { version: 1, id: "general-client-ticket-0001", account, chainId: 1, sourceId, conversationId: conversation,
    coin: { name: "Original coin", symbol: "ORIG" }, projectHash, artifactHash, packState: "complete", requestHash: projectHash,
    createdAt: 1000, updatedAt: 2000, expiresAt: 1800000, launchReady: false, ...overrides };
}
const completed = () => record({ submission: { state: "completed", httpStatus: 201, resourceId: conversation, backendState: "review_pending" } });
const currentWire = (saved = completed()) => ({ schemaVersion: "programmable.wallet-launch-status.v1", kind: saved.chainId === 4663 ? "plan-v1" : "graph-v3", chainId: String(saved.chainId),
  resourceId: conversation, controller: account, requestHash: projectHash, rawRequestSha256: saved.chainId === 4663 ? artifactHash : null,
  status: "pending_review", errorCode: null, createdAt: new Date(1000).toISOString(), updatedAt: new Date(2000).toISOString(), checkedAt: new Date().toISOString(), deadline: String(saved.expiresAt / 1000), launchReady: false });
function fixture() {
  let state: GeneralLaunchState | undefined;
  const lifetime = new AbortController(), request = vi.fn(), update = vi.fn((value: GeneralLaunchState) => { state = value; });
  const client = createGeneralLaunchClient({ account, headers: async () => ({ Authorization: "synthetic-session" }), signal: lifetime.signal,
    update, request: request as typeof aiRequest });
  return { client, lifetime, request, update, state: () => state!, posts: () => request.mock.calls.filter(call => call[2] !== undefined),
    load: async (preparation: GeneralPreparationView | null = null) => { request.mockResolvedValueOnce({ preparation }); await client.refresh(); } };
}

describe("explicit general launch client", () => {
  it.each([422,409,503])("keeps an HTTP %i rejection without no-resource proof on exact-ticket recovery",async httpStatus=>{
    const f=fixture(),rejected=record({submission:{state:"rejected",httpStatus}});
    await f.load(rejected);
    const corrected=vi.fn(async()=>({...input,selection:{...input.selection,id:"corrected-source-client-0002"}}));
    await f.client.submit(corrected);
    expect(corrected).not.toHaveBeenCalled();expect(f.posts()).toHaveLength(0);
    f.request.mockResolvedValueOnce({preparation:rejected}).mockResolvedValueOnce({preparation:rejected});
    await f.client.recover();
    expect(f.posts().map(call=>call[2])).toEqual([{action:"create",id:rejected.id}]);
  });
  it("prepares ahead without publishing or submitting, then reuses the server-bound package on launch", async () => {
    const f = fixture(); await f.load();
    f.request.mockResolvedValueOnce({ preparation: record() });
    await f.client.prepare(async () => input);
    expect(f.posts().map(call => call[2].action)).toEqual(["prepare"]);
    expect(f.state().unconfirmedId).toBeUndefined();
    expect(f.state().preparation?.submission).toBeUndefined();
    f.request.mockResolvedValueOnce({ preparation: record() }).mockResolvedValueOnce({ preparation: completed() });
    await f.client.submit(async () => input);
    expect(f.posts().map(call => call[2].action)).toEqual(["prepare", "prepare", "create"]);
    expect(f.posts()[2][2]).toEqual({ action: "create", id: record().id });
  });
  it("does not start duplicate preparation or submit while an ahead-of-time package is still being prepared", async () => {
    const f = fixture(); await f.load(); let finish!: (value: unknown) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const select = vi.fn(async () => input), pending = f.client.prepare(select);
    await Promise.resolve();
    await f.client.prepare(select); await f.client.submit(select);
    expect(select).toHaveBeenCalledOnce(); expect(f.posts()).toHaveLength(1);
    finish({ preparation: record() }); await pending;
    expect(f.posts().map(call => call[2].action)).toEqual(["prepare"]);
  });
  it("keeps the prior accepted submission accessible while a new design is prepared privately", async () => {
    const f = fixture(); await f.load(completed());
    f.request.mockResolvedValueOnce({ preparation: record({ id: "general-client-ticket-0002" }) });
    await f.client.prepare(async () => input);
    expect(f.state().preparation?.submission).toBeUndefined();
    expect(f.state().previousSubmission?.submission?.resourceId).toBe(conversation);
    expect(f.posts().map(call => call[2].action)).toEqual(["prepare"]);
  });
  it("observes accepted status with GET and leaves the action phase idle", async () => {
    const f = fixture(); await f.load(completed()); f.request.mockResolvedValueOnce({ status: currentWire() });
    await f.client.observeStatus(); expect(f.request.mock.lastCall?.[0]).toContain("view=status"); expect(f.posts()).toHaveLength(0);
    expect(f.state().currentStatus?.status).toBe("pending_review"); expect(f.state().phase).toBe("idle");
  });
  it("ignores duplicate background checks and a late status after a different ticket is selected", async () => {
    const f = fixture(); await f.load(completed()); let finish: (value: unknown) => void = () => {};
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.client.observeStatus(); await f.client.observeStatus(); expect(f.request).toHaveBeenCalledTimes(2);
    f.request.mockResolvedValueOnce({ preparation: { ...completed(), id: "different-preparation-0002" } }); await f.client.refresh();
    finish({ status: currentWire() }); await pending; expect(f.state().currentStatus).toBeUndefined(); expect(f.posts()).toHaveLength(0);
  });
  it("retains the accepted submission when a current-status request fails", async () => {
    const f = fixture(); await f.load(completed()); f.request.mockRejectedValueOnce(Error("Status unavailable"));
    await f.client.observeStatus(); expect(f.state().statusError).toBe("Status unavailable"); expect(f.state().preparation?.submission?.state).toBe("completed");
    expect(f.state().unconfirmedId).toBeUndefined(); expect(f.posts()).toHaveLength(0);
    f.request.mockResolvedValueOnce({ status: currentWire() }); await f.client.refreshStatus(); expect(f.state().statusError).toBe("");
  });
  it("reload reads only the compact owned journal and completed status is not launch readiness", async () => {
    const f = fixture(); await f.load(completed());
    expect(f.request.mock.calls[0][0]).toContain("account="); expect(f.posts()).toHaveLength(0);
    expect(f.state()).toMatchObject({ loaded: true, phase: "idle", preparation: { launchReady: false } });
    await f.client.recover(); expect(f.posts()).toHaveLength(0);
  });
  it.each([1, 4663, 8453, 999] as const)("flushes once, prepares once and directly creates on chain %s", async chainId => {
    const f = fixture(); await f.load();
    f.request.mockResolvedValueOnce({ preparation: record({ chainId }) }).mockResolvedValueOnce({ preparation: { ...completed(), chainId } });
    const select = vi.fn(async () => ({ selection: { ...input.selection, chainId }, ...(chainId === 4663 ? { controllerKind: "eoa" as const } : {}) }));
    await Promise.all([f.client.submit(select), f.client.submit(select)]);
    expect(select).toHaveBeenCalledOnce(); expect(f.posts().map(call => call[2].action)).toEqual(["prepare", "create"]);
    expect(f.posts()[1][2]).toEqual({ action: "create", id: record().id });
    expect(f.state().unconfirmedId).toBeUndefined(); expect(f.state().preparation?.submission?.resourceId).toBe(conversation);
  });
  it("stops before prepare when the owned studio save fails", async () => {
    const f = fixture(); await f.load(); await f.client.submit(async () => { throw Error("Studio changed"); });
    expect(f.posts()).toHaveLength(0); expect(f.state().error).toBe("Studio changed");
  });
  it("never starts another ticket when the first status read failed", async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(Error("Session unavailable")); await f.client.refresh();
    const select = vi.fn(async () => input); await f.client.submit(select);
    expect(select).not.toHaveBeenCalled(); expect(f.posts()).toHaveLength(0); expect(f.state().loaded).toBe(false);
  });
  it("losing a prepare response only reads the active pointer and never auto-submits it", async () => {
    const f = fixture(); await f.load(); f.request.mockRejectedValueOnce(Error("Reply lost")).mockResolvedValueOnce({ preparation: record() });
    await f.client.submit(async () => input);
    expect(f.posts().map(call => call[2].action)).toEqual(["prepare"]); expect(f.state().preparation?.id).toBe(record().id);
    expect(f.state().error).toBe("Reply lost");
  });
  it("losing a create response keeps the original ID and recovers it after edits without preparing again", async () => {
    const f = fixture(); await f.load();
    f.request.mockResolvedValueOnce({ preparation: record() }).mockRejectedValueOnce(Error("Reply lost"))
      .mockResolvedValueOnce({ preparation: record({ submission: { state: "unknown" } }) });
    await f.client.submit(async () => input);
    expect(f.state().unconfirmedId).toBe(record().id); expect(f.posts()).toHaveLength(2);
    const select = vi.fn(async () => ({ ...input, selection: { ...input.selection, id: "edited-source-client-0002" } }));
    await f.client.submit(select); expect(select).not.toHaveBeenCalled();
    f.request.mockResolvedValueOnce({ preparation: record({ submission: { state: "unknown" } }) }).mockResolvedValueOnce({ preparation: completed() });
    await f.client.recover(); expect(f.posts().map(call => call[2].action)).toEqual(["prepare", "create", "create"]);
    expect(f.posts()[2][2]).toEqual(f.posts()[1][2]); expect(f.state().unconfirmedId).toBeUndefined();
  });
  it("an already sending submission only reads and never POSTs again", async () => {
    const f = fixture(), sending = record({ submission: { state: "sending" } }); await f.load(sending);
    f.request.mockResolvedValue({ preparation: sending }); await f.client.recover(); expect(f.posts()).toHaveLength(0);
  });
  it("a packing ticket is followed with bounded GETs and no second prepare or preflight", async () => {
    const lifetime = new AbortController(), request = vi.fn(), update = vi.fn();
    request.mockResolvedValueOnce({ preparation: null }).mockResolvedValueOnce({ preparation: record({ packState: "packing" }) })
      .mockResolvedValueOnce({ preparation: record() }).mockResolvedValueOnce({ preparation: completed() });
    const delay = vi.fn(async () => undefined);
    const client = createGeneralLaunchClient({ account, headers: async () => ({}), signal: lifetime.signal, update, request: request as typeof aiRequest, delay });
    await client.refresh(); await client.submit(async () => input);
    expect(delay).toHaveBeenCalledExactlyOnceWith(5000, lifetime.signal);
    expect(request.mock.calls.map(call => call[2]?.action ?? "GET")).toEqual(["GET", "prepare", "GET", "create"]);
  });
  it("read polling ends after its bounded window without create", async () => {
    let time = 0; const request = vi.fn().mockResolvedValue({ preparation: record({ packState: "packing" }) });
    let state: GeneralLaunchState | undefined;
    const client = createGeneralLaunchClient({ account, headers: async () => ({}), signal: new AbortController().signal,
      request: request as typeof aiRequest, now: () => time, delay: async ms => { time += ms; }, update: next => { state = next; } });
    await client.refresh(); await client.submit(async () => input);
    expect(request.mock.calls.filter(call => call[2]?.action === "create")).toHaveLength(0);
    expect(request.mock.calls.filter(call => call[2] === undefined)).toHaveLength(27); expect(state?.error).toContain("still saved");
  });
  it("account or scope cancellation during the studio save stops before any mutation", async () => {
    const f = fixture(); await f.load();
    await f.client.submit(async () => { f.lifetime.abort(); return input; }); expect(f.posts()).toHaveLength(0);
  });
  it("late results after cancellation cannot update the new scope or create", async () => {
    const f = fixture(); await f.load();
    f.request.mockImplementationOnce(async () => { f.lifetime.abort(); return { preparation: record() }; });
    await f.client.submit(async () => input);
    expect(f.posts().map(call => call[2].action)).toEqual(["prepare"]); expect(f.state().preparation).toBeNull();
  });
  it("mismatched source or wallet replies cannot be submitted", async () => {
    for (const changed of [{ account: other }, { sourceId: "other-source-client-0002" }, { chainId: 999 as const }]) {
      const f = fixture(); await f.load(); f.request.mockResolvedValueOnce({ preparation: record(changed) }).mockResolvedValueOnce({ preparation: null });
      await f.client.submit(async () => input); expect(f.posts().map(call => call[2].action)).toEqual(["prepare"]);
      expect(f.state().error).toContain("matched");
    }
  });
});

describe("compact journal browser contract", () => {
  it("keeps an accepted submission bound to its original coin details and image", () => {
    const settings = { name: "Original coin", symbol: "ORIG", chainId: 1 as const, pairToken: "ETH", initialBuy: "0.01", description: "Original description", website: "https://example.com", x: "https://x.com/example" };
    const saved = readGeneralPreparation({ preparation: record({ editor: { settings, imageId: "d".repeat(64) } }) }, account)!;
    expect(sameGeneralEditor(saved, settings, "d".repeat(64))).toBe(true);
    for (const change of [{ name: "New coin" }, { description: "Edited description" }, { initialBuy: "0.02" }, { x: "https://x.com/another" }])
      expect(sameGeneralEditor(saved, { ...settings, ...change }, "d".repeat(64))).toBe(false);
    expect(sameGeneralEditor(saved, settings, "e".repeat(64))).toBe(false);
    expect(sameGeneralEditor(record(), settings, "d".repeat(64))).toBe(false);
  });
  it("rejects private pack fields, foreign accounts, forged readiness and invalid destinations", () => {
    for (const changed of [{ launchReady: true }, { id: "bad" }, { account: other }, { requestBody: "private source" },
      { submission: { state: "completed", resourceId: "https://attacker.example" } }, { chainId: "1" }])
      expect(() => readGeneralPreparation({ preparation: { ...record(), ...changed } }, account)).toThrow("matched");
    expect(() => readGeneralPreparation({ preparation: record() }, account, "different-preparation-0001")).toThrow("matched");
  });
  it.each([1, 4663, 8453, 999] as const)("uses only the canonical on-site handoff for chain %s", chainId => {
    const preparation = { ...completed(), chainId }, path = generalSubmissionUrl(preparation)!;
    const url = new URL(path, "https://programmable.market");
    expect(url.origin).toBe("https://programmable.market"); expect(url.pathname).toBe("/developers/api-keys");
    expect(url.searchParams.get("launchId")).toBe(conversation);
    expect(url.searchParams.get("chainId")).toBe(chainId === 1 ? null : String(chainId));
    expect(url.searchParams.get("view")).toBe(chainId === 4663 ? "history" : null);
    expect(generalSubmissionUrl(record({ chainId }))).toBeUndefined();
  });
});

it("one submit action runs its automatic check without another prepare or a manual review action",async()=>{
 const f=fixture();await f.load();
 const accepted=completed();accepted.submission={...accepted.submission!,reviewId:conversation,reviewSubjectHash:projectHash};
 const now=Date.now(),automatic={schemaVersion:"programmable.automatic-launch-status.v1",reviewId:conversation,state:"approved",manualReviewRequired:false,launchReady:false,
  findings:[],timing:{sourceGeneratedAt:now-1000,startedAt:now-900,finishedAt:now,sourceToDecisionMs:1000,decisionWithinTarget:true}};
 f.request.mockResolvedValueOnce({preparation:record()}).mockResolvedValueOnce({preparation:accepted}).mockResolvedValueOnce({automatic})
  .mockResolvedValueOnce({status:{...currentWire(accepted),automatic}});
 await f.client.submit(async()=>input);
 expect(f.posts().map(call=>call[2].action)).toEqual(["prepare","create","check"]);
 expect(f.state().automatic?.state).toBe("approved");expect(f.state().unconfirmedId).toBeUndefined();expect(f.state().error).toBe("");
});
