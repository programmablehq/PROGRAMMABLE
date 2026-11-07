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
  const launchPreparation = process.env.CUSTOM_AI_GENERAL_LAUNCH_ENABLED === "true" ? "requires-current-review-and-preparation" : "not-enabled";
  const projectPlatform = process.env.CUSTOM_AI_PLATFORM_ENABLED === "true" ? {
    version: 1, state: "enabled", authentication: "wallet-session",
    guide: "/developers/project-platform.md", projects: "/api/custom-ai/platform/projects",
    workModes: ["build", "plan", "test", "deploy"], messageLimit: 24000,
    recovery: "read-saved-run", sourceBinding: "immutable-project-revision",
    files: ["read", "edit", "compare", "restore", "import", "export"],
    sandbox: { lifecycle: "per-run", network: "deny-by-default" },
    connections: { profiles: ["http", "openapi", "oauth-pkce", "remote-mcp", "signed-webhooks"],
      credentials: "private-project-store", actions: "explicit-project-grants" },
    hosting: { configuration: process.env.PROJECT_HOSTING_VERCEL_TOKEN?.trim() ? "provider-check-required" : "missing-credential",
      profiles: ["static", "node-api", "vite"], unsupportedProfiles: ["nextjs-server"], visitorAuthentication: "application-defined" },
    launchPreparation, readiness: "requires-project-checks-and-separate-publication-evidence",
  } : { version: 1, state: "not-enabled" };
  return Response.json({ version: AI_CONFIG.version, chains: builderChains.filter(chain => chain.feeCore).map(chain => chain.id),
    browser: { url: "https://programmable.market/launch/custom-ai", guide: "https://programmable.market/developers/custom-ai-browser.md",
      authentication: "wallet-session", messageLimit: CHAT_MESSAGE_LIMIT, recovery: "read-saved-request", stateAttribute: "data-chat-state" },
    chainScope: "fixed-fee-launches", provider: configuredProvider().id, webResearch: researchAvailable(),
    modelRouting: { scope: "single-configured-provider", automaticProviderFallback: false, tasks: MODEL_TASKS, scenarioPages: SCENARIO_MAX_PAGES },
    protocolKnowledge: { version: PROTOCOL_KNOWLEDGE_VERSION, topics: Object.keys(PROTOCOL_TOPICS), networkRequests: 0 },
    productPlanning: { version: 1, knowledgeVersion: PRODUCT_DESIGN_KNOWLEDGE_VERSION,
      componentKinds: ["token","hook","vault","adapter","automation","indexer","interface"],
      persistence: "owned-intent-revision", sourceBinding: "product-blueprint-hash", functionBindings:"independent-declared-interface",
      allocationExamples: "exact-integer-arithmetic", contractExecution: "separate-verification", serviceDeployment: "not-automatic" },
    dataAdapters: { state:"private-observation-readers", format:"public-https-json", requiresSession:true, credentials:false, generatedCodeExecution:false, automaticOnchainPublication:false,
      maximumToolCalls:AI_CONFIG.maximumLookups,maximumResponseBytes:128000,sharedCacheSeconds:10 },
    executionPreview: { state:"saved-declared-scenarios", environment:"isolated-declared-fixtures", requiresSession:true,
      observations:["return-values","events","native-balance-changes"], maximumRecordedSteps:24, networkRequests:0, additionalExecutions:0, arbitraryScenarioExecution:false },
    productRuntime: {state:process.env.CUSTOM_AI_GENERAL_LAUNCH_ENABLED==="true"?"requested-contract-observations":"not-enabled",requiresSession:true,
      endpoint:"/api/custom-ai/product-runtime",preparationParameter:"id",chains:builderChains.map(chain=>chain.id),
      maximumContracts:16,maximumRPCReadsPerProvider:32,providers:2,cacheSeconds:60,failureBackoffSeconds:15,polling:false,walletActions:false},
    productValues: {state:process.env.CUSTOM_AI_GENERAL_LAUNCH_ENABLED==="true"?"requested-contract-values":"not-enabled",requiresSession:true,
      endpoint:"/api/custom-ai/product-value",parameters:["id","action"],inputs:["none","launch-wallet"],
      maximumRPCReadsPerProvider:4,providers:2,cacheSeconds:10,failureBackoffSeconds:3,requestsPerMinute:30,polling:false,walletActions:false,
      observation:"finalized-block",tokenUnits:"not-inferred"},
    sourceProjects: { chains: builderChains.map(chain => chain.id), requiresSession: true, state: "source-draft", recovery:"complete-file-checkpoints", sourceOutputBudget:AI_CONFIG.maximumContractTokens,
      launchPreparation },
    projectPlatform,
    capabilities: builderCapabilities({ events: process.env.CUSTOM_AI_EVENTS_ENABLED === "true", programs: process.env.CUSTOM_AI_PROGRAMS_ENABLED === "true", generalSources: true }),
    launchReadiness: "Checked for the exact saved draft, network, pair and wallet before launch." }, { headers: aiHeaders });
}
