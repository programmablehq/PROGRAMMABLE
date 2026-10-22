import { timingSafeEqual } from "node:crypto";
import { syncCustomAIIndex } from "@/lib/custom-ai/index.server";
import { aiHeaders } from "@/lib/custom-ai/http.server";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET, actual = request.headers.get("authorization");
  if (!secret || secret.length < 32 || !actual || Buffer.byteLength(actual) !== Buffer.byteLength(`Bearer ${secret}`)
    || !timingSafeEqual(Buffer.from(actual),Buffer.from(`Bearer ${secret}`))) return Response.json({error:"unauthorized"},{status:401,headers:aiHeaders});
  const results = await Promise.all(([1,4663] as const).map(async chainId => {
    let added = 0, batches = 0;
    const deadline = Date.now() + 40_000;
    try {
      let result;
      do {
        result = await syncCustomAIIndex(chainId);
        added += result.added;
        batches++;
      } while (result.status === "syncing" && batches < 8 && Date.now() < deadline);
      return {chainId,status:result.status,added,batches};
    } catch { return {chainId,status:"unavailable",added,batches}; }
  }));
  return Response.json({results},{status:results.some(row=>row.status === "unavailable") ? 503 : 200,headers:aiHeaders});
}
