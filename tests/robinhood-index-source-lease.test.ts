import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const blob = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => blob);
import { acquireIndexSourceLease } from "@/lib/server/robinhood-index/source-lease";

const digest = `0x${"a".repeat(64)}`;
let clock: number;
let revision: number;
let records: Map<string, { body: string; etag: string }>;
const now = () => clock;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPS_BLOB_READ_WRITE_TOKEN", "private-test-storage");
  clock = Date.parse("2026-10-29T13:00:00Z");
  revision = 0;
  records = new Map();
  blob.get.mockImplementation(async (path: string) => {
    const value = records.get(path);
    return value ? { statusCode: 200, blob: { etag: value.etag },
      stream: new Response(value.body).body, headers: new Headers() } : null;
  });
  blob.put.mockImplementation(async (path: string, body: string, options: { allowOverwrite: boolean; ifMatch?: string }) => {
    const old = records.get(path);
    if (old && (!options.allowOverwrite || options.ifMatch !== old.etag) || !old && options.ifMatch) throw new Error("Precondition failed");
    const etag = `"${(++revision).toString(16).padStart(32, "0")}"`;
    records.set(path, { body, etag });
    return { etag };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("shared index source leases", () => {
  it("admits one of two concurrent jobs and uses uncached strong object versions", async () => {
    const jobs = await Promise.all([acquireIndexSourceLease(digest, now), acquireIndexSourceLease(digest, now)]);
    expect(jobs.filter(Boolean)).toHaveLength(1);
    expect(blob.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      access: "private", useCache: false, headers: { "accept-encoding": "identity" }, abortSignal: expect.any(AbortSignal),
    }));
    const active = JSON.parse([...records.values()][0].body);
    expect(active.expiresAt - clock).toBe(190_000);
    expect(JSON.stringify(active)).not.toContain("private-test-storage");
    await jobs.find(Boolean)!();
    expect(await acquireIndexSourceLease(digest, now)).toBeTypeOf("function");
  });

  it("allows independent releases to run while blocking duplicate work", async () => {
    expect(await acquireIndexSourceLease(digest, now)).toBeTypeOf("function");
    expect(await acquireIndexSourceLease(digest, now)).toBeNull();
    expect(await acquireIndexSourceLease(`0x${"b".repeat(64)}`, now)).toBeTypeOf("function");
    expect(records.size).toBe(2);
  });

  it("recovers an abandoned lease and fences the old owner's cleanup", async () => {
    const oldRelease = (await acquireIndexSourceLease(digest, now))!;
    clock += 190_001;
    const nextRelease = await acquireIndexSourceLease(digest, now);
    expect(nextRelease).toBeTypeOf("function");
    await expect(oldRelease()).rejects.toThrow("Precondition failed");
    expect(await acquireIndexSourceLease(digest, now)).toBeNull();
    await nextRelease!();
    expect(await acquireIndexSourceLease(digest, now)).toBeTypeOf("function");
  });

  it("reads back an uncertain successful acquisition instead of duplicating it", async () => {
    const write = blob.put.getMockImplementation()!;
    blob.put.mockImplementationOnce(async (...args) => { await write(...args); throw new Error("Acknowledgement lost"); });
    const release = await acquireIndexSourceLease(digest, now);
    expect(release).toBeTypeOf("function");
    expect(await acquireIndexSourceLease(digest, now)).toBeNull();
    expect(blob.put).toHaveBeenCalledTimes(1);
  });

  it("fails closed when storage cannot prove ownership", async () => {
    blob.get.mockRejectedValue(new Error("Storage unavailable"));
    await expect(acquireIndexSourceLease(digest, now)).rejects.toThrow("Storage unavailable");
    expect(blob.put).not.toHaveBeenCalled();
  });

  it.each(["weak", "oversized", "unbounded"])("rejects %s lease evidence", async kind => {
    blob.get.mockResolvedValue({ statusCode: 200,
      blob: { etag: kind === "weak" ? `W/"${"a".repeat(32)}"` : `"${"a".repeat(32)}"` },
      headers: new Headers(),
      stream: new Response(kind === "oversized" ? "x".repeat(1025)
        : JSON.stringify({ version: 1, owner: "a".repeat(36), expiresAt: clock + 1_000_000 })).body,
    });
    await expect(acquireIndexSourceLease(digest, now)).rejects.toThrow();
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("rejects non-source paths before reading storage", async () => {
    await expect(acquireIndexSourceLease("../../other-source", now)).rejects.toThrow("Invalid index lease identity");
    expect(blob.get).not.toHaveBeenCalled();
  });
});
