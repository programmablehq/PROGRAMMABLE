import { parseFoundationAvailability } from "@/lib/module-foundation/availability";

/** The backend rechecks its installed release, accepted database decision and live runtime/finality evidence. */
export async function readFoundationAvailabilityResponse(fetcher: typeof fetch = fetch): Promise<unknown> {
  const raw = process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL;
  if (!raw) throw new Error("The foundation authority is not configured.");
  const base = new URL(raw);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Invalid foundation authority origin.");
  const response = await fetcher(new URL("/v1/modules/foundation/availability", base), {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" },
  });
  if (!response.ok || response.redirected || !response.headers.get("content-type")?.startsWith("application/json") || !response.body) throw new Error("The foundation authority is unavailable.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 2_097_152) throw new Error("The foundation response is too large.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  parseFoundationAvailability(value);
  return value;
}

