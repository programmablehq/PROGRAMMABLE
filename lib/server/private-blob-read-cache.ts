import "server-only";

import { createHash } from "node:crypto";
import { get, head, type GetBlobResult } from "@vercel/blob";
import { readBoundedUtf8BodyV1 } from "./custom-launch/bounded-utf8-body-v1";

type FullBlob = Extract<GetBlobResult, { statusCode: 200 }>;
type ReadOptions = Readonly<{ token: string; abortSignal?: AbortSignal }>;
type SavedBody = Readonly<{
  text: string;
  bytes: number;
  weight: number;
  headers: Headers;
  blob: FullBlob["blob"];
  compressed: boolean;
}>;
type ReadEvent = Readonly<{
  kind: "download" | "not-modified" | "metadata-not-modified" | "shared";
  bytes: number;
  compressed?: true;
}>;
type PendingBody = {
  controller: AbortController;
  promise: Promise<SavedBody | null>;
  readers: number;
};

const STRONG_ETAG = /^"[\da-f]{32}"$/iu;

async function waitForBody(promise: PendingBody["promise"], signal: AbortSignal, release: () => void) {
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => {
      release();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    const body = await Promise.race([promise, cancelled]);
    signal.throwIfAborted();
    return body;
  } finally {
    signal.removeEventListener("abort", onAbort);
    release();
  }
}

/** Reuse requires an authenticated origin 304 confirming the saved version. */
export function createPrivateBlobReadCache(input: Readonly<{
  getBlob?: typeof get;
  headBlob?: typeof head;
  maximumCacheBytes?: number;
  maximumEntries?: number;
  onRead?: (event: ReadEvent) => void;
}> = {}) {
  const getBlob = input.getBlob ?? get;
  const maximumCacheBytes = input.maximumCacheBytes ?? 32 * 1024 * 1024;
  const maximumEntries = input.maximumEntries ?? 64;
  const bodies = new Map<string, SavedBody>();
  const pending = new Map<string, PendingBody>();
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

  const fetchBody = async (key: string, path: string, token: string, maximumBytes: number, signal: AbortSignal) => {
    const previous = bodies.get(key);
    const forgetObservedBody = () => {
      if (bodies.get(key) === previous) forget(key);
    };
    const readMetadata = () => (input.headBlob ?? head)(path, {
      token, abortSignal: signal,
    }).catch(() => null);
    const readOrigin = (encoding: "gzip" | "identity", etag?: string) => getBlob(path, {
      access: "private", token, useCache: false,
      headers: { "accept-encoding": encoding }, abortSignal: signal,
      ...(etag ? { ifNoneMatch: etag } : {}),
    });

    const readBody = async (result: FullBlob, allowGzip: boolean): Promise<SavedBody | null> => {
      const headers = new Headers(Array.from(result.headers.entries()));
      const encoding = headers.get("content-encoding")?.toLowerCase() ?? "identity";
      const compressed = allowGzip && encoding === "gzip";
      const etag = compressed ? result.blob.etag.replace(/^W\//u, "") : result.blob.etag;
      if (encoding !== "identity" && (!compressed || !STRONG_ETAG.test(etag))) {
        void result.stream.cancel().catch(() => undefined);
        return null;
      }
      const metadata = compressed ? readMetadata() : null;
      const text = await readBoundedUtf8BodyV1(
        new Response(result.stream, { headers }), maximumBytes, { signal },
      );
      signal.throwIfAborted();
      const bytes = Buffer.byteLength(text, "utf8");
      let blob = { ...result.blob };
      if (metadata) {
        const canonical = await metadata;
        signal.throwIfAborted();
        // The SDK returns a decoded stream and a weak representation ETag for
        // gzip. Bind the decoded bytes to the canonical origin version before
        // returning a tag that callers can use for a conditional write.
        const bodyEtag = `"${createHash("md5").update(text, "utf8").digest("hex")}"`;
        if (canonical?.pathname !== path || canonical.etag !== etag
          || canonical.size !== bytes || bodyEtag !== etag) return null;
        headers.delete("content-encoding");
        headers.set("content-length", String(bytes));
        headers.set("etag", canonical.etag);
        blob = { ...blob, size: canonical.size, etag: canonical.etag };
      }
      return { text, bytes, weight: text.length * 2, headers, blob, compressed };
    };

    const read = async (): Promise<SavedBody | null> => {
      let result = await readOrigin("gzip", previous?.blob.etag);
      signal.throwIfAborted();
      if (result?.statusCode === 304) {
        if (previous) {
          let metadataMatches = false;
          // The Blob origin can omit the ETag on a conditional hit. The
          // authenticated metadata endpoint can confirm that exact version.
          if ((result.blob.etag === "" && !result.headers.has("etag"))
            || result.blob.etag === `W/${previous.blob.etag}`) {
            const metadata = await readMetadata();
            signal.throwIfAborted();
            metadataMatches = metadata !== null
              && metadata.etag === previous.blob.etag
              && metadata.pathname === previous.blob.pathname
              && metadata.size === previous.bytes;
          }
          if (result.blob.etag === previous.blob.etag || metadataMatches) {
            if (bodies.get(key) === previous) remember(key, previous);
            input.onRead?.({
              kind: metadataMatches ? "metadata-not-modified" : "not-modified",
              bytes: previous.bytes,
            });
            return previous;
          }
        }
        // An unbound 304 cannot authenticate a saved body. Fetch the current
        // representation once, using the same credential and deadline.
        forgetObservedBody();
        result = await readOrigin("gzip");
        signal.throwIfAborted();
        if (result?.statusCode === 304) {
          throw new Error("Blob 304 has no matching authenticated body");
        }
      }
      if (!result) {
        forgetObservedBody();
        return null;
      }
      let body = await readBody(result, true);
      if (!body) {
        forgetObservedBody();
        const identity = await readOrigin("identity");
        signal.throwIfAborted();
        if (!identity) return null;
        if (identity.statusCode !== 200) throw new Error("Blob identity read did not return a body");
        body = await readBody(identity, false);
        if (!body) throw new Error("Blob identity response uses an unsupported encoding");
      }
      const length = body.headers.get("content-length");
      // Malformed representations still reach the caller's existing validator,
      // but can never become a reusable authenticated body.
      if (STRONG_ETAG.test(body.blob.etag)
        && (length === null || Number(length) === body.bytes)) remember(key, body);
      else forgetObservedBody();
      input.onRead?.({ kind: "download", bytes: body.bytes, ...(body.compressed && { compressed: true as const }) });
      return body;
    };
    return read().catch(error => {
      if (!signal.aborted) forgetObservedBody();
      throw error;
    });
  };

  return async (path: string, options: ReadOptions, maximumBytes: number): Promise<GetBlobResult | null> => {
    const signal = options.abortSignal ?? AbortSignal.timeout(5_000);
    signal.throwIfAborted();
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new TypeError("Invalid Blob read size limit");
    }
    // Credentials, paths and body limits define distinct read scopes.
    const key = `${createHash("sha256").update(options.token).digest("hex")}:${maximumBytes}:${path}`;
    let task = pending.get(key);
    const shared = task !== undefined;
    if (!task) {
      const controller = new AbortController();
      const created: PendingBody = {
        controller,
        readers: 0,
        promise: Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return fetchBody(key, path, options.token, maximumBytes, controller.signal);
        }).finally(() => {
          if (pending.get(key) === created) pending.delete(key);
        }),
      };
      pending.set(key, created);
      task = created;
    }
    task.readers++;
    let reading = true;
    const release = () => {
      if (!reading) return;
      reading = false;
      task.readers--;
      if (task.readers === 0 && pending.get(key) === task) {
        pending.delete(key);
        task.controller.abort(signal.reason);
      }
    };
    const body = await waitForBody(task.promise, signal, release);
    if (shared && body) input.onRead?.({ kind: "shared", bytes: body.bytes });
    return replay(body);
  };
}

