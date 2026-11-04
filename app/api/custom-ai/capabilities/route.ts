import { AI_CONFIG } from "@/lib/custom-ai/ai-config";
import { builderCapabilities } from "@/lib/custom-ai/builder-capabilities";
import { aiHeaders } from "@/lib/custom-ai/http.server";
import { configuredProvider, researchAvailable } from "@/lib/custom-ai/provider-config.server";
import { builderChains } from "@/lib/custom-ai/execution-routing";
import { CHAT_MESSAGE_LIMIT } from "@/lib/custom-ai/workspace-state";
import {MODEL_TASKS,SCENARIO_MAX_PAGES} from "@/lib/custom-ai/model-tasks";
import {PROTOCOL_KNOWLEDGE_VERSION,PROTOCOL_TOPICS} from "@/lib/custom-ai/protocol-knowledge";
import {PRODUCT_DESIGN_KNOWLEDGE_VERSION} from "@/lib/custom-ai/product/design-knowledge";

export function GET() {
  if (process.env.CUSTOM_AI_PUBLIC_ENABLED !== "true") return Response.json({ error: "Custom AI is not available here yet." }, { status: 404, headers: aiHeaders });
  return Response.json({ version: AI_CONFIG.version, chains: builderChains.filter(chain => chain.feeCore).map(chain => chain.id),
    browser: { url: "https://programmable.market/launch/custom-ai", guide: "https://programmable.market/developers/custom-ai-browser.md",
      authentication: "wallet-session", messageLimit: CHAT_MESSAGE_LIMIT, recovery: "read-saved-request", stateAttribute: "data-chat-state" },
    chainScope: "fixed-fee-launches", provider: configuredProvider().id, webResearch: researchAvailable(),
    modelRouting: { scope: "single-configured-provider", automaticProviderFallback: false, tasks: MODEL_TASKS, scenarioPages: SCENARIO_MAX_PAGES },
    protocolKnowledge: { version: PROTOCOL_KNOWLEDGE_VERSION, topics: Object.keys(PROTOCOL_TOPICS), networkRequests: 0 },
    productPlanning: { version: 1, knowledgeVersion: PRODUCT_DESIGN_KNOWLEDGE_VERSION,
      componentKinds: ["token","hook","vault","adapter","automation","indexer","interface"],
      persistence: "owned-intent-revision", sourceBinding: "product-blueprint-hash",
      allocationExamples: "exact-integer-arithmetic", contractExecution: "separate-verification", serviceDeployment: "not-automatic" },
    dataAdapters: { state:"private-observation-readers", format:"public-https-json", requiresSession:true, credentials:false, generatedCodeExecution:false, automaticOnchainPublication:false,
      maximumToolCalls:AI_CONFIG.maximumLookups,maximumResponseBytes:128000,sharedCacheSeconds:10 },
    sourceProjects: { chains: builderChains.map(chain => chain.id), requiresSession: true, state: "source-draft", recovery:"complete-file-checkpoints", sourceOutputBudget:AI_CONFIG.maximumContractTokens,
      launchPreparation: process.env.CUSTOM_AI_GENERAL_LAUNCH_ENABLED === "true" ? "requires-current-review-and-preparation" : "not-enabled" },
    capabilities: builderCapabilities({ events: process.env.CUSTOM_AI_EVENTS_ENABLED === "true", programs: process.env.CUSTOM_AI_PROGRAMS_ENABLED === "true", generalSources: true }),
    launchReadiness: "Checked for the exact saved draft, network, pair and wallet before launch." }, { headers: aiHeaders });
}
