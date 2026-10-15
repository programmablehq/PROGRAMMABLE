import "server-only";
import { lookup } from "node:dns/promises";
import { get } from "node:https";
import { isIP } from "node:net";

const maxBytes = 1_048_576;

export function publicShareImageAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2)
    || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
    || a === 203 && b === 0 && c === 113);
}

export function shareImageType(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (b.length >= 12 && b.toString("ascii",0,4) === "RIFF" && b.toString("ascii",8,12) === "WEBP") return "image/webp";
  if (b.length >= 6 && ["GIF87a","GIF89a"].includes(b.toString("ascii",0,6))) return "image/gif";
  return null;
}

/** A logo failure is optional. Pin DNS before fetching; never follow redirects or forward credentials. */
export async function readLaunchShareImage(value: string | null | undefined): Promise<string | null> {
  if (!value || value.length > 2048) return null;
  try {
    const url = value.startsWith("/") && !value.startsWith("//") ? new URL(value, "https://programmable.market") : new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(url.hostname)
      || !url.hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) return null;
    const signal = AbortSignal.timeout(7000);
    const records = await Promise.race([
      lookup(url.hostname, { family: 4, all: true }),
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("Image lookup timed out")), { once: true })),
    ]);
    if (!records.length || records.some(record => !publicShareImageAddress(record.address))) return null;
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const request = get(url, { signal, family: 4, headers: { accept: "image/png,image/jpeg,image/webp,image/gif" },
        // Keep HTTPS hostname/SNI validation while connecting only to the checked address.
        lookup: (_hostname, _options, done) => done(null, records[0].address, 4),
      }, response => {
        const contentType = response.headers["content-type"]?.split(";")[0].trim().toLowerCase();
        if (response.statusCode !== 200 || !["image/png","image/jpeg","image/webp","image/gif"].includes(contentType ?? "")
          || Number(response.headers["content-length"] ?? 0) > maxBytes) {
          response.destroy(); reject(new Error("Logo response unavailable")); return;
        }
        const chunks: Buffer[] = []; let size = 0;
        response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) {
          response.destroy(new Error("Logo too large")); return;
        } chunks.push(chunk); });
        response.on("error", reject);
        response.on("end", () => { const result = Buffer.concat(chunks);
          if (shareImageType(result) !== contentType) reject(new Error("Logo type differs")); else resolve(result);
        });
      });
      request.on("error", reject);
    });
    return `data:${shareImageType(bytes)};base64,${bytes.toString("base64")}`;
  } catch { return null; }
}
