import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { LaunchIntent } from "./launch-intent";

export type BuilderChainId = 1 | 4663 | 8453 | 999;
export type BuilderRoute = "fee-module" | "composed-module" | "custom-contract";

/** Route descriptions are configuration. Discovery and exact preparation still
 * decide whether the selected route can accept a particular launch. */
export const builderChains = [
  { id: 1, name: "Ethereum", currency: "ETH", feeCore: true,
    capabilitiesPath: "/v3/capabilities", preflightPath: "/v3/custom-launches/preflight", createPath: "/v3/custom-launches" },
  { id: 4663, name: "Robinhood", currency: "ETH", feeCore: true,
    capabilitiesPath: "/v4/chains/4663/custom-launch-capabilities", preflightPath: "/v4/chains/4663/custom-launch-plans:preflight", createPath: "/v4/chains/4663/custom-launch-plans" },
  { id: 8453, name: "Base", currency: "ETH", feeCore: false,
    capabilitiesPath: "/v4/chains/8453/capabilities", preflightPath: "/v4/chains/8453/custom-launches/preflight", createPath: "/v4/chains/8453/custom-launches" },
  { id: 999, name: "HyperEVM", currency: "HYPE", feeCore: false,
    capabilitiesPath: "/v4/chains/999/capabilities", preflightPath: "/v4/chains/999/custom-launches/preflight", createPath: "/v4/chains/999/custom-launches" },
] as const;

export function builderChain(chainId: number) {
  const chain = builderChains.find(chain => chain.id === chainId);
  if (!chain) throw new TypeError("Choose a supported launch network.");
  return chain;
}

export type RouteProposal = {
  route: BuilderRoute;
  /** The interpreter proposes coverage; it cannot confer verification. */
  requirementIds: string[];
  missingCapabilities: string[];
};
export type RouteSelection = {
  version: 1;
  id: `sha256:${string}`;
  intentRevision: string;
  chainId: BuilderChainId;
  route: BuilderRoute;
  state: "selected" | "needs-input";
  reason: "complete-template" | "general-contract-requested" | "template-does-not-cover-design" | "no-fee-core-on-network";
  requirementIds: string[];
  openRequirements: { id: string; question: string }[];
  missingCapabilities: string[];
  /** This is a path selection, never a build, approval or wallet permit. */
  launchReady: false;
};

/** Reproduce the choice from saved structured inputs. Unknown or incomplete
 * template coverage selects the general route instead of dropping rules. */
export function selectExecutionRoute(intent: LaunchIntent, chainId: BuilderChainId, proposal?: RouteProposal): RouteSelection {
  const chain = builderChain(chainId);
  if (!intent || intent.version !== 1 || !/^[a-f0-9]{64}$/.test(intent.revision)
    || !Array.isArray(intent.requirements) || intent.requirements.length < 1 || intent.requirements.length > 64
    || new Set(intent.requirements.map(rule => rule.id)).size !== intent.requirements.length) throw new TypeError("Use the complete saved design.");
  const requirementIds = intent.requirements.map(rule => rule.id).sort();
  if (proposal && (!["fee-module", "composed-module", "custom-contract"].includes(proposal.route)
    || !Array.isArray(proposal.requirementIds) || proposal.requirementIds.some(id => !requirementIds.includes(id))
    || new Set(proposal.requirementIds).size !== proposal.requirementIds.length
    || !Array.isArray(proposal.missingCapabilities) || proposal.missingCapabilities.length > 24
    || proposal.missingCapabilities.some(item => typeof item !== "string" || !item.trim() || item.length > 200))) throw new TypeError("The proposed execution route is invalid.");
  const coversAll = proposal?.requirementIds.length === requirementIds.length;
  const route: BuilderRoute = chain.feeCore && proposal && proposal.route !== "custom-contract" && coversAll && !proposal.missingCapabilities.length
    ? proposal.route : "custom-contract";
  const reason: RouteSelection["reason"] = route !== "custom-contract" ? "complete-template"
    : !chain.feeCore ? "no-fee-core-on-network"
      : proposal?.route === "custom-contract" ? "general-contract-requested" : "template-does-not-cover-design";
  const openRequirements = intent.requirements.filter(rule => rule.open !== null).map(rule => ({ id: rule.id, question: rule.open! }));
  // Legacy unresolved entries have no invented requirement owner. Keep them
  // visible and keep the path unready until their provenance is repaired.
  for (const question of intent.unresolved) if (!openRequirements.some(item => item.question === question)) openRequirements.push({ id: "", question });
  openRequirements.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.question < b.question ? -1 : a.question > b.question ? 1 : 0);
  const body = { version: 1 as const, intentRevision: intent.revision, chainId, route, reason, requirementIds,
    state: openRequirements.length ? "needs-input" as const : "selected" as const, openRequirements,
    missingCapabilities: [...new Set(proposal?.missingCapabilities ?? [])].sort(), launchReady: false as const };
  return { ...body, id: canonicalBrowserSha256V2("programmable.custom-ai-route.v1", body) };
}
