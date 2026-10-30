import { AI_CONFIG } from "@/lib/custom-ai/ai-config";
import { builderCapabilities } from "@/lib/custom-ai/builder-capabilities";
import { aiHeaders } from "@/lib/custom-ai/http.server";
import { configuredProvider, researchAvailable } from "@/lib/custom-ai/provider-config.server";

export function GET() {
  if (process.env.CUSTOM_AI_PUBLIC_ENABLED !== "true") return Response.json({ error: "Custom AI is not available here yet." }, { status: 404, headers: aiHeaders });
  return Response.json({ version: AI_CONFIG.version, chains: [1, 4663], provider: configuredProvider().id, webResearch: researchAvailable(),
    capabilities: builderCapabilities({ events: process.env.CUSTOM_AI_EVENTS_ENABLED === "true", programs: process.env.CUSTOM_AI_PROGRAMS_ENABLED === "true" }),
    launchReadiness: "Checked for the exact saved draft, network, pair and wallet before launch." }, { headers: aiHeaders });
}
