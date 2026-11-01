import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generalWalletDetailUrl, generalWalletRequest, readGeneralWalletResource, reviewGeneralGraphWallet, sameGeneralGraphWalletReview,
  type GeneralWalletSubject } from "../lib/custom-ai/general-wallet";
import fixtures from "./fixtures/custom-ai-general-wallet-v1.json";
import { recordFixture } from "./fixtures/universal-launch-v1";
const signal = () => new AbortController().signal;
const headers = async () => ({ Authorization: "synthetic-local-session" });
const graph = (chainId = "1") => structuredClone(fixtures.fixtures[chainId as "1" | "8453" | "999"]);
const fixtureTime = (Number(fixtures.fixtures["1"].resource.output.signedPermit.validAfter) + 90) * 1000;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(fixtureTime); });
afterEach(() => { vi.useRealTimers(); });
function plan() {
  const resource = recordFixture(), subject: GeneralWalletSubject = { chainId: 4663, controller: resource.plan.controller.address,
    resourceId: resource.planId, requestHash: resource.planHash, rawRequestSha256: resource.rawRequestSha256, deadline: resource.plan.budgets.deadline };
  const body = { schemaVersion: "programmable.website-launch-history.v1", launches: [{ sourceVersion: "custom_launch_plan_v1", controller: subject.controller, resource }], nextCursor: null };
  return { subject, body };
}
describe("original submission to canonical wallet resource", () => {
  it.each(["1", "8453", "999"])("uses the real graph parser and Router codec for chain %s without a provider or wallet call", async chainId => {
    const f = graph(chainId), subject = f.subject as GeneralWalletSubject;
    const resource = await readGeneralWalletResource(subject, f.resource), review = await reviewGeneralGraphWallet(subject, resource);
    expect(review.router.walletAction.chainId).toBe(chainId); expect(review.router.walletAction.from.toLowerCase()).toBe(subject.controller.toLowerCase());
    expect(review.projectBinding).toMatchObject({ mode: "bound-metadata", requestHash: subject.requestHash });
    expect(sameGeneralGraphWalletReview(review, await reviewGeneralGraphWallet(subject, resource))).toBe(true);
  });
  it("matches the Plan hash, raw bytes, deadline, owner and exact resource, without accepting an admission as permission", async () => {
    const f = plan(); await expect(readGeneralWalletResource(f.subject, f.body)).resolves.toMatchObject({ kind: "plan", plan: { planId: f.subject.resourceId } });
    for (const change of [{ resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, { controller: `0x${"22".repeat(20)}` },
      { requestHash: `sha256:${"ff".repeat(32)}` }, { rawRequestSha256: `sha256:${"ff".repeat(32)}` }, { deadline: "1" }])
      await expect(readGeneralWalletResource({ ...f.subject, ...change } as GeneralWalletSubject, f.body)).rejects.toThrow("original saved submission");
    await expect(readGeneralWalletResource(f.subject, { ...f.body, launches: [...f.body.launches, ...f.body.launches] })).rejects.toThrow();
    for (const status of ["finalized", "unknown"])
      await expect(readGeneralWalletResource(f.subject, { ...f.body, launches: [{ ...f.body.launches[0], resource: { ...f.body.launches[0].resource, status } }] })).rejects.toThrow();
  });
  it("rejects owner/resource/hash/network substitution and a changed canonical Router action", async () => {
    const f = graph(), subject = f.subject as GeneralWalletSubject;
    for (const change of [{ ownerWallet: `0x${"22".repeat(20)}` }, { launchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, { requestHash: `sha256:${"ff".repeat(32)}` }])
      await expect(readGeneralWalletResource(subject, { ...f.resource, ...change })).rejects.toThrow();
    await expect(reviewGeneralGraphWallet({ ...subject, chainId: 8453 }, await readGeneralWalletResource(subject, f.resource))).rejects.toThrow();
    const changed = structuredClone(f.resource); changed.output.actionRequired.transaction.valueWei = "1";
    await expect(reviewGeneralGraphWallet(subject, await readGeneralWalletResource(subject, changed))).rejects.toThrow();
    await expect(reviewGeneralGraphWallet(subject, await readGeneralWalletResource(subject, { ...f.resource, status: "pending_review", walletHandoffUrl: null, expiresAt: null, secondsRemaining: null }))).rejects.toThrow("not currently approved");
  });
  it.each([1, 4663, 8453, 999] as const)("loads only the exact owned chain %s resource once, with a bounded same-origin read", async chainId => {
    const f = chainId === 4663 ? plan() : graph(String(chainId)), subject = f.subject as GeneralWalletSubject;
    const request = vi.fn(async () => Response.json("body" in f ? f.body : f.resource));
    await generalWalletRequest(subject, headers, signal(), undefined, request);
    expect(request).toHaveBeenCalledTimes(1); const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(generalWalletDetailUrl(subject)); expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", credentials: "same-origin" });
    const parsed = new URL(url, "https://programmable.market"); expect(parsed.searchParams.get("walletAddress")).toBe(subject.controller);
    expect(parsed.searchParams.get("chainId")).toBe(chainId === 8453 || chainId === 999 ? String(chainId) : null);
    expect(init.body).toBeUndefined();
  });
  it("sends only a proof hint for the exact existing Plan step, never another launch or transaction", async () => {
    const f = plan(), hash = `0x${"aa".repeat(32)}` as const, request = vi.fn(async () => Response.json({ accepted: true }));
    await generalWalletRequest(f.subject, headers, signal(), { stepId: "component:token", transactionHash: hash }, request);
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/custom-launch-plans/${f.subject.resourceId}/steps/component%3Atoken/proofs?`);
    expect(init.method).toBe("POST"); expect(JSON.parse(init.body as string)).toEqual({ schemaVersion: "programmable.custom-launch-plan-step-proof.v1", transactionHash: hash });
    await expect(generalWalletRequest(graph().subject as GeneralWalletSubject, headers, signal(), { stepId: "x", transactionHash: hash }, request)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not retry errors, cross-scope aborts, non-JSON, oversized or truncated responses", async () => {
    const subject = graph().subject as GeneralWalletSubject;
    for (const response of [new Response("Unavailable", { status: 503 }), new Response("bad"),
      new Response("{}", { headers: { "content-type": "application/json", "content-length": "67108865" } }),
      new Response("{", { headers: { "content-type": "application/json" } })]) {
      const request = vi.fn(async () => response); await expect(generalWalletRequest(subject, headers, signal(), undefined, request)).rejects.toThrow(); expect(request).toHaveBeenCalledTimes(1);
    }
    const controller = new AbortController(), request = vi.fn(async () => Response.json({}));
    await expect(generalWalletRequest(subject, async () => { controller.abort(); return {}; }, controller.signal, undefined, request)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
  });
});
