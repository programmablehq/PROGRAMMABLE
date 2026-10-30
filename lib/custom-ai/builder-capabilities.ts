/** Shared product vocabulary. Configuration never certifies a funded, live service. */
export function builderCapabilities(configuration: { events: boolean; programs: boolean }) {
  return [
    { id: "fee-schedules", version: 1, state: "buildable", description: "Different buy/sell fees, countdowns, ramps and schedules; total fees 0.5–15%." },
    { id: "hook-research", version: 1, state: "research", description: "Search existing hooks and discuss mechanics. Finding a hook does not install or audit it." },
    { id: "external-events", version: 1, state: configuration.events ? "requires-live-check" : "design-only", description: "Weather or market rules need a connected, verified feed on the selected chain." },
    { id: "fee-programs", version: 1, state: configuration.programs ? "requires-live-check" : "design-only", description: "Fee-funded staking, distributions, buybacks and locked liquidity need a deployed program; automatic execution also needs a running, funded service." },
    { id: "arbitrary-hooks", version: 1, state: "design-only", description: "Arbitrary stateful v4 hooks can be designed here but cannot bypass this builder's fixed core or launch as a fee module." },
  ] as const;
}

export const starterIdeas = [
  { title: "A falling launch fee", prompt: "Build a coin with a 5% total buy and sell fee at launch, falling to 1% over 10 minutes." },
  { title: "Explore a hook idea", prompt: "Help me design a hook for a coin. Let's work out its rules before building anything." },
  { title: "Find existing hooks", prompt: "Find examples of existing Uniswap v4 hooks and explain which mechanics I could use for my coin." },
] as const;
