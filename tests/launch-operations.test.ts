import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildOperationsRows, describeStoredLaunchStatus, type OperationsReview, type OperationsLaunch, type OperationsSnapshot } from "../lib/launch-operations";
import { createLaunchOperationsRoute, createOperationsSnapshotReader } from "../lib/server/launch-operations";
import { WEBSITE_ADMIN_WALLET } from "../lib/admin-access";

const now = Date.parse("2026-10-11T12:00:00Z");
const review: OperationsReview = { schemaVersion: "programmable.custom-launch-manual-review.v1", reviewId: "10000000-0000-4000-8000-000000000001",
  launchId: "20000000-0000-4000-8000-000000000001", subjectHash: `sha256:${"1".repeat(64)}`, chainId: "1", controller: WEBSITE_ADMIN_WALLET,
  state: "approved", revision: 2, submittedAt: "2026-10-10T14:00:00Z", approvedAt: "2026-10-11T00:00:00Z", expiresAt: "2026-10-12T00:00:00Z",
  launchRequestedAt: null, launchDeadline: null, reason: null, requestSummary: { projectMetadata: { token: { name: "Example", symbol: "EX" } } } };
const launch: OperationsLaunch = { chainId: 1, token: "0x1111111111111111111111111111111111111111", name: "Example", symbol: "EX", mode: "custom", launchId: "onchain-id",
  requestId: review.launchId, transactionHash: `0x${"2".repeat(64)}`, observedAt: "2026-10-11T11:30:00Z", stamp: "recorded", listed: true };
const empty = (): OperationsSnapshot => ({ schemaVersion: "programmable.launch-operations.v1", checkedAt: new Date(now).toISOString(), indexed: [], published: [], recent: [],
  sources: [{ id: "index:1", label: "Ethereum", chainId: 1, status: "ready", updatedAt: new Date(now).toISOString(), count: 0, complete: true }] });

describe("launch operations observations", () => {
  it("does not call an approved but unsigned launch stuck, and marks an overdue review without expiring it", () => {
    const rows = buildOperationsRows([review], empty(), now);
    expect(rows[0]).toMatchObject({ name: "Example", group: "waiting", status: "Approved · waiting for team" });
    const pending = { ...review, state: "pending" as const, submittedAt: "2026-10-10T11:00:00Z", approvedAt: null, expiresAt: null };
    expect(buildOperationsRows([pending], empty(), now)[0]).toMatchObject({ group: "review", status: "Review overdue" });
    expect(pending.state).toBe("pending");
    expect(buildOperationsRows([{ ...review, launchRequestedAt: "2026-10-11T11:00:00Z" }], empty(), now)[0].status).toBe("Launch completion unconfirmed");
  });
  it("matches finalization by exact request and chain, never ticker or creator; excludes replaced requests", () => {
    const snapshot = { ...empty(), published: [{ ...launch, chainId: 4663 as const }], indexed: [{ ...launch, chainId: 4663 as const }] };
    expect(buildOperationsRows([review], snapshot, now)[0].group).toBe("waiting");
    snapshot.published = [launch]; snapshot.indexed = [launch];
    expect(buildOperationsRows([review], snapshot, now)[0]).toMatchObject({ group: "complete", status: "Launched" });
    expect(buildOperationsRows([{ ...review, supersededBy: { reviewId: review.reviewId, launchId: review.launchId } }], empty(), now)).toEqual([]);
  });
  it("detects a published launch absent from the index and never flags deliberately unlisted launches", () => {
    const snapshot = { ...empty(), published: [launch] };
    expect(buildOperationsRows([review], snapshot, now)).toHaveLength(1);
    expect(buildOperationsRows([review], snapshot, now)[0]).toMatchObject({ group: "attention", status: "Index not observed" });
    expect(buildOperationsRows([], { ...snapshot, published: [{ ...launch, listed: false }] }, now)).toEqual([]);
    expect(buildOperationsRows([review], { ...snapshot, published: [{ ...launch, listed: false }] }, now)[0].status).toBe("Launched · unlisted");
  });
  it("keeps native module provenance valid and reports unavailable indexes as unobserved", () => {
    const moduleLaunch = { ...launch, requestId: undefined, mode: "module" as const, stamp: "native-source" as const };
    expect(buildOperationsRows([], { ...empty(), recent: [moduleLaunch], indexed: [moduleLaunch] }, now)).toEqual([]);
    const snapshot = empty(); snapshot.sources[0].status = "unavailable"; snapshot.sources[0].complete = false;
    expect(buildOperationsRows([], { ...snapshot, recent: [moduleLaunch] }, now)[0].status).toBe("Index observation incomplete");
    expect(describeStoredLaunchStatus({ status: "submitted" }).next).toContain("before sending anything else");
  });
  it("coalesces read-only snapshots, expires them, and never caches a failed read", async () => {
    let clock = now;
    const read = vi.fn().mockResolvedValue(empty());
    const cached = createOperationsSnapshotReader(read, () => clock);
    await Promise.all([cached(), cached()]); await cached(); expect(read).toHaveBeenCalledTimes(1);
    clock += 30_001; await cached(); expect(read).toHaveBeenCalledTimes(2);
    const failing = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(empty());
    const retry = createOperationsSnapshotReader(failing, () => clock);
    await expect(retry()).rejects.toThrow("unavailable"); await retry(); expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe("launch operations authorization", () => {
  function fixture(wallets: readonly `0x${string}`[] = [WEBSITE_ADMIN_WALLET]) {
    const read = vi.fn().mockResolvedValue(empty()), inspect = vi.fn().mockResolvedValue({ status: "Observed", next: "Open coin" });
    const route = createLaunchOperationsRoute({ authenticator: { authenticate: async () => ({ privyUserId: "did:privy:admin", privySessionId: "session", wallets }) }, read, inspect });
    return { route, read, inspect };
  }
  const url = `https://programmable.market/api/admin/launch-operations?walletAddress=${WEBSITE_ADMIN_WALLET}`;
  it("authenticates the selected admin wallet before any source read or diagnostic", async () => {
    const f = fixture(["0x2222222222222222222222222222222222222222"]);
    expect((await f.route(new Request(url))).status).toBe(403); expect(f.read).not.toHaveBeenCalled(); expect(f.inspect).not.toHaveBeenCalled();
  });
  it("rejects writes, foreign origins and ambiguous input; returns private uncached observations", async () => {
    const f = fixture();
    expect((await f.route(new Request(url, { method: "POST" }))).status).toBe(405);
    expect((await f.route(new Request(url, { headers: { Origin: "https://other.example" } }))).status).toBe(403);
    expect((await f.route(new Request(url + "&chainId=1"))).status).toBe(400);
    expect((await f.route(new Request(url + "&token=" + launch.token + "&chainId=1&chainId=4663"))).status).toBe(400);
    expect(f.read).not.toHaveBeenCalled();
    const response = await f.route(new Request(url)); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vary")).toContain("Authorization");
    await f.route(new Request(url + "&chainId=1&token=" + launch.token)); expect(f.inspect).toHaveBeenCalledWith(1, launch.token, empty());
  });
});
