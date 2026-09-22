import { PROGRAMMABLE_AGENT_ENTRY } from "@/lib/agent-connection";
import { buildProgrammableAgentSetupTextV1 } from "@/lib/custom-launch/agent-setup-v1";
import { V4_API_PROFILE_VERSION } from "@/lib/custom-launch/v4-api-discovery";

export const dynamic = "force-static";

export function GET() {
  const entry = PROGRAMMABLE_AGENT_ENTRY;
  const content = [
    "# Programmable agent guide",
    "Programmable has two launch experiences: Module Mode composes a coin from reviewed modules, while Custom launches a complete individual project. Public launches use Robinhood. API keys are currently available only for Custom Hook launches.",
    `Machine-readable entry point: ${entry.discoveryUrl}\nCurrent release contracts: ${entry.releaseDiscoveryUrl}\nAll documentation: ${entry.docsIndexUrl}\nFull documentation: ${entry.docsFullUrl}`,
    "## Connect",
    "A connection file uses schema programmable.agent-connection.v1. Read credential.value privately into PROGRAMMABLE_API_KEY; do not print it. Use Authorization: Bearer $PROGRAMMABLE_API_KEY only on https://api.programmable.market. Read guideUrl and discoveryUrl without credentials. The key itself is an opaque credential, not an encoded manual. Its presence does not prove that any particular operation is authorized.",
    "New Custom Hook keys grant custom-launch:create and custom-launch:read. Module API-key issuance and source submissions are currently paused. Existing keys keep their original scopes, wallet binding, expiry and chain restrictions. A scope error is not a reason to rotate or broaden a key automatically. Launch history can include requests from other keys and linked wallets in the same account; the key is not isolated to one project. Its saved chain restrictions still apply. The key cannot sign transactions, move funds, approve modules or change fee recipients.",
    "## Choose the workflow",
    "- Trade a coin: open https://programmable.market/token/TOKEN_ADDRESS?chain=4663 and use the trading panel on its coin page. Choose the direction, enter an amount or use Max, then review the current quote and minimum received. Some tokens require an exact-amount approval before quoting the swap. The connected wallet signs; a pending or unknown transaction must be reconciled before another send. The selected launch needs an executable ETH trading route; non-trading applications do not become swap markets.",
    `- Configure a normal coin: ${entry.website.moduleMode}. Choose the name, symbol, optional image and social links, initial buy and creator swap fees, then optionally add modules. A missing image resolves to the Programmable logo at launch; website, X, Telegram, Discord, GitHub and GitBook links are stored in token metadata. Review and sign with the connected wallet. Read ${entry.workflows.moduleLaunch.availability} for the active engine and catalog. This browser wallet path does not have a generic Module Mode API create endpoint; do not invent one.`,
    `- Build a complete custom hook, token or application: follow the Robinhood Custom API instructions below. The user starts at ${entry.website.launch}; Robinhood wallet handoffs open at ${entry.website.customLaunchHandoff}.`,
    `- Find a coin: ${entry.website.explore}. The creator's coins appear at ${entry.website.profile}. Open ${entry.website.manageModuleCoin} with the actual token address for supported module funding, reward claims, fee claims and creator-recipient controls. These are wallet actions with role checks.`,
    `If the token and hook share one physical contract on Robinhood, use the separate MultiRole V2 lane. Start at ${entry.workflows.multiRoleProject.capabilities}; check its current readiness and context. If unavailable, stop before packing or authenticated submission. Follow ${entry.workflows.multiRoleProject.guide} and the Node 24 client at ${entry.workflows.multiRoleProject.client} for the documented packer and preflight -> create -> status flow. Preserve exact request bytes and the same idempotency key on retries.`,
    "The existing 4.1 profile and CLI remain a separate lane; do not split a shared token/hook or change its profile fields to fit the older graph. MultiRole preflight/create requires custom-launch:create; status/list requires custom-launch:read, with the key's chain 4663 grant and controller binding. Automatic economic recognition currently covers the Native20 recipe. Unknown economics return evidence_required; report the missing evidence without claiming a generic hook audit. API access never grants wallet signing or broadcast authority.",
    "## Index Module Mode launches",
    `For terminal or indexer work, read ${entry.workflows.moduleIndexing.contract} and ${entry.workflows.moduleIndexing.markdown}. The indexer/v1 JSON reference describes Native V1. Native V2 and Engine V1 use their own exact source adapters and release evidence, separate from Custom Router stamps. Verify the source release, receipt, getters, configuration and finality. Preserve unfamiliar module IDs and historical revisions, including valid coins without a market. Explore is a presentation feed; scan the bound source contract for a complete archive.`,
    "## Module contributions",
    "Module API-key issuance and source submissions are currently paused. Launch a coin through the Module Mode website using your connected wallet. Existing coins, trading and claims use their original contracts.",
    "## Fees and ownership",
    "Fee rules are versioned. Native V2 and the Engine V1 quote profile charge 10 bps (0.10%) without eligible families, or 30 bps (0.30%) with them: 10 bps for Programmable and 20 bps shared equally among distinct eligible families. Creator buy/sell fees from 0% to 10% are additional. Quote fees convert to actual received ETH before ledger credit. Native V1 retains its original 20 bps: 10/10 with eligible families, or 20 to Programmable without them. Old claims stay in the original ledger. Non-trading deposits, requests and refunds have no swap fee. Operating budgets and network gas remain separate.",
    "Authorized administrators can replace future creator fee recipients under the existing contract rules. Previously accrued claims, fixed module refund wallets and module-author reward wallets do not move with a CTO. The management interface shows the exact action and wallet before signing.",
    "## Failure recovery",
    "401: check that the intended environment variable is set, and that the key is current. 403 or missing scope: report the actual required permission. 409 idempotency conflict: keep the original request; changed source requires a new version and idempotency key. 429: follow Retry-After. 503 or an unavailable capability: preserve IDs and retry the read later. Never bypass review, substitute a different chain, fabricate approval, or send duplicate launches because of a timeout.",
    `For a website outage, preserve the wallet transaction hash and exact source release. Reconcile the canonical receipt before another send. The existing Native management and Engine clients can verify and prepare actions with the original release evidence and an independent RPC; fee claims use the original ledger and entitled wallet. The contribution CLI does not send wallet transactions. Follow the recovery section at ${entry.workflows.moduleContribution.developerGuide} and keep wallet signing separate.`,
    "## Complete Custom Launch instructions",
    buildProgrammableAgentSetupTextV1(V4_API_PROFILE_VERSION),
  ].join("\n\n");
  return new Response(`${content}\n`, { headers: {
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    "X-Content-Type-Options": "nosniff",
  } });
}
