import { CUSTOM_LAUNCH_ROUTED_FEE_DISCOVERY_V2 } from "./custom-launch/routed-fee-policy-v2";

export const AGENT_KEY_SCHEMA = "programmable.agent-key-management.v1" as const;
export const AGENT_SCOPES = ["custom-launch:create", "custom-launch:read", "modules:submit", "modules:read"] as const;
export const PROGRAMMABLE_AGENT_GUIDE_URL = "https://programmable.market/agents.md";
export const PROGRAMMABLE_AGENT_DISCOVERY_URL = "https://programmable.market/api/agent";

export const PROGRAMMABLE_AGENT_ENTRY = Object.freeze({
  schemaVersion: "programmable.agent-discovery.v1",
  name: "Programmable",
  apiBaseUrl: "https://api.programmable.market",
  guideUrl: PROGRAMMABLE_AGENT_GUIDE_URL,
  discoveryUrl: PROGRAMMABLE_AGENT_DISCOVERY_URL,
  releaseDiscoveryUrl: "https://programmable.market/.well-known/programmable.json",
  docsIndexUrl: "https://programmable.market/llms.txt",
  docsFullUrl: "https://programmable.market/llms-full.txt",
  primaryRobinhoodCreateWorkflow: "customLaunchPlan",
  primaryEthereumCreateWorkflow: "customLaunch",
  website: {
    launch: "https://programmable.market/launch",
    moduleMode: "https://programmable.market/launch/modules",
    apiKeys: "https://programmable.market/developers/api-keys",
    customLaunchHandoff: "https://programmable.market/developers/api-keys?start=custom&chainId=4663",
    launchHistory: "https://programmable.market/developers/api-keys?view=history",
    explore: "https://programmable.market/explore",
    profile: "https://programmable.market/profile",
    manageModuleCoin: "https://programmable.market/launch/modules/manage/{tokenAddress}",
  },
  workflows: {
    customLaunchPlan: {
      chainId: 4663,
      recommendedForNewRobinhoodProjects: true,
      scopes: ["custom-launch:create", "custom-launch:read"],
      manifest: "https://api.programmable.market/v4/chains/4663/custom-launch-contract/manifest.json",
      setup: "https://api.programmable.market/v4/chains/4663/custom-launch-contract/agent-setup.json",
      guide: "https://api.programmable.market/v4/chains/4663/custom-launch-contract/guide.md",
      openApi: "https://api.programmable.market/v4/chains/4663/custom-launch-contract/openapi.json",
      capabilities: "https://api.programmable.market/v4/chains/4663/custom-launch-capabilities",
      tradeFee: CUSTOM_LAUNCH_ROUTED_FEE_DISCOVERY_V2,
      indexing: {
        authenticationRequired: false,
        feed: "https://api.programmable.market/v4/chains/4663/finalized-launch-projections",
        detail: "https://api.programmable.market/v4/chains/4663/finalized-launch-projections/{launchIdOrAddress}",
        openApi: "https://api.programmable.market/v4/chains/4663/custom-launch-contract/openapi.json",
        guide: "https://programmable.market/developer-reference/robinhood-terminal-indexer#custom-launch-plans",
        sourceVersions: ["multi_role_v2", "custom_launch_plan_v1"],
        externalIndexingGuaranteed: false,
      },
      availability: "Read the live operation status and bind the manifest digest before packing. Static artifacts do not activate writes.",
    },
    customLaunch: {
      scopes: ["custom-launch:create", "custom-launch:read"],
      guide: "https://programmable.market/developer-reference/custom-launch",
      ethereum: {
        chainId: 1,
        recommendedForNewProjects: true,
        capabilities: "https://api.programmable.market/v3/capabilities",
        preflight: "https://api.programmable.market/v3/custom-launches/preflight",
        create: "https://api.programmable.market/v3/custom-launches",
        status: "https://api.programmable.market/v3/custom-launches/{launchId}",
        guide: "https://programmable.market/developer-reference/ethereum-custom-hook",
        openApi: "https://programmable.market/openapi/custom-launch-v3.json",
        finalizedMetadata: "https://api.programmable.market/v3/finalized-custom-launches",
        profileAndFeePolicy: "Read the active profile and fee policy from live capabilities before packing.",
      },
      robinhood: { chainId: 4663, recommendedForNewProjects: false, capabilities: "https://api.programmable.market/v4/chains/4663/capabilities", readiness: "https://api.programmable.market/v4/chains/4663/readiness", openApi: "https://programmable.market/openapi/custom-launch-v4.json" },
    },
    multiRoleProject: {
      chainId: 4663,
      scopes: ["custom-launch:create", "custom-launch:read"],
      useWhen: "Existing MultiRole V2 requests and history only. New Robinhood projects use customLaunchPlan even when token and hook share one physical contract.",
      recommendedForNewRobinhoodProjects: false,
      capabilities: "https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities",
      guide: "https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/guide.md",
      client: "https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/client.mjs",
      availability: "Check current capabilities readiness and context before packing or authenticated preflight/create. Published documentation does not imply enabled admission; capabilities may report unavailable.",
      economicAdmission: "Read this historical version's current capabilities and exact source claims. New open plans use the separate Custom Launch Plan contract; optional claim adapters never define that plan's launch eligibility.",
    },
    moduleLaunch: {
      chainId: 4663,
      availability: "https://programmable.market/api/module-mode",
      website: "https://programmable.market/launch/modules",
      transactionAuthority: "connected-wallet",
    },
    foundationModuleLaunch: {
      chainIds: [1, 4663],
      availability: {
        ethereum: "https://programmable.market/api/module-foundation?chainId=1",
        robinhood: "https://programmable.market/api/module-foundation?chainId=4663",
      },
      website: "https://programmable.market/launch/modules",
      indexingGuide: "https://programmable.market/docs/developers/foundation-indexing",
      sourceIdentity: "Use the selected chain's active catalog and exact launch receipt. The token address identifies the coin; module names do not determine indexing.",
      transactionAuthority: "connected-wallet",
    },
    moduleIndexing: {
      chainId: 4663,
      authenticationRequired: false,
      contract: "https://programmable.market/api/module-mode/indexer/v1",
      guide: "https://programmable.market/developer-reference/module-mode-indexing",
      markdown: "https://programmable.market/developers/module-mode-indexing-v1.md",
      sourceIdentity: "Index Native V1, Native V2 and Engine V1 using their exact source-version adapters and installed release evidence. The linked indexer/v1 contract describes Native V1. Module identifiers are configuration, not an allowlist.",
    },
  },
  authentication: {
    environmentVariable: "PROGRAMMABLE_API_KEY",
    header: "Authorization: Bearer $PROGRAMMABLE_API_KEY",
    credentialOrigin: "https://api.programmable.market",
    publicDocsRequireKey: false,
    existingKeyPermissionsUnchanged: true,
  },
});

