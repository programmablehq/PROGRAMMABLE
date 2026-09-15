import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET, maxDuration } from "@/app/api/module-foundation/route";
import { FOUNDATION_AVAILABILITY_SCHEMA, unavailableFoundation } from "@/lib/module-foundation/availability";
import { readFoundationAvailabilityResponse } from "@/lib/server/module-foundation/availability";

function availableFixture() {
  const digest = `0x${"a".repeat(64)}`;
  return { ...unavailableFoundation(), schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA, available: true, reason: null,
    binding: { releaseDigest: digest, sourceCommit: "a".repeat(40), startBlock: "100",
      factory: { address: `0x${"1".repeat(40)}`, runtimeCodeHash: digest },
      hookDeployer: { address: `0x${"2".repeat(40)}`, runtimeCodeHash: digest } },
    evidence: { checkedAt: new Date().toISOString(), sourcePath: "/v1/modules/foundation/source",
      artifactDigest: digest, decisionDigest: digest, sourceManifestHash: digest,
      deploymentEvidenceDigest: digest, runtimeVerificationDigest: digest, finalityEvidenceDigest: digest, blockHash: digest } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL", "https://foundation-authority.example");
  // Native AbortSignal.timeout does not use Vitest's clock. Only its scheduler is replaced;
  // the actual GET, helper, parser, abort event and fail-closed response run together.
  vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
    return controller.signal;
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("returns a current verified response after the old deadline and closes a stalled availability read before the route expires", async () => {
  vi.stubGlobal("fetch", vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(Response.json(availableFixture())), 13_000);
    init.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal!.reason); }, { once: true });
  })));
  const delayed = GET();
  await vi.advanceTimersByTimeAsync(13_000);
  const success = await delayed;
  expect(success.status).toBe(200);
  expect(await success.json()).toMatchObject({ available: true });
  expect(success.headers.get("cache-control")).toBe("no-store");

  let abortedAt: number | undefined, settled = false;
  const startedAt = Date.now();
  vi.stubGlobal("fetch", vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => { abortedAt = Date.now() - startedAt; reject(init.signal!.reason); }, { once: true });
  })));
  const stalled = GET().then(response => { settled = true; return response; });
  await vi.advanceTimersByTimeAsync(54_999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await (await stalled).json()).toEqual(unavailableFoundation());
  expect(abortedAt).toBeLessThan(maxDuration * 1000);
});

it("retains the shorter default for composition and discovery callers", async () => {
  const fetcher = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(Response.json(availableFixture())), 13_000);
    init.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal!.reason); }, { once: true });
  })) as unknown as typeof fetch;
  const result = readFoundationAvailabilityResponse(fetcher).then(() => "unexpected success", error => error.name);
  await vi.advanceTimersByTimeAsync(12_000);
  expect(await result).toBe("TimeoutError");
});
