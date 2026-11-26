import { parseSnapshot, type RobinhoodSnapshot } from "./model";
import { BoundedBodyErrorV1, readBoundedUtf8BodyV1 } from "../custom-launch/bounded-utf8-body-v1";
import { getRevalidatedPrivateBlob } from "../private-blob-read-cache";

const PATH = "website-index/robinhood/launches-v1.json";
const MAX_BYTES = 16 * 1024 * 1024;
const STRONG_ETAG = /^"[\da-f]{32}"$/iu;

export type IndexStore = {
  read(): Promise<{ snapshot: RobinhoodSnapshot; etag: string } | null>;
  write(snapshot: RobinhoodSnapshot, etag: string | null): Promise<void>;
};

export function indexStore(signal?: AbortSignal, options: {
  reuseCommittedSnapshot?: boolean;
  onCommittedRead?: () => void;
} = {}): IndexStore {
  const token = process.env.OPS_BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new Error("Robinhood index storage is not configured");
  let committed: { snapshot: RobinhoodSnapshot; etag: string } | undefined;
  let writeSequence = 0;
  return {
    async read() {
      signal?.throwIfAborted();
      if (committed) {
        options.onCommittedRead?.();
        return { snapshot: structuredClone(committed.snapshot), etag: committed.etag };
      }
      const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5_000)]);
      // A compressed response has a weak representation ETag, which cannot
      // authorize an object overwrite. Get body and strong ETag atomically.
      let result;
      try {
        result = await getRevalidatedPrivateBlob(PATH, { token, abortSignal: deadline }, MAX_BYTES);
      } catch (error) {
        if (error instanceof BoundedBodyErrorV1 && error.code === "too-large") throw new Error("Robinhood index size exceeded");
        throw error;
      }
      if (!result) return null;
      if (result.statusCode !== 200 || !result.stream) throw new Error("Robinhood index read failed");
      const etag = result.blob.etag.trim();
      // Bind the body and the conditional-write ETag to one response. A second
      // metadata read can observe a different upload while the cron is writing.
      const encoded = result.headers.get("content-encoding");
      const length = result.headers.get("content-length");
      const expectedSize = length === null ? null : Number(length);
      if ((encoded && encoded !== "identity") || !STRONG_ETAG.test(etag) || (expectedSize !== null
        && (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_BYTES))) {
        void result.stream.cancel().catch(() => undefined);
        throw new Error("Robinhood index response metadata invalid");
      }
      let text: string;
      try {
        text = await readBoundedUtf8BodyV1(new Response(result.stream, { headers: Array.from(result.headers.entries()) }), MAX_BYTES,
          { signal: deadline });
      } catch (error) {
        if (error instanceof BoundedBodyErrorV1 && error.code === "too-large") throw new Error("Robinhood index size exceeded");
        throw error;
      }
      signal?.throwIfAborted();
      const size = Buffer.byteLength(text);
      if (expectedSize !== null && size !== expectedSize) throw new Error("Robinhood index size mismatch");
      return { snapshot: parseSnapshot(JSON.parse(text)), etag };
    },
    async write(snapshot, etag) {
      signal?.throwIfAborted();
      // A conflict or lost acknowledgement must send the next read to the
      // origin so lane reconciliation sees the actual winning version.
      committed = undefined;
      const sequence = ++writeSequence;
      parseSnapshot(snapshot);
      const body = JSON.stringify(snapshot);
      if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("Robinhood index size exceeded");
      const uploadedSnapshot = options.reuseCommittedSnapshot ? parseSnapshot(JSON.parse(body)) : undefined;
      const { put } = await import("@vercel/blob");
      signal?.throwIfAborted();
      const uploaded = await put(PATH, body, {
        token, access: "private", contentType: "application/json", addRandomSuffix: false,
        abortSignal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5_000)]),
        allowOverwrite: etag !== null, ...(etag === null ? {} : { ifMatch: etag }), cacheControlMaxAge: 60,
      });
      if (uploadedSnapshot && uploaded?.pathname === PATH && STRONG_ETAG.test(uploaded.etag)
        && sequence === writeSequence && !signal?.aborted) {
        committed = { snapshot: uploadedSnapshot, etag: uploaded.etag };
      }
    },
  };
}
