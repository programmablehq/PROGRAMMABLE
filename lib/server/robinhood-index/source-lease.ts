import "server-only";
import { randomUUID } from "node:crypto";
import { get, put } from "@vercel/blob";
import { readBoundedUtf8BodyV1 } from "../custom-launch/bounded-utf8-body-v1";

// Outlives the route's 180-second platform limit; abandoned leases recover on
// their own. This is a work lease, not cached chain or authorization evidence.
const LEASE_MS = 190_000;
const ETAG = /^"[\da-f]{32}"$/iu;
type LeaseRecord = { version: 1; owner: string; expiresAt: number };

export async function acquireIndexSourceLease(releaseDigest: string, now = Date.now): Promise<(() => Promise<void>) | null> {
  if (!/^0x[\da-f]{64}$/iu.test(releaseDigest)) throw new Error("Invalid index lease identity");
  const token = process.env.OPS_BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new Error("Index lease storage is not configured");
  const path = `website-index/robinhood/source-leases-v1/${releaseDigest.slice(2).toLowerCase()}.json`;
  const read = async () => {
    const response = await get(path, { access: "private", token, useCache: false,
      abortSignal: AbortSignal.timeout(5_000), headers: { "accept-encoding": "identity" } });
    if (!response) return null;
    const etag = response.blob.etag.trim();
    const encoding = response.headers.get("content-encoding");
    if (response.statusCode !== 200 || !response.stream || !ETAG.test(etag) || encoding && encoding !== "identity") {
      void response.stream?.cancel().catch(() => undefined);
      throw new Error("Invalid index lease metadata");
    }
    const value: unknown = JSON.parse(await readBoundedUtf8BodyV1(new Response(response.stream,
      { headers: Array.from(response.headers.entries()) }), 1_024));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid index lease");
    const lease = value as LeaseRecord;
    if (Object.keys(lease).length !== 3 || lease.version !== 1 || !/^[\da-f-]{36}$/iu.test(lease.owner)
      || !Number.isSafeInteger(lease.expiresAt) || lease.expiresAt < 0 || lease.expiresAt > now() + LEASE_MS + 30_000) {
      throw new Error("Invalid index lease");
    }
    return { lease, etag };
  };
  const write = async (lease: LeaseRecord, etag: string | null) => {
    const result = await put(path, JSON.stringify(lease), { token, access: "private", contentType: "application/json",
      addRandomSuffix: false, allowOverwrite: etag !== null, ...(etag ? { ifMatch: etag } : {}),
      cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(5_000) });
    if (!ETAG.test(result.etag)) throw new Error("Invalid index lease version");
    return result.etag;
  };
  const current = await read();
  if (current && current.lease.expiresAt > now()) return null;
  const lease: LeaseRecord = { version: 1, owner: randomUUID(), expiresAt: now() + LEASE_MS };
  let etag: string;
  try { etag = await write(lease, current?.etag ?? null); }
  catch (error) {
    // Resolve both a competing writer and an uncertain successful upload. Never
    // start duplicate work just because the write acknowledgement was lost.
    const observed = await read();
    if (!observed || observed.lease.expiresAt <= now()) throw error;
    if (observed.lease.owner !== lease.owner) return null;
    etag = observed.etag;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    // The original version fences cleanup: it cannot unlock a newer owner.
    await write({ ...lease, expiresAt: 0 }, etag);
  };
}
