import { AI_CONFIG } from "@/lib/custom-ai/ai-config";
import { builderCapabilities } from "@/lib/custom-ai/builder-capabilities";
import { aiHeaders } from "@/lib/custom-ai/http.server";
import { configuredProvider, researchAvailable } from "@/lib/custom-ai/provider-config.server";
import { builderChains } from "@/lib/custom-ai/execution-routing";
import { CHAT_MESSAGE_LIMIT } from "@/lib/custom-ai/workspace-state";

export function GET() {
  if (process.env.CUSTOM_AI_PUBLIC_ENABLED !== "true") return Response.json({ error: "Custom AI is not available here yet." }, { status: 404, headers: aiHeaders });
  return Response.json({ version: AI_CONFIG.version, chains: builderChains.filter(chain => chain.feeCore).map(chain => chain.id),
    browser: { url: "https://programmable.market/launch/custom-ai", guide: "https://programmable.market/developers/custom-ai-browser.md",
      authentication: "wallet-session", messageLimit: CHAT_MESSAGE_LIMIT, recovery: "read-saved-request", stateAttribute: "data-chat-state" },
    chainScope: "fixed-fee-launches", provider: configuredProvider().id, webResearch: researchAvailable(),
    sourceProjects: { chains: builderChains.map(chain => chain.id), requiresSession: true, state: "source-draft",
      launchPreparation: process.env.CUSTOM_AI_GENERAL_LAUNCH_ENABLED === "true" ? "requires-current-review-and-preparation" : "not-enabled" },
    capabilities: builderCapabilities({ events: process.env.CUSTOM_AI_EVENTS_ENABLED === "true", programs: process.env.CUSTOM_AI_PROGRAMS_ENABLED === "true", generalSources: true }),
    launchReadiness: "Checked for the exact saved draft, network, pair and wallet before launch." }, { headers: aiHeaders });
}
