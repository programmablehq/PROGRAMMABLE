import "server-only";
import sharp from "sharp";
import { readLaunchShareImage } from "@/lib/server/launch-share-image";
import { TOKEN_IMAGE_OUTPUT_SIZE } from "@/lib/token-image";
import { CustomAIError } from "./types";

const invalid = () => new CustomAIError("image", "Use a direct public image link, or upload the image instead.", 422);

/** The existing reader pins public DNS, keeps TLS hostname checks and refuses
 * redirects, credentials, local addresses and responses larger than 1 MiB. */
export async function imageFromLink(value: unknown, read = readLaunchShareImage): Promise<Uint8Array> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join() !== "url") throw invalid();
  const input = (value as { url: unknown }).url;
  if (typeof input !== "string" || input.length > 2048) throw invalid();
  let url: URL;
  try { url = new URL(input); } catch { throw invalid(); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) throw invalid();
  const data = await read(url.href);
  const match = data?.match(/^data:image\/(?:png|jpeg|webp|gif);base64,([a-z0-9+/=]+)$/iu);
  if (!match) throw invalid();
  try {
    const source = Buffer.from(match[1], "base64");
    if (source.byteLength > 1_048_576) throw invalid();
    const pipeline = sharp(source, { animated: true, limitInputPixels: 16_000_000, failOn: "error" });
    const metadata = await pipeline.metadata();
    if ((metadata.pages ?? 1) !== 1 || !["png", "jpeg", "webp", "gif"].includes(metadata.format ?? "")) throw invalid();
    return await pipeline.rotate().resize(TOKEN_IMAGE_OUTPUT_SIZE, TOKEN_IMAGE_OUTPUT_SIZE, { fit: "cover" })
      .webp({ quality: 90, effort: 4 }).toBuffer();
  } catch { throw invalid(); }
}
