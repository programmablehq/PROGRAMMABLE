import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { CustomAIError } from "@/lib/custom-ai/types";
import { MAX_TOKEN_IMAGE_UPLOAD_BYTES, PROGRAMMABLE_TOKEN_IMAGE_HOST } from "@/lib/token-image";
import { verifyTokenImageWebpV1 } from "@/lib/server/token-image-webp-v1";
import { readProductionTokenImageBlobV1 } from "@/app/api/token-image/handler";

export const runtime = "nodejs";
export const maxDuration = 30;
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export async function POST(request: Request) {
  try {
    const authority = await authorizeCustomAI(request);
    if (authority.kind !== "account") throw new CustomAIError("auth", "Connect your wallet to continue.", 401);
    if (request.headers.get("content-type") !== "image/webp") throw new CustomAIError("image", "Choose a coin image.", 415);
    const store = productionAIStore();
    await store.consume(authority.owner, "image", 20);
    const reader = request.body?.getReader();
    if (!reader) throw new CustomAIError("image", "Choose a coin image.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_TOKEN_IMAGE_UPLOAD_BYTES) { await reader.cancel(); throw new CustomAIError("image", "Choose a smaller image.", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    await verifyTokenImageWebpV1(bytes);
    const hash = sha(bytes), id = sha(`${authority.owner}:${hash}`);
    const old = await store.readObject<{ id: string; hash: string; url: string }>(authority.owner, "image", id);
    if (old) return Response.json(old.value, { headers: aiHeaders });
    const token = process.env.TOKEN_IMAGE_BLOB_READ_WRITE_TOKEN;
    if (!token) throw new CustomAIError("image", "Image uploads are temporarily unavailable.", 503);
    const pathname = `token-images/custom-ai-${id}.webp`;
    const url = `https://${PROGRAMMABLE_TOKEN_IMAGE_HOST}/${pathname}`;
    try {
      const blob = await put(pathname, bytes, { access: "public", addRandomSuffix: false, allowOverwrite: false,
        cacheControlMaxAge: 31_536_000, contentType: "image/webp", token });
      if (blob.url !== url) throw Error("Unexpected image store");
    } catch { /* A retry may find the same immutable upload already present. Read it back below. */ }
    const readback = await readProductionTokenImageBlobV1({ url, pathname, downloadUrl: url,
      contentType: "image/webp", contentDisposition: "inline", etag: "" }, AbortSignal.timeout(5000));
    if (readback.contentType !== "image/webp" || sha(readback.bytes) !== hash) throw new CustomAIError("image", "The uploaded image could not be verified. Try again.", 503);
    const receipt = { id, hash, url };
    try { await store.saveObject(authority.owner, "image", id, receipt, 0); }
    catch (error) {
      const concurrent = await store.readObject<typeof receipt>(authority.owner, "image", id);
      if (!concurrent || JSON.stringify(concurrent.value) !== JSON.stringify(receipt)) throw error;
    }
    return Response.json(receipt, { headers: aiHeaders });
  } catch (error) { return aiError(error); }
}
