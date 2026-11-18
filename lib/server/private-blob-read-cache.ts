import "server-only";

import { createHash } from "node:crypto";
import { get, type GetBlobResult } from "@vercel/blob";
import { readBoundedUtf8BodyV1 } from "./custom-launch/bounded-utf8-body-v1";

type FullBlob = Extract<GetBlobResult, { statusCode: 200 }>;
type ReadOptions = Readonly<{ token: string; abortSignal?: AbortSignal }>;
type SavedBody = Readonly<{
  text: string;
  bytes: number;
  weight: number;
  headers: Headers;
  blob: FullBlob["blob"];
}>;
type ReadEvent = Readonly<{
  kind: "download" | "not-modified" | "shared";
  bytes: number;
}>;

const STRONG_ETAG = /^"[\da-f]{32}"$/iu;

/** Cached bodies are used only after an authenticated origin 304, never by age. */
export function createPrivateBlobReadCache(input: Readonly<{
  getBlob?: typeof get;
  maximumCacheBytes?: number;
  maximumEntries?: number;
  onRead?: (event: ReadEvent) => void;
}> = {}) {
  const getBlob = input.getBlob ?? get;
  const maximumCacheBytes = input.maximumCacheBytes ?? 32 * 1024 * 1024;
  const maximumEntries = input.maximumEntries ?? 64;
  const bodies = new Map<string, SavedBody>();
  const pending = new Map<string, Promise<SavedBody | null>>();
  let retainedBytes = 0;

  const forget = (key: string) => {
    const previous = bodies.get(key);
    if (previous) retainedBytes -= previous.weight;
    bodies.delete(key);
  };
  const remember = (key: string, body: SavedBody) => {
    forget(key);
    if (body.weight > maximumCacheBytes || maximumEntries < 1) return;
    bodies.set(key, body);
    retainedBytes += body.weight;
    while (bodies.size > maximumEntries || retainedBytes > maximumCacheBytes) {
      forget(bodies.keys().next().value!);
    }
  };
  const replay = (body: SavedBody | null): GetBlobResult | null => body && ({
    statusCode: 200,
    stream: new Response(body.text).body!,
    headers: new Headers(body.headers),
    blob: { ...body.blob },
  });

  return async (path: string, options: ReadOptions, maximumBytes: number): Promise<GetBlobResult | null> => {
    options.abortSignal?.throwIfAborted();
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new TypeError("Invalid Blob read size limit");
    }
    // Credentials never appear in cache keys, metrics or logs. Different
    // credentials, paths and body limits cannot share a stored response.
    const key = `${createHash("sha256").update(options.token).digest("hex")}:${maximumBytes}:${path}`;
    const shared = options.abortSignal ? undefined : pending.get(key);
    if (shared) {
      const body = await shared;
      if (body) input.onRead?.({ kind: "shared", bytes: body.bytes });
      return replay(body);
    }

    const read = async (): Promise<SavedBody | null> => {
      const previous = bodies.get(key);
      const signal = options.abortSignal ?? AbortSignal.timeout(5_000);
      const requestOptions = {
        access: "private", token: options.token, useCache: false,
        headers: { "accept-encoding": "identity" },
        abortSignal: signal,
      } as const;
      let result = await getBlob(path, {
        ...requestOptions,
        ...(previous ? { ifNoneMatch: previous.blob.etag } : {}),
      });
      signal.throwIfAborted();
      if (result?.statusCode === 304 && (!previous || result.blob.etag !== previous.blob.etag)) {
        // An unbound 304 cannot authenticate a saved body. Fetch the current
        // representation once, using the same credential and deadline.
        forget(key);
        result = await getBlob(path, requestOptions);
        signal.throwIfAborted();
        if (result?.statusCode === 304) {
          throw new Error("Blob 304 has no matching authenticated body");
        }
      }
      if (!result) {
        forget(key);
        return null;
      }
      if (result.statusCode === 304) {
        if (!previous || result.blob.etag !== previous.blob.etag) {
          forget(key);
          throw new Error("Blob 304 has no matching authenticated body");
        }
        remember(key, previous);
        input.onRead?.({ kind: "not-modified", bytes: previous.bytes });
        return previous;
      }
      const headers = new Headers(Array.from(result.headers.entries()));
      const text = await readBoundedUtf8BodyV1(
        new Response(result.stream, { headers }), maximumBytes,
        { signal },
      );
      options.abortSignal?.throwIfAborted();
      const bytes = Buffer.byteLength(text, "utf8");
      const body = {
        text, bytes, weight: text.length * 2,
        headers, blob: { ...result.blob },
      };
      const encoding = result.headers.get("content-encoding");
      const length = result.headers.get("content-length");
      // Malformed representations still reach the caller's existing validator,
      // but can never become a reusable authenticated body.
      if (STRONG_ETAG.test(result.blob.etag) && (!encoding || encoding === "identity")
        && (length === null || Number(length) === bytes)) remember(key, body);
      else forget(key);
      input.onRead?.({ kind: "download", bytes });
      return body;
    };
    const task = read().catch(error => { forget(key); throw error; });
    // A caller with its own cancellation signal owns that read. Joining it
    // would let that caller's cancellation terminate another reader's work.
    if (!options.abortSignal) pending.set(key, task);
    try { return replay(await task); }
    finally { if (pending.get(key) === task) pending.delete(key); }
  };
}

let lastReportedAt = 0;
let downloadedBytes = 0;
let avoidedBytes = 0;
let revalidatedReads = 0;
let sharedReads = 0;
export const getRevalidatedPrivateBlob = createPrivateBlobReadCache({
  onRead(event) {
    if (event.kind === "download") downloadedBytes += event.bytes;
    else {
      avoidedBytes += event.bytes;
      if (event.kind === "not-modified") revalidatedReads++;
      else sharedReads++;
    }
    if (avoidedBytes > 0 && Date.now() - lastReportedAt >= 60_000) {
      console.info("private-blob-read-cache", {
        downloadedBytes, avoidedBytes, revalidatedReads, sharedReads,
      });
      lastReportedAt = Date.now();
      downloadedBytes = avoidedBytes = revalidatedReads = sharedReads = 0;
    }
  },
});
