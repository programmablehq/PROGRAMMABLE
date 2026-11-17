import { describe, expect, it, vi } from "vitest";
import type { get, GetBlobResult } from "@vercel/blob";
vi.mock("server-only", () => ({}));
import { createPrivateBlobReadCache } from "@/lib/server/private-blob-read-cache";

const versionA = `"${"a".repeat(32)}"`;
const versionB = `"${"b".repeat(32)}"`;
const path = "indexes/test/snapshot.json";
const options = { token: "private-test-credential" };
const body = '{"entries":["one","two"]}';
function response(text = body, etag = versionA): GetBlobResult {
  return {
    statusCode: 200, stream: new Response(text).body!,
    headers: new Headers({ "content-length": String(Buffer.byteLength(text)) }),
    blob: { etag, size: Buffer.byteLength(text), contentType: "application/json",
      url: "https://test.private.blob.vercel-storage.com/snapshot.json",
      downloadUrl: "", pathname: path, contentDisposition: "", cacheControl: "max-age=60", uploadedAt: new Date(0) },
  };
}
function unchanged(etag = versionA): GetBlobResult {
  return { statusCode: 304, stream: null, headers: new Headers(),
    blob: { ...response().blob, etag, size: null, contentType: null } };
}
async function text(result: GetBlobResult | null) {
  if (!result || result.statusCode !== 200) throw new Error("Expected a body");
  return new Response(result.stream).text();
}

describe("authenticated private Blob revalidation", () => {
  it("reuses the downloaded body only after the origin confirms its exact ETag", async () => {
    const getBlob = vi.fn<typeof get>().mockResolvedValueOnce(response()).mockResolvedValueOnce(unchanged());
    const onRead = vi.fn();
    const read = createPrivateBlobReadCache({ getBlob, onRead });
    expect(await text(await read(path, options, 1024))).toBe(body);
    expect(await text(await read(path, options, 1024))).toBe(body);
    expect(getBlob.mock.calls[1]?.[1]).toMatchObject({
      token: options.token, access: "private", useCache: false, ifNoneMatch: versionA,
      headers: { "accept-encoding": "identity" },
    });
    expect(onRead.mock.calls.map(([event]) => event)).toEqual([
      { kind: "download", bytes: Buffer.byteLength(body) },
      { kind: "not-modified", bytes: Buffer.byteLength(body) },
    ]);
  });

  it("returns a new body and ETag when the stored checkpoint changes", async () => {
    const updated = '{"entries":["three"]}';
    const getBlob = vi.fn<typeof get>().mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response(updated, versionB)).mockResolvedValueOnce(unchanged(versionB));
    const read = createPrivateBlobReadCache({ getBlob });
    await text(await read(path, options, 1024));
    const current = await read(path, options, 1024);
    expect(current?.blob.etag).toBe(versionB);
    expect(await text(current)).toBe(updated);
    expect(await text(await read(path, options, 1024))).toBe(updated);
    expect(getBlob.mock.calls[2]?.[1]?.ifNoneMatch).toBe(versionB);
  });

  it("never substitutes saved data for denied access, missing objects or an unbound 304", async () => {
    const getBlob = vi.fn<typeof get>().mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new Error("Access denied")).mockResolvedValueOnce(null)
      .mockResolvedValueOnce(unchanged());
    const read = createPrivateBlobReadCache({ getBlob });
    await text(await read(path, options, 1024));
    await expect(read(path, options, 1024)).rejects.toThrow("Access denied");
    expect(await read(path, options, 1024)).toBeNull();
    expect(getBlob.mock.calls[2]?.[1]?.ifNoneMatch).toBeUndefined();
    await expect(read(path, options, 1024)).rejects.toThrow("no matching authenticated body");
  });

  it("rejects a 304 for a different version and isolates credentials and size limits", async () => {
    const getBlob = vi.fn<typeof get>().mockImplementation(async () => response());
    const read = createPrivateBlobReadCache({ getBlob });
    await text(await read(path, options, 1024));
    await text(await read(path, { token: "another-owner" }, 1024));
    await text(await read(path, options, 512));
    expect(getBlob.mock.calls.slice(0,3).every(call => call[1]?.ifNoneMatch === undefined)).toBe(true);
    getBlob.mockResolvedValueOnce(unchanged(versionB));
    await expect(read(path, options, 1024)).rejects.toThrow("no matching authenticated body");
  });

  it("shares concurrent downloads while giving each caller its own readable body", async () => {
    let release!: (value: GetBlobResult) => void;
    const getBlob = vi.fn<typeof get>().mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const read = createPrivateBlobReadCache({ getBlob });
    const first = read(path, options, 1024);
    const second = read(path, options, 1024);
    release(response());
    const [left, right] = await Promise.all([first, second]);
    expect(getBlob).toHaveBeenCalledTimes(1);
    expect(await text(left)).toBe(body);
    expect(await text(right)).toBe(body);
  });

  it("enforces download and retained-memory limits before reusing an entry", async () => {
    const getBlob = vi.fn<typeof get>().mockImplementation(async () => response());
    const read = createPrivateBlobReadCache({ getBlob, maximumEntries: 1 });
    await text(await read(path, options, 1024));
    await text(await read("indexes/another.json", options, 1024));
    await text(await read(path, options, 1024));
    expect(getBlob.mock.calls[2]?.[1]?.ifNoneMatch).toBeUndefined();
    await expect(read(path, options, 4)).rejects.toThrow("too-large");
    const tiny = createPrivateBlobReadCache({ getBlob, maximumCacheBytes: 2 });
    await text(await tiny(path, options, 1024));
    await text(await tiny(path, options, 1024));
    expect(getBlob.mock.lastCall?.[1]?.ifNoneMatch).toBeUndefined();
  });

  it("keeps a cancelled caller out of another request's shared operation", async () => {
    const controller = new AbortController();
    const getBlob = vi.fn<typeof get>().mockImplementation(async () => response());
    const read = createPrivateBlobReadCache({ getBlob });
    const first = read(path, options, 1024);
    controller.abort(new Error("Caller stopped"));
    await expect(read(path, { ...options, abortSignal: controller.signal }, 1024)).rejects.toThrow("Caller stopped");
    expect(await text(await first)).toBe(body);
    expect(getBlob).toHaveBeenCalledTimes(1);
  });
});
