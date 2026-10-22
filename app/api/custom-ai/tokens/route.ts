import { readCustomAICatalog } from "@/lib/custom-ai/index.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";
export const runtime = "nodejs";
export async function GET() {
  try { return Response.json(await readCustomAICatalog(),{headers:aiHeaders}); }
  catch(error) { return aiError(error); }
}
