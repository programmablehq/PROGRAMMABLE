import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getAddress } from "viem";
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

it("resolves an existing coin through its retained release rather than the active launch default", async () => {
  const token = getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
  const existing = { ...availableFixture(), token: token.toLowerCase() };
  const fetcher = vi.fn(async (url: URL) => Response.json(url.pathname.endsWith(`/token/${token}`) ? existing : unavailableFoundation()));
  vi.stubGlobal("fetch", fetcher);
  const response = await GET(new Request(`https://programmable.example/api/module-foundation?token=${token}`));
  expect(await response.json()).toMatchObject({ available: true, token: token.toLowerCase(), binding: existing.binding });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0].href).toBe(`https://foundation-authority.example/v1/modules/foundation/availability/token/${token}`);
});

it.each(["", "0x0000000000000000000000000000000000000000", "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", "https://other.example", "0x1234"])("rejects an invalid token lookup before contacting the authority: %s", async token => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const response = await GET(new Request(`https://programmable.example/api/module-foundation?token=${encodeURIComponent(token)}`));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ available: false });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["?releaseDigest=0x1234", "?token=0x1111111111111111111111111111111111111111&token=0x2222222222222222222222222222222222222222", "?token=0x1111111111111111111111111111111111111111&origin=https://other.example"])("rejects ambiguous or caller-selected release authority: %s", async query => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect((await GET(new Request(`https://programmable.example/api/module-foundation${query}`))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([undefined, "0x2222222222222222222222222222222222222222"])("does not fall back to the current release for an unbound token response", async returnedToken => {
  const token = "0x1111111111111111111111111111111111111111";
  const fetcher = vi.fn(async () => Response.json({ ...availableFixture(), ...(returnedToken === undefined ? {} : { token: returnedToken }) }));
  vi.stubGlobal("fetch", fetcher);
  const response = await GET(new Request(`https://programmable.example/api/module-foundation?token=${token}`));
  expect(await response.json()).toEqual({ ...unavailableFoundation(), token });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
