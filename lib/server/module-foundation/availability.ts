import { parseFoundationAvailability } from "@/lib/module-foundation/availability";
import { getAddress, type Address } from "viem";

export class FoundationAvailabilityInputError extends Error {}

export function parseFoundationAvailabilityToken(params: URLSearchParams): Address | undefined {
  if ([...params.keys()].some(key => key !== "token") || params.getAll("token").length > 1) {
    throw new FoundationAvailabilityInputError("Use one coin address to check its launch version.");
  }
  const token = params.get("token");
  if (token === null) return undefined;
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(token) || BigInt(token) === 0n || getAddress(token) !== token) throw new Error();
    return token as Address;
  } catch { throw new FoundationAvailabilityInputError("Enter a valid checksummed coin address."); }
}

/** The backend rechecks its installed release, accepted database decision and live runtime/finality evidence. */
export async function readFoundationAvailabilityResponse(fetcher: typeof fetch = fetch, timeoutMs = 12_000, token?: Address): Promise<unknown> {
  if (token !== undefined) parseFoundationAvailabilityToken(new URLSearchParams({ token }));
  const raw = process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL;
  if (!raw) throw new Error("The foundation authority is not configured.");
  const base = new URL(raw);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Invalid foundation authority origin.");
  const endpoint = token === undefined ? "/v1/modules/foundation/availability" : `/v1/modules/foundation/availability/token/${token}`;
  const response = await fetcher(new URL(endpoint, base), {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" },
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
  if (token !== undefined && (value === null || typeof value !== "object" || !("token" in value) || value.token !== token.toLowerCase())) {
    throw new Error("The returned launch version is not bound to this coin.");
  }
  return value;
}
