import { getAddress, isAddress } from "viem";
import { allowLocalPreview, readPreviewBody } from "@/lib/custom-ai/access.server";
import { inspectCustomAIQuote } from "@/lib/custom-ai/quote.server";
import { CustomAIError } from "@/lib/custom-ai/types";

export const runtime = "nodejs";
export const maxDuration = 60;
let active = 0;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    allowLocalPreview(request);
    const input = await readPreviewBody(request) as { chainId?: number; quote?: string };
    if (!input || ![1, 4663].includes(input.chainId ?? 0) || typeof input.quote !== "string" || !isAddress(input.quote)) throw new CustomAIError("input", "Choose a network and quote token.");
    if (active >= 2) throw new CustomAIError("busy", "A quote check is already running.", 429);
    active++;
    try { return Response.json(await inspectCustomAIQuote(input.chainId as 1 | 4663, getAddress(input.quote)), { headers }); }
    finally { active--; }
  } catch (error) {
    const known = error instanceof CustomAIError ? error : new CustomAIError("quote", "The quote check could not finish. Try again shortly.", 503);
    return Response.json({ error: known.message, code: known.code }, { status: known.status, headers });
  }
}
