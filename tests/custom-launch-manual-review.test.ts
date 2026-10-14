import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createManualReviewStartBridgeV1 } from "../lib/server/custom-launch/manual-review-start-v1";
import { WEBSITE_ADMIN_WALLET } from "../lib/admin-access";
import { createManualReviewBridgeV1 } from "../lib/server/custom-launch/manual-review-bridge-v1";
import { customLaunchReviewNeedsStart, customLaunchReviewOverdue, customLaunchReviewAllowsSigning, customLaunchReviewDescription, customLaunchReviewLabel, type CustomLaunchReview } from "../lib/custom-launch-review";

const review: CustomLaunchReview = { schemaVersion: "programmable.custom-launch-manual-review.v1", reviewId: "10000000-0000-4000-8000-000000000001",
  subjectHash: `sha256:${"1".repeat(64)}`, chainId: "1", controller: WEBSITE_ADMIN_WALLET, state: "approved", revision: 2,
  submittedAt: "2026-10-08T00:00:00Z", approvedAt: "2026-10-08T04:00:00Z", expiresAt: "2026-10-08T05:00:00Z", reason: null };
function fixture(wallets: readonly `0x${string}`[] = [WEBSITE_ADMIN_WALLET]) {
  const fetchBackend = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ review }));
  const route = createManualReviewBridgeV1({ authenticator: { authenticate: async () => ({ privyUserId: "did:privy:admin", privySessionId: "session", wallets }) },
    backendBaseUrl: "https://api.programmable.market", websiteToken: "w".repeat(43), bffAssertionKeyV2: "b".repeat(43), fetchBackend });
  return { route, fetchBackend };
}
function request(body: unknown) { return new Request(`https://programmable.market/api/admin/custom-launch-reviews?walletAddress=${WEBSITE_ADMIN_WALLET}`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://programmable.market" }, body: JSON.stringify(body),
}); }
const decision = { reviewId: review.reviewId, subjectHash: review.subjectHash, revision: 1, decision: "approve", reason: "Reviewed" };
describe("manual launch approval", () => {
  it("captures the approved server-side detail after responding, without changing approval or requiring applicant input", async () => {
    const detail = { ...review, request: { projectMetadata: { presentation: { description: "Public project" } } } };
    const fetchBackend = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ review })).mockResolvedValueOnce(Response.json({ review: detail }));
    const rememberPresentation = vi.fn(async () => undefined), work: Array<() => Promise<void>> = [];
    const route = createManualReviewBridgeV1({ authenticator: { authenticate: async () => ({ privyUserId: "did:privy:admin", privySessionId:"session", wallets:[WEBSITE_ADMIN_WALLET] }) },
      backendBaseUrl:"https://api.programmable.market",websiteToken:"w".repeat(43),bffAssertionKeyV2:"b".repeat(43),fetchBackend,
      rememberPresentation,defer: task => work.push(task) });
    expect((await route(request(decision))).status).toBe(200);
    expect(rememberPresentation).not.toHaveBeenCalled();
    await work[0]();
    expect(rememberPresentation).toHaveBeenCalledExactlyOnceWith(detail);
    expect(String(fetchBackend.mock.calls[1][0])).toContain(`reviewId=${review.reviewId}`);
    expect(new Headers(fetchBackend.mock.calls[1][1]?.headers).get("X-Programmable-Wallet-Address")?.toLowerCase()).toBe(WEBSITE_ADMIN_WALLET.toLowerCase());
  });
  it("never turns an optional presentation-cache failure into a failed approval", async () => {
    const work: Array<() => Promise<void>> = [];
    const route = createManualReviewBridgeV1({ authenticator: { authenticate: async () => ({ privyUserId:"did:privy:admin",privySessionId:"session",wallets:[WEBSITE_ADMIN_WALLET] }) },
      backendBaseUrl:"https://api.programmable.market",websiteToken:"w".repeat(43),bffAssertionKeyV2:"b".repeat(43),
      fetchBackend:vi.fn<typeof fetch>().mockResolvedValue(Response.json({review:{...review,request:{}}})),
      rememberPresentation:async()=>{throw new Error("storage unavailable");},defer:task=>work.push(task) });
    expect((await route(request(decision))).status).toBe(200);
    const warning=vi.spyOn(console,"warn").mockImplementation(()=>undefined);
    try { await expect(work[0]()).resolves.toBeUndefined(); } finally { warning.mockRestore(); }
  });
  it("shows a fresh server approval without enabling signing before its start time", () => {
    const now = Date.parse(review.approvedAt!) - 500;
    expect(customLaunchReviewLabel(review, now)).toBe("Approved");
    expect(customLaunchReviewAllowsSigning(review, now)).toBe(false);
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try { expect(customLaunchReviewDescription(review)).toMatch(/^Approved\. Launch by /); }
    finally { clock.mockRestore(); }
  });
  it("only enables signing inside the exact approval window", () => {
    expect(customLaunchReviewAllowsSigning(review, Date.parse(review.approvedAt!))).toBe(true);
    expect(customLaunchReviewAllowsSigning(review, Date.parse(review.expiresAt!))).toBe(false);
    expect(customLaunchReviewLabel(review, Date.parse(review.expiresAt!))).toBe("Approval expired");
    expect(customLaunchReviewAllowsSigning({ ...review, state: "pending" }, Date.parse(review.approvedAt!))).toBe(false);
  });
  it("requires the selected admin wallet to be linked to the authenticated account", async () => {
    const f = fixture(["0x2222222222222222222222222222222222222222"]);
    expect((await f.route(request(decision))).status).toBe(403); expect(f.fetchBackend).not.toHaveBeenCalled();
  });
  it("forwards only the exact decision and binds the verified reviewer server-side", async () => {
    const f = fixture(); expect((await f.route(request(decision))).status).toBe(200);
    const [url, init] = f.fetchBackend.mock.calls[0]!;
    expect(String(url)).toBe("https://api.programmable.market/v1/admin/custom-launch-reviews");
    expect(JSON.parse(String(init!.body))).toEqual(decision);
    const headers = new Headers(init!.headers);
    expect(headers.get("X-Programmable-Privy-User-Id")).toBe("did:privy:admin");
    expect(headers.get("X-Programmable-Wallet-Address")?.toLowerCase()).toBe(WEBSITE_ADMIN_WALLET.toLowerCase());
    expect((await f.route(request({ ...decision, reviewer: { privyUserId: "forged" } }))).status).toBe(400);
    expect(f.fetchBackend).toHaveBeenCalledTimes(1);
  });
});


