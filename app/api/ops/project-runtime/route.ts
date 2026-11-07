import { timingSafeEqual } from "node:crypto";
import { productionDispatchService } from "@/lib/custom-ai/platform/run-production.server";
import { aiHeaders } from "@/lib/custom-ai/http.server";

export const runtime = "nodejs";
export const maxDuration = 180;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET, actual = request.headers.get("authorization");
  if (!secret || secret.length < 32 || !actual || Buffer.byteLength(actual) !== Buffer.byteLength(`Bearer ${secret}`)
    || !timingSafeEqual(Buffer.from(actual), Buffer.from(`Bearer ${secret}`))) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: aiHeaders });
  }
  if (process.env.CUSTOM_AI_PLATFORM_ENABLED !== "true") return Response.json({ disabled: true }, { headers: aiHeaders });
  try {
    const result = await productionDispatchService().dispatchPending(8);
    return Response.json(result, { status: result.failed ? 503 : 200, headers: aiHeaders });
  } catch {
    return Response.json({ error: "Project dispatch unavailable" }, { status: 503, headers: aiHeaders });
  }
}
