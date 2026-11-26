import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { get, head, GetBlobResult } from "@vercel/blob";
vi.mock("server-only", () => ({}));
import { createPrivateBlobReadCache } from "@/lib/server/private-blob-read-cache";

const versionA = `"${"a".repeat(32)}"`;
const versionB = `"${"b".repeat(32)}"`;
const path = "indexes/test/snapshot.json";
const options = { token: "private-test-credential" };
const body = '{"entries":["one","two"]}';
function response(text = body, etag = versionA): Extract<GetBlobResult, { statusCode: 200 }> {
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

function gzipResponse(decodedText: string, etag: string) {
  const result = response(decodedText, `W/${etag}`);
  result.headers.delete("content-length");
  result.headers.set("content-encoding", "gzip");
  return result;
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
      headers: { "accept-encoding": "gzip" },
    });
    expect(onRead.mock.calls.map(([event]) => event)).toEqual([
      { kind: "download", bytes: Buffer.byteLength(body) },
      { kind: "not-modified", bytes: Buffer.byteLength(body) },
    ]);
  });

  it("binds decoded gzip bytes to the canonical strong tag and reuses that version", async () => {
    const version = `"${createHash("md5").update(body).digest("hex")}"`;
    const stored = response(body, version).blob;
    const getBlob = vi.fn<typeof get>().mockResolvedValueOnce(gzipResponse(body, version))
      .mockResolvedValueOnce(unchanged(`W/${version}`));
    const headBlob = vi.fn<typeof head>().mockResolvedValue(stored);
    const onRead = vi.fn();
    const read = createPrivateBlobReadCache({ getBlob, headBlob, onRead });

    const result = await read(path, options, 1024);
    expect(result?.blob).toMatchObject({ etag: version, size: stored.size });
    expect(result?.headers.get("etag")).toBe(version);
    expect(result?.headers.get("content-encoding")).toBeNull();
    expect(await text(result)).toBe(body);
    expect(await text(await read(path, options, 1024))).toBe(body);
    expect(getBlob.mock.lastCall?.[1]?.ifNoneMatch).toBe(version);
    expect(onRead).toHaveBeenNthCalledWith(1, { kind: "download", bytes: stored.size, compressed: true });
    expect(onRead).toHaveBeenNthCalledWith(2, { kind: "metadata-not-modified", bytes: stored.size });
  });

  it.each(["version changed", "body differs"])("uses the direct identity response when gzip cannot be bound (%s)", async failure => {
    const version = `"${createHash("md5").update(body).digest("hex")}"`;
    const updated = body.replace("one", "six");
    const current = response(updated, versionB);
    const getBlob = vi.fn<typeof get>()
      .mockResolvedValueOnce(gzipResponse(failure === "body differs" ? updated : body, version))
      .mockResolvedValueOnce(current);
    const headBlob = vi.fn<typeof head>()
      .mockResolvedValueOnce(failure === "version changed" ? current.blob : response(body, version).blob);
    const onRead = vi.fn();
    const read = createPrivateBlobReadCache({ getBlob, headBlob, onRead });

    const result = await read(path, options, 1024);
    expect(result?.blob.etag).toBe(versionB);
    expect(await text(result)).toBe(updated);
    expect(getBlob).toHaveBeenCalledTimes(2);
    expect(getBlob.mock.lastCall?.[1]).toMatchObject({
      token: options.token, useCache: false, headers: { "accept-encoding": "identity" },
    });
    expect(onRead).toHaveBeenCalledExactlyOnceWith({ kind: "download", bytes: current.blob.size });
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

  it("confirms a headerless 304 with authenticated metadata without downloading the body again", async () => {
    const initial = response();
    const getBlob = vi.fn<typeof get>().mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(unchanged(""));
    const headBlob = vi.fn<typeof head>().mockResolvedValueOnce(initial.blob);
    const onRead = vi.fn();
    const read = createPrivateBlobReadCache({ getBlob, headBlob, onRead });

    await text(await read(path, options, 1024));
    expect(await text(await read(path, options, 1024))).toBe(body);
    expect(getBlob).toHaveBeenCalledTimes(2);
    expect(headBlob).toHaveBeenCalledOnce();
    expect(headBlob).toHaveBeenCalledWith(path, {
      token: options.token, abortSignal: getBlob.mock.lastCall?.[1]?.abortSignal,
    });
    expect(onRead).toHaveBeenLastCalledWith({ kind: "metadata-not-modified", bytes: Buffer.byteLength(body) });
  });

  it("downloads the current version when metadata no longer matches a headerless 304", async () => {
    const current = response('{"entries":["three"]}', versionB);
    const getBlob = vi.fn<typeof get>().mockResolvedValueOnce(response())
      .mockResolvedValueOnce(unchanged("")).mockResolvedValueOnce(current);
    const headBlob = vi.fn<typeof head>().mockResolvedValueOnce(current.blob);
    const read = createPrivateBlobReadCache({ getBlob, headBlob });

    await text(await read(path, options, 1024));
    const result = await read(path, options, 1024);
    expect(result?.blob.etag).toBe(versionB);
    expect(await text(result)).toBe('{"entries":["three"]}');
    expect(getBlob).toHaveBeenCalledTimes(3);
    expect(getBlob.mock.lastCall?.[1]?.ifNoneMatch).toBeUndefined();
  });

  it("never substitutes saved data for denied access, missing objects or an unbound 304", async () => {
    const getBlob = vi.fn<typeof get>().mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new Error("Access denied")).mockResolvedValueOnce(null)
      .mockResolvedValueOnce(unchanged()).mockResolvedValueOnce(unchanged());
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
    getBlob.mockResolvedValueOnce(unchanged(versionB)).mockResolvedValueOnce(unchanged(versionB));
    await expect(read(path, options, 1024)).rejects.toThrow("no matching authenticated body");
  });

  it.each([false, true])("recovers an unbound 304 with a fresh authenticated body (warm cache: %s)", async warm => {
    const getBlob = vi.fn<typeof get>();
    if (warm) getBlob.mockResolvedValueOnce(response());
    getBlob.mockResolvedValueOnce(unchanged(versionB)).mockResolvedValueOnce(response("current", versionB));
    const read = createPrivateBlobReadCache({ getBlob });
    if (warm) await text(await read(path, options, 1024));
    expect(await text(await read(path, options, 1024))).toBe("current");
    const attempts = getBlob.mock.calls.slice(warm ? 1 : 0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]![1]).toMatchObject({ token: options.token, access: "private", useCache: false });
    expect(attempts[1]![1]?.ifNoneMatch).toBeUndefined();
    expect(attempts[1]![1]?.abortSignal).toBe(attempts[0]![1]?.abortSignal);
  });

  it("does not substitute the old body when the unconditional recovery is denied", async () => {
    const getBlob = vi.fn<typeof get>().mockResolvedValueOnce(response())
      .mockResolvedValueOnce(unchanged(versionB)).mockRejectedValueOnce(new Error("Access denied"));
    const read = createPrivateBlobReadCache({ getBlob });
    await text(await read(path, options, 1024));
    await expect(read(path, options, 1024)).rejects.toThrow("Access denied");
    expect(getBlob).toHaveBeenCalledTimes(3);
  });

  it("retains the download limit during an unconditional recovery", async () => {
    const getBlob = vi.fn<typeof get>().mockResolvedValueOnce(unchanged())
      .mockResolvedValueOnce(response("too large"));
    const read = createPrivateBlobReadCache({ getBlob });
    await expect(read(path, options, 4)).rejects.toThrow("too-large");
    expect(getBlob).toHaveBeenCalledTimes(2);
  });

  it("does not recover a 304 after the caller cancels", async () => {
    const controller = new AbortController();
    const getBlob = vi.fn<typeof get>().mockImplementationOnce(async () => {
      controller.abort(new Error("Caller stopped"));
      return unchanged();
    });
    const read = createPrivateBlobReadCache({ getBlob });
    await expect(read(path, { ...options, abortSignal: controller.signal }, 1024)).rejects.toThrow("Caller stopped");
    expect(getBlob).toHaveBeenCalledTimes(1);
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

  it("revalidates a newer authenticated body after an older read is cancelled", async () => {
    const controller = new AbortController();
    const updated = '{"entries":["newer"]}';
    let finishOlder!: (value: GetBlobResult) => void;
    const getBlob = vi.fn<typeof get>()
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(() => new Promise(resolve => { finishOlder = resolve; }))
      .mockResolvedValueOnce(response(updated, versionB))
      .mockImplementationOnce(async (_path, request) => request?.ifNoneMatch === versionB ? unchanged(versionB) : response(updated, versionB));
    const onRead = vi.fn();
    const read = createPrivateBlobReadCache({ getBlob, onRead });

    expect(await text(await read(path, options, 1024))).toBe(body);
    const older = read(path, { ...options, abortSignal: controller.signal }, 1024);
    expect(await text(await read(path, options, 1024))).toBe(updated);
    controller.abort(new Error("Read deadline expired"));
    finishOlder(unchanged());
    await expect(older).rejects.toThrow("Read deadline expired");

    expect(await text(await read(path, options, 1024))).toBe(updated);
    expect(getBlob.mock.lastCall?.[1]?.ifNoneMatch).toBe(versionB);
    expect(onRead.mock.calls.map(([event]) => event.kind)).toEqual(["download", "download", "not-modified"]);
  });
});