describe("24-hour review and launch windows", () => {
  const approved = { ...review, expiresAt: "2026-10-09T04:00:00Z", launchRequestedAt: null, launchDeadline: null };
  it("waits for owner start and caps signing at the approval deadline", () => {
    const now = Date.parse("2026-10-09T03:30:00Z");
    expect(customLaunchReviewNeedsStart(approved, now)).toBe(true);
    expect(customLaunchReviewAllowsSigning(approved, now)).toBe(false);
    expect(customLaunchReviewAllowsSigning({ ...review, expiresAt: approved.expiresAt }, now)).toBe(false);
    const started = { ...approved, launchRequestedAt: new Date(now).toISOString(), launchDeadline: approved.expiresAt };
    expect(customLaunchReviewAllowsSigning(started, now)).toBe(true);
    expect(customLaunchReviewAllowsSigning(started, Date.parse(approved.expiresAt))).toBe(false);
  });
  it("keeps signing available after 23 hours and ends exactly at approval expiry", () => {
    const started = { ...approved, launchRequestedAt: review.approvedAt, launchDeadline: approved.expiresAt };
    expect(customLaunchReviewAllowsSigning(started, Date.parse(approved.expiresAt) - 1)).toBe(true);
    expect(customLaunchReviewAllowsSigning(started, Date.parse(approved.expiresAt))).toBe(false);
    expect(customLaunchReviewAllowsSigning({ ...started, launchDeadline: "2026-10-09T05:00:00Z" }, Date.parse(approved.expiresAt) - 1)).toBe(false);
  });
  it("marks pending applications overdue after 24 hours without changing their state", () => {
    const pending = { ...review, state: "pending" as const, approvedAt: null, expiresAt: null };
    const due = Date.parse(pending.submittedAt) + 86400000;
    expect(customLaunchReviewOverdue(pending, due - 1)).toBe(false);
    expect(customLaunchReviewOverdue(pending, due)).toBe(true);
    expect(customLaunchReviewLabel(pending, due)).toBe("Review pending");
  });
  it("lets an authenticated non-admin start only through the owner-bound backend", async () => {
    const owner = "0x2222222222222222222222222222222222222222" as const;
    const fetchBackend = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ review: approved }));
    const route = createManualReviewStartBridgeV1({ authenticator: { authenticate: async () => ({ privyUserId: "did:privy:owner", privySessionId: "session", wallets: [owner] }) },
      backendBaseUrl: "https://api.programmable.market", websiteToken: "w".repeat(43), bffAssertionKeyV2: "b".repeat(43), fetchBackend });
    const request = (walletAddress = owner) => new Request("https://programmable.market/api/custom-launch-reviews/start", { method: "POST",
      headers: { Origin: "https://programmable.market", "Content-Type": "application/json" }, body: JSON.stringify({ chainId: "1", launchId: review.reviewId, walletAddress }) });
    expect((await route(request())).status).toBe(200);
    const [url, init] = fetchBackend.mock.calls[0]!;
    expect(String(url)).toBe("https://api.programmable.market/v1/wallet-admin/custom-launch-reviews/start");
    expect(JSON.parse(String(init!.body))).toEqual({ chainId: "1", launchId: review.reviewId });
    expect(new Headers(init!.headers).get("X-Programmable-Wallet-Address")).toBe(owner);
    expect((await route(new Request("https://programmable.market/api/custom-launch-reviews/start", { method: "POST", body: JSON.stringify({ chainId: "1", launchId: review.reviewId, walletAddress: WEBSITE_ADMIN_WALLET }) }))).status).toBe(403);
    expect(fetchBackend).toHaveBeenCalledTimes(1);
  });
  it("preserves preparation backoff and does not disguise authentication failures as transient", async () => {
    const owner = "0x2222222222222222222222222222222222222222" as const;
    const fetchBackend = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 503, headers: { "Retry-After": "45" } }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const route = createManualReviewStartBridgeV1({ authenticator: { authenticate: async () => ({ privyUserId: "did:privy:owner", privySessionId: "session", wallets: [owner] }) },
      backendBaseUrl: "https://api.programmable.market", websiteToken: "w".repeat(43), bffAssertionKeyV2: "b".repeat(43), fetchBackend });
    const request = () => new Request("https://programmable.market/api/custom-launch-reviews/start", { method: "POST",
      body: JSON.stringify({ chainId: "4663", launchId: review.reviewId, walletAddress: owner }) });
    const unavailable = await route(request());
    expect(unavailable.status).toBe(503); expect(unavailable.headers.get("Retry-After")).toBe("45");
    const unauthorized = await route(request());
    expect(unauthorized.status).toBe(401); expect(unauthorized.headers.get("Retry-After")).toBeNull();
  });
});


it("keeps concrete review feedback visible when a repack is also required", () => {
  const rejected = { ...review, state: "rejected" as const, reason: "Change the fee recipient and deadline", requiresRepack: true };
  expect(customLaunchReviewLabel(rejected)).toBe("Changes requested");
  expect(customLaunchReviewDescription(rejected)).toBe(rejected.reason);
  expect(customLaunchReviewLabel({ ...rejected, supersededBy: {reviewId: review.reviewId, launchId: review.reviewId} })).toBe("Replaced");
});
it("does not let a discussion reply grant signing permission", () => {
  const pending = {...review, state: "pending" as const, discussion: [{revision: 3,createdAt: "2026-10-10T12:00:00Z",author: "reviewer" as const,message: "Please link the source",links: []}]};
  expect(customLaunchReviewLabel(pending)).toBe("Reply requested");
  expect(customLaunchReviewAllowsSigning(pending)).toBe(false);
});