let lastReportedAt = 0;
let downloadedBytes = 0;
let avoidedBytes = 0;
let revalidatedReads = 0;
let sharedReads = 0;
let metadataConfirmedReads = 0;
let metadataAvoidedBytes = 0;
let compressedReads = 0;
let compressedDecodedBytes = 0;
export const getRevalidatedPrivateBlob = createPrivateBlobReadCache({
  onRead(event) {
    if (event.kind === "download") {
      downloadedBytes += event.bytes;
      if (event.compressed) {
        compressedReads++;
        compressedDecodedBytes += event.bytes;
      }
    } else {
      avoidedBytes += event.bytes;
      if (event.kind === "shared") sharedReads++;
      else revalidatedReads++;
      if (event.kind === "metadata-not-modified") {
        metadataConfirmedReads++;
        metadataAvoidedBytes += event.bytes;
      }
    }
    if (avoidedBytes > 0 && Date.now() - lastReportedAt >= 60_000) {
      console.info("private-blob-read-cache", {
        downloadedBytes, avoidedBytes, revalidatedReads, sharedReads,
        metadataConfirmedReads, metadataAvoidedBytes, compressedReads, compressedDecodedBytes,
      });
      lastReportedAt = Date.now();
      downloadedBytes = avoidedBytes = revalidatedReads = sharedReads = 0;
      metadataConfirmedReads = metadataAvoidedBytes = 0;
      compressedReads = compressedDecodedBytes = 0;
    }
  },
});
