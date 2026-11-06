import { builderChain, type BuilderChainId } from "./execution-routing";
/** Shared product vocabulary. Configuration never certifies a funded, live service. */
export function builderCapabilities(configuration: { events: boolean; programs: boolean; generalSources?: boolean; chainId?:BuilderChainId }) {
  const feeCore=configuration.chainId===undefined||builderChain(configuration.chainId).feeCore;
  return [
    { id: "fee-schedules", version: 1, state: feeCore?"buildable":configuration.generalSources?"source-draft":"design-only", description: feeCore
      ? "Different buy/sell fees, countdowns, ramps and schedules; total fees 0.5–15%."
      : "Fee schedules on this network use general Custom Contract source and its separate verification, review and preparation." },
    { id: "hook-research", version: 1, state: "research", description: "Search existing hooks and discuss mechanics. Finding a hook does not install or audit it." },
    { id: "fee-allocation-planning", version: 1, state: "design-only", description: "This local tool checks fee-split arithmetic and preserves liquidity, buyback/burn and holder requirements. It does not execute transfers. Use the general contract source builder to implement the complete mechanism; actual execution still needs matching contracts, checks and selected-chain preparation." },
    { id: "protocol-knowledge", version: 1, state: "research", description: "Local versioned v4 knowledge: callbacks, routing, accounting, external data, composition and evidence limits. Pinned contract interfaces are supplied before planning; no network lookup is needed." },
    { id: "external-events", version: 1, state: configuration.events && feeCore ? "requires-live-check" : "design-only", description: "Weather or market rules need a connected, verified feed on the selected chain." },
    { id: "fee-programs", version: 1, state: configuration.programs && feeCore ? "requires-live-check" : "design-only", description: "Fee-funded staking, distributions, buybacks and locked liquidity need a deployed program; automatic execution also needs a running, funded service." },
    { id: "arbitrary-hooks", version: 1, state: configuration.generalSources ? "source-draft" : "design-only", description: configuration.generalSources
      ? "General contract source can be generated, saved and compiled. Behavior verification, Custom Launch review and exact network preparation still determine readiness."
      : "Arbitrary stateful v4 hooks can be designed here but cannot bypass this builder's fixed core or launch as a fee module." },
  ] as const;
}

export const starterIdeas = [
  { title: "A 2% fee that falls over 24 hours", prompt: "Build a coin with a 2% total buy and sell fee at launch, falling to 0.5% over 24 hours and staying there. Send the project fees to my creator wallet." },
  { title: "Fees for liquidity and buybacks", prompt: "Build a coin that puts 30% of its project fees into locked liquidity, uses 20% for buyback and burn, and sends the remaining 50% to my creator wallet." },
  { title: "Help me find an idea", prompt: "What could we build here? Give me three different, concrete coin ideas and a useful starting point. Just explain them for now; keep my saved coin unchanged." },
] as const;
