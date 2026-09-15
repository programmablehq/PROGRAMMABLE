import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, toHex } from "viem";
import { GET } from "@/app/api/module-foundation/locate/route";
import { FOUNDATION_AVAILABILITY_SCHEMA } from "@/lib/module-foundation/availability";

const mocks = vi.hoisted(() => ({ availability: vi.fn(), locator: vi.fn(), index: vi.fn(), head: vi.fn(), client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/module-foundation/availability", () => ({ readFoundationAvailabilityResponse: mocks.availability }));
vi.mock("@/lib/module-foundation/client", () => ({ createFoundationClient: mocks.client }));
vi.mock("@/lib/module-foundation/discovery", () => ({ FOUNDATION_DISCOVERY_MAX_BLOCKS: 5_000n,
  locateFoundationCreationTransaction: mocks.locator, readFoundationLaunchIndex: mocks.index }));

const token = getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
const factory = getAddress("0x1000000000000000000000000000000000000000");
const hookDeployer = getAddress("0x2000000000000000000000000000000000000000");
const hash = (n: number) => toHex(n, { size: 32 });
const candidate = hash(50);
const request = (extra = "", rawToken: string = token) => new Request(`http://localhost/api/module-foundation/locate?token=${rawToken}${extra}`);
function accepted(startBlock = "100") {
  return { schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA, available: true,
    binding: { releaseDigest: hash(1), sourceCommit: "a".repeat(40), startBlock,
      factory: { address: factory, runtimeCodeHash: hash(2) }, hookDeployer: { address: hookDeployer, runtimeCodeHash: hash(3) } },
    evidence: { checkedAt: new Date().toISOString(), sourcePath: "/v1/modules/foundation/source",
      artifactDigest: hash(4), decisionDigest: hash(5), sourceManifestHash: hash(6), deploymentEvidenceDigest: hash(7),
      runtimeVerificationDigest: hash(8), finalityEvidenceDigest: hash(9), blockHash: hash(10) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.availability.mockResolvedValue(accepted());
  mocks.head.mockResolvedValue(10_000n);
  mocks.client.mockReturnValue({ getBlockNumber: mocks.head });
  mocks.locator.mockResolvedValue(null);
  mocks.index.mockResolvedValue({ entries: [], nextCursor: null });
});
afterEach(() => vi.useRealTimers());

describe("foundation candidate BFF", () => {
  it("returns an untrusted fixed-upstream candidate only after accepted backend release validation", async () => {
    mocks.locator.mockResolvedValue(candidate);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transactionHash: candidate });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.availability).toHaveBeenCalledWith();
    expect(mocks.locator).toHaveBeenCalledWith(token, { signal: expect.any(AbortSignal) });
    expect(mocks.index).not.toHaveBeenCalled();
    expect(mocks.head).toHaveBeenCalledWith({ cacheTime: 0 });
  });

  it.each(["unavailable", "missing", "stale"])("keeps a %s accepted release unavailable without public lookups", async mode => {
    if (mode === "unavailable") mocks.availability.mockResolvedValue({ schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA, available: false });
    if (mode === "missing") mocks.availability.mockRejectedValue(new Error("private authority failure"));
    if (mode === "stale") { const value = accepted(); value.evidence.checkedAt = new Date(Date.now() - 121_000).toISOString(); mocks.availability.mockResolvedValue(value); }
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transactionHash: null, reason: expect.stringContaining("release is being verified") });
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.locator).not.toHaveBeenCalled();
    expect(mocks.index).not.toHaveBeenCalled();
  });

  it.each(["403 challenge", "not found"])("uses one bounded token-indexed window after explorer %s", async cause => {
    if (cause === "403 challenge") mocks.locator.mockRejectedValue(new Error("upstream HTTP 403 challenge"));
    mocks.index.mockResolvedValue({ entries: [{ transactionHash: candidate }], nextCursor: null });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transactionHash: candidate, search: { fromBlock: "5001", toBlock: "10000" } });
    expect(mocks.index).toHaveBeenCalledTimes(1);
    expect(mocks.index).toHaveBeenCalledWith(expect.objectContaining({ token, fromBlock: 5_001n, toBlock: 10_000n,
      pageSize: 2, binding: expect.objectContaining({ releaseDigest: hash(1), startBlock: 100n, factory: expect.objectContaining({ address: factory }) }) }));
  });

  it("clamps the recent window to the accepted source start block", async () => {
    mocks.availability.mockResolvedValue(accepted("9000"));
    expect(await (await GET(request())).json()).toMatchObject({ transactionHash: null, search: { fromBlock: "9000", toBlock: "10000" } });
    expect(mocks.index).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 9_000n, toBlock: 10_000n }));
  });

  it("uses an explicitly selected bounded historical window without widening it", async () => {
    const response = await GET(request("&fromBlock=100&toBlock=5099"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ transactionHash: null, search: { fromBlock: "100", toBlock: "5099" } });
    expect(mocks.index).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 100n, toBlock: 5_099n }));
    expect(mocks.index).toHaveBeenCalledTimes(1);
  });

  it("returns a scoped miss or unavailable history without echoing upstream details", async () => {
    let response = await GET(request());
    expect(await response.json()).toMatchObject({ transactionHash: null, reason: expect.stringContaining("this block window"), search: { fromBlock: "5001", toBlock: "10000" } });
    mocks.index.mockRejectedValue(new Error("private RPC address and failure details"));
    response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transactionHash: null, reason: "Launch history is temporarily unavailable. Please try again.", search: { fromBlock: "5001", toBlock: "10000" } });
  });

  it("does not select arbitrarily among ambiguous matching transactions", async () => {
    mocks.index.mockResolvedValue({ entries: [{ transactionHash: candidate }, { transactionHash: hash(51) }], nextCursor: null });
    expect(await (await GET(request())).json()).toMatchObject({ transactionHash: null, reason: expect.stringContaining("one transaction") });
    expect(mocks.index).toHaveBeenCalledTimes(1);
  });

  it.each(["factory", "binding", "releaseDigest", "source", "rpc", "url", "upstream", "cursor"])("rejects request-controlled %s authority", async key => {
    const response = await GET(request(`&${key}=https%3A%2F%2Funtrusted.example`));
    expect(response.status).toBe(400);
    expect((await response.json()).transactionHash).toBeNull();
    expect(mocks.availability).not.toHaveBeenCalled();
  });

  it.each([
    "&token=0x1000000000000000000000000000000000000000", "&fromBlock=1", "&toBlock=2",
    "&fromBlock=-1&toBlock=2", "&fromBlock=1&toBlock=5001", "&fromBlock=20&toBlock=10",
  ])("rejects malformed or oversized query %s", async extra => {
    expect((await GET(request(extra))).status).toBe(400);
    expect(mocks.availability).not.toHaveBeenCalled();
  });

  it("requires a nonzero checksummed token and rejects a window outside the accepted chain interval", async () => {
    for (const raw of [token.toLowerCase(), "0x1234", "0x0000000000000000000000000000000000000000"]) {
      expect((await GET(request("", raw))).status).toBe(400);
    }
    for (const range of ["&fromBlock=99&toBlock=100", "&fromBlock=9999&toBlock=10001"]) {
      expect((await GET(request(range))).status).toBe(400);
    }
    expect(mocks.locator).not.toHaveBeenCalled();
    expect(mocks.index).not.toHaveBeenCalled();
  });

  it("bounds a stalled authority request and respects an already cancelled request", async () => {
    vi.useFakeTimers();
    mocks.availability.mockImplementation(() => new Promise(() => undefined));
    const pending = GET(request());
    await vi.advanceTimersByTimeAsync(45_000);
    expect((await pending).status).toBe(200);
    const controller = new AbortController(); controller.abort();
    const cancelled = new Request(request(), { signal: controller.signal });
    vi.clearAllMocks();
    expect((await GET(cancelled)).status).toBe(200);
    expect(mocks.availability).not.toHaveBeenCalled();
  });
});