export function buildAgentInstructions(input?: { scopes?: readonly string[]; wallet?: string; intent?: string }) {
  return [
    "Use this Programmable API key to build custom hooks and read launch status on Ethereum Mainnet (1) or Robinhood Chain (4663). Keep the user's selected chain; if it is missing, ask before building.",
    `Read ${PROGRAMMABLE_AGENT_GUIDE_URL} and ${PROGRAMMABLE_AGENT_DISCOVERY_URL}. Ethereum uses workflows.customLaunch.ethereum and /v3/capabilities; Robinhood uses workflows.customLaunchPlan and /v4/chains/4663/custom-launch-capabilities. Read the selected chain's current profile, packer and fee policy before preparing a request.`,
    "Read the API key from PROGRAMMABLE_API_KEY in the environment or your secret store. Send it only in the Authorization header to https://api.programmable.market. Never print the key or put it in a URL, logs or committed files.",
    input?.scopes ? `This connection was issued with: ${input.scopes.join(", ")}. Check current API authorization on each operation; documentation does not add permissions to a key.` : "Use the key's actual permissions. Read-only keys cannot create launch requests.",
    "Launch history can include requests from other keys and linked wallets in the same account. The key is not isolated to one project; its saved chain restrictions still apply. Verify authorization for the selected chain; do not switch chains to work around a denied request.",
    input?.wallet ? `The controller wallet selected for this connection is ${input.wallet}. Verify it against the launch request before preparing wallet actions.` : "Use the controller wallet selected by the user for the launch request.",
    input?.intent ? `Requested workflow: ${input.intent.trim()}${/[.!?]$/.test(input.intent.trim()) ? "" : "."}` : "Build the custom hook for the user's idea and prepare its launch on the selected chain.",
    "Read live capabilities before a write, preserve exact request bytes and idempotency keys on retries, and distinguish submission, review, deployment and public availability. Wallet signing remains a separate action.",
    "For API health use https://api.programmable.market/readyz and the selected chain's capabilities/readiness. The legacy website /api/ops/health response does not describe current Custom Launch API availability.",
    "For Robinhood plans request Programmable-Launch-Response-Version: 1.2, honor Retry-After on 429/503 and follow the server's continuation. An expired plan needs the documented replan_required flow and a fresh deadline; never reuse an expired wallet permit.",
    "For a Robinhood hook and pool using an existing token, include that token as an exact-source component with a useExisting action and current runtime evidence. Set publication.primaryComponentId to that token component and publication.primaryMarketId to its pool. This retains the existing token address as the public coin identity; the stamp identifies the verified launch and does not imply the token was newly deployed.",
  ].join("\n\n");
}

/** Created only in the browser's one-time reveal; never logged, persisted or sent to a server. */
export function buildAgentConnection(secret: string, input: { scopes: readonly string[]; wallet?: string; launchContract?: { manifestDigest: string; text: string } }) {
  if (!/^pm_live_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("The API key is invalid.");
  return JSON.stringify({
    schemaVersion: "programmable.agent-connection.v1",
    service: "Programmable",
    intro: "Read the guide and discovery URL before using this connection. They explain every supported workflow and where to find its current API contract.",
    apiBaseUrl: PROGRAMMABLE_AGENT_ENTRY.apiBaseUrl,
    guideUrl: PROGRAMMABLE_AGENT_GUIDE_URL,
    discoveryUrl: PROGRAMMABLE_AGENT_DISCOVERY_URL,
    credential: { environmentVariable: "PROGRAMMABLE_API_KEY", value: secret, scopes: input.scopes, ...(input.wallet ? { wallet: input.wallet } : {}) },
    instructions: [buildAgentInstructions(input), input.launchContract?.text].filter(Boolean).join("\n\n"),
    ...(input.launchContract ? { launchContract: { manifestDigest: input.launchContract.manifestDigest,
      manifestUrl: PROGRAMMABLE_AGENT_ENTRY.workflows.customLaunchPlan.manifest } } : {}),
  }, null, 2);
}
