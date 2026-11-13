import { parseSnapshot, type RobinhoodSnapshot } from "./model";
import { BoundedBodyErrorV1, readBoundedUtf8BodyV1 } from "../custom-launch/bounded-utf8-body-v1";

const PATH = "website-index/robinhood/launches-v1.json";
const MAX_BYTES = 16 * 1024 * 1024;

export type IndexStore = {
  read(): Promise<{ snapshot: RobinhoodSnapshot; etag: string } | null>;
  write(snapshot: RobinhoodSnapshot, etag: string | null): Promise<void>;
};

export function indexStore(signal?: AbortSignal): IndexStore {
  const token = process.env.OPS_BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new Error("Robinhood index storage is not configured");
  return {
    async read() {
      signal?.throwIfAborted();
      const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5_000)]);
      const { get } = await import("@vercel/blob");
      // A compressed response has a weak representation ETag, which cannot
      // authorize an object overwrite. Get body and strong ETag atomically.
      const result = await get(PATH, { access: "private", token, useCache: false, abortSignal: deadline,
        headers: { "accept-encoding": "identity" } });
      if (!result) return null;
      if (result.statusCode !== 200 || !result.stream) throw new Error("Robinhood index read failed");
      const etag = result.blob.etag.trim();
      // Bind the body and the conditional-write ETag to one response. A second
      // metadata read can observe a different upload while the cron is writing.
      const encoded = result.headers.get("content-encoding");
      const length = result.headers.get("content-length");
      const expectedSize = length === null ? null : Number(length);
      if ((encoded && encoded !== "identity") || !/^"[\da-f]{32}"$/i.test(etag) || (expectedSize !== null
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
      parseSnapshot(snapshot);
      const body = JSON.stringify(snapshot);
      if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("Robinhood index size exceeded");
      const { put } = await import("@vercel/blob");
      signal?.throwIfAborted();
      await put(PATH, body, {
        token, access: "private", contentType: "application/json", addRandomSuffix: false,
        abortSignal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5_000)]),
        allowOverwrite: etag !== null, ...(etag === null ? {} : { ifMatch: etag }), cacheControlMaxAge: 60,
      });
    },
  };
}
