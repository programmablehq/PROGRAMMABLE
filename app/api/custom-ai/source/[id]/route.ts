import { productionAIStore } from "@/lib/custom-ai/store.server";
import { aiError } from "@/lib/custom-ai/http.server";
import { canonicalBrowserJsonV2 } from "@/lib/custom-launch/browser-authority-v2";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Only the separately published, immutable source record is public. This
 * route cannot select an account, conversation, job or private project. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-f0-9]{64}$/u.test(id) || new URL(request.url).search)
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const exported = await productionAIStore().projects.readPublicSource(id);
    if (!exported) return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=0, s-maxage=30" } });
    const headers = { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox", "Access-Control-Allow-Origin": "*",
      "Content-Disposition": `attachment; filename="programmable-source-${id}.json"`,
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable", ETag: `"${id}"` };
    if (request.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });
    return new Response(`${canonicalBrowserJsonV2(exported)}\n`, { headers });
  } catch (error) { return aiError(error); }
}
