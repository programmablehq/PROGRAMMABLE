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
  { title: "A falling launch fee", prompt: "Build a coin with a 5% total buy and sell fee at launch, falling to 1% over 10 minutes." },
  { title: "Split fees", prompt: "Build a hook that puts 30% of its project fees into liquidity, uses 20% for buyback and burn, and sends 20% to top holders. Help me settle the remaining share and who qualifies, then build the complete design." },
  { title: "Find existing hooks", prompt: "Find examples of existing Uniswap v4 hooks and explain which mechanics I could use for my coin." },
] as const;
