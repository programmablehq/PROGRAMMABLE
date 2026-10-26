import encode, { init } from "@jsquash/webp/encode";
import { MAX_TOKEN_IMAGE_UPLOAD_BYTES } from "./token-image";

let ready: ReturnType<typeof init> | undefined;

/** Loaded only when the browser cannot produce a compact WebP itself. */
export async function encodeTokenImageWebp(pixels: ImageData): Promise<Blob> {
  ready ??= init().catch((error: unknown) => { ready = undefined; throw error; });
  await ready;
  for (const quality of [84, 72, 60]) {
    const bytes = await encode(pixels, { quality });
    const blob = new Blob([bytes], { type: "image/webp" });
    if (blob.size <= MAX_TOKEN_IMAGE_UPLOAD_BYTES) return blob;
  }
  throw new Error("The photo is too detailed to upload. Choose a simpler image.");
}
