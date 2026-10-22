import { allowLocalPreview, readPreviewBody } from "@/lib/custom-ai/access.server";
import { createLaunchPreviewGate, prepareLaunchPreview } from "@/lib/custom-ai/preview.server";
import { CustomAIError } from "@/lib/custom-ai/types";

export const runtime = "nodejs";
export const maxDuration = 60;
const gate = createLaunchPreviewGate();

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    allowLocalPreview(request);
    const input = await readPreviewBody(request);
    const preview = await gate(input, () => prepareLaunchPreview(input, request.signal));
    return Response.json(preview, { headers });
  } catch (error) {
    const known = error instanceof CustomAIError ? error : new CustomAIError("unavailable", "The launch check could not finish. Try again.", 503);
    return Response.json({ error: known.message, code: known.code }, { status: known.status, headers });
  }
}
