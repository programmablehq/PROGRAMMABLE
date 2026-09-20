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
  website: {
    launch: "https://programmable.market/launch",
    moduleMode: "https://programmable.market/launch/modules",
    buildModule: "https://programmable.market/developers/modules",
    apiKeys: "https://programmable.market/developers/api-keys",
    customLaunchHandoff: "https://programmable.market/developers/api-keys?start=custom&chainId=4663",
    launchHistory: "https://programmable.market/developers/api-keys?view=history",
    explore: "https://programmable.market/explore/robinhood",
    profile: "https://programmable.market/profile",
    manageModuleCoin: "https://programmable.market/launch/modules/manage/{tokenAddress}",
  },
  workflows: {
    customLaunchPlan: {
      chainId: 4663,
      scopes: ["custom-launch:create", "custom-launch:read"],
      manifest: "https://api.programmable.market/v4/chains/4663/custom-launch-contract/manifest.json",
      setup: "https://api.programmable.market/v4/chains/4663/custom-launch-contract/agent-setup.json",
      openApi: "https://programmable.market/openapi/custom-launch-v4.2.json",
      capabilities: "https://api.programmable.market/v4/chains/4663/custom-launch-capabilities",
      availability: "Read the live operation status and bind the manifest digest before packing. Static artifacts do not activate writes.",
    },
    customLaunch: {
      scopes: ["custom-launch:create", "custom-launch:read"],
      guide: "https://programmable.market/developer-reference/custom-launch",
      robinhood: { chainId: 4663, capabilities: "https://api.programmable.market/v4/chains/4663/capabilities", readiness: "https://api.programmable.market/v4/chains/4663/readiness", openApi: "https://programmable.market/openapi/custom-launch-v4.json" },
    },
    multiRoleProject: {
      chainId: 4663,
      scopes: ["custom-launch:create", "custom-launch:read"],
      useWhen: "The token and hook share one physical contract. MultiRole V2 is separate from the existing 4.1 profile.",
      capabilities: "https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities",
      guide: "https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/guide.md",
      client: "https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/client.mjs",
      availability: "Check current capabilities readiness and context before packing or authenticated preflight/create. Published documentation does not imply enabled admission; capabilities may report unavailable.",
      economicAdmission: "Read this historical version's current capabilities and exact source claims. New open plans use the separate Custom Launch Plan contract; optional claim adapters never define that plan's launch eligibility.",
    },
    moduleContribution: {
      available: false,
      scopes: ["modules:submit", "modules:read"],
      guide: "https://programmable.market/developers/module-mode-api-v1.md",
      developerGuide: "https://programmable.market/developer-reference/module-mode",
      capabilities: "https://api.programmable.market/v1/modules/capabilities",
      context: "https://api.programmable.market/v1/modules/context",
      reviewCapabilities: "https://api.programmable.market/v1/modules/review-capabilities",
      submissions: "https://api.programmable.market/v1/modules/submissions",
      reviewStatus: "https://api.programmable.market/v1/modules/submissions/{submissionId}/review",
      cliManifest: "https://programmable.market/developers/module-mode-cli/v1.0.0-development.8/manifest.json",
      engineStarterManifest: "https://programmable.market/developers/module-mode-starters/engine-program/v0.1.0-development.1/manifest.json",
      sourceBuildProfiles: ["programmable.native-solidity@1", "programmable.module-engine-solidity@1"],
      sourceIntake: "Open source packages with versioned runtime and host requirements. There is no required idea category or runtime allowlist for intake. Read context for current limits and separate review adapter coverage.",
      reviewBoundary: "Installed build profiles describe executable review coverage, not eligible ideas. Unknown requirements remain awaiting_plan until the platform supplies a reviewed plan or integration. Submission never grants registry or availability approval.",
      intakeGate: "For uploads, require moduleContributions.submissions from public /v1/modules/capabilities and authorization.canSubmit from keyed /v1/modules/context. Context intake.available reports the same deployment readiness. New key issuance is separate.",
      legacyCapabilityFields: "The root reviewAvailable, approved and available flags in /v1/modules/capabilities remain false for compatibility. They do not gate uploads or report account approval.",
      reviewReadiness: "Read reviewAvailable and statusReadAvailable from /v1/modules/review-capabilities, or review.available and review.statusReadAvailable from context. Review readiness is not an intake gate.",
      receiptStatus: "status-module and submission lists return the immutable intake receipt, including draft_received and unreviewed after review advances. review-status-module reports the current review.state and review.nextAction.",
      authorWalletRequired: true,
      rewardWalletRequired: true,
      authorWalletSource: "authenticated-context",
      rewardWalletDefault: "author",
    },
    moduleLaunch: {
      chainId: 4663,
      availability: "https://programmable.market/api/module-mode",
      website: "https://programmable.market/launch/modules",
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
    "Use this Programmable API key to build custom hooks and read launch status on Robinhood Chain (4663).",
    `Read ${PROGRAMMABLE_AGENT_GUIDE_URL} and ${PROGRAMMABLE_AGENT_DISCOVERY_URL}, then use the current Robinhood Custom Launch Plan contract and capabilities.`,
    "Read the API key from PROGRAMMABLE_API_KEY in the environment or your secret store. Send it only in the Authorization header to https://api.programmable.market. Never print the key or put it in a URL, logs or committed files.",
    input?.scopes ? `This connection was issued with: ${input.scopes.join(", ")}. Check current API authorization on each operation; documentation does not add permissions to a key.` : "Use the key's actual permissions. Read-only keys cannot create launch requests.",
    "Launch history can include requests from other keys and linked wallets in the same account. The key is not isolated to one project; its saved chain restrictions still apply.",
    input?.wallet ? `The controller wallet selected for this connection is ${input.wallet}. Verify it against the launch request before preparing wallet actions.` : "Use the controller wallet selected by the user for the launch request.",
    input?.intent ? `Requested workflow: ${input.intent.trim()}${/[.!?]$/.test(input.intent.trim()) ? "" : "."}` : "Build the custom hook for the user's idea and prepare its launch on Robinhood.",
    "Read live capabilities before a write, preserve exact request bytes and idempotency keys on retries, and distinguish submission, review, deployment and public availability. Wallet signing remains a separate action.",
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
