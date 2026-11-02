/** Reviewed protocol knowledge, not current deployment discovery. Keep additions
 * independent so a new mechanic does not require rewriting the chat prompt. */
export const PROTOCOL_KNOWLEDGE_VERSION = "2026-11-02.1";
const hooks = "https://developers.uniswap.org/docs/protocols/v4/concepts/hooks";
export const PROTOCOL_TOPICS = {
  callbacks: {
    title: "Hook lifecycle and permissions", source: hooks,
    facts: "A pool selects one hook at initialization. One hook can serve many pools: scope mutable state by PoolId unless sharing is intentional. Hook address low bits must exactly encode its callback and return-delta permissions. Use the pinned Hooks library and mined CREATE2 address. Initialize, add/remove liquidity, swap and donate have distinct callbacks. Authenticate PoolManager entry and any router-supplied user identity. beforeSwap sender is the callback caller, not automatically the trader. Never use tx.origin. Match the exact pinned IHooks ABI, selectors and return deltas; a successful compiler run does not validate callback permissions.",
  },
  routing: {
    title: "Swap routing and hook data", source: "https://developers.uniswap.org/docs/trading/swapping-api/supported-chains",
    facts: "Distinguish the selected Programmable production router, the isolated test router and the hosted Uniswap API. Use the supplied uniswapRouting context and production manifest for the real router, ABI family, hookData, payer and recipient authentication; never copy a fixture address or assume msg.sender is the buyer. The hosted API requires its current supported version (2.1.2 in this knowledge revision); its retirement of older API headers does not change immutable direct-contract bindings. Never repoint a protected hook to the API default without proving compatibility. Test buys and sells, native/ERC20 settlement, exact-input/output support, approvals, slippage and fee limits using the actual supported path. A compatible v4 pool is not a guarantee that Uniswap's hosted API or app will route through an arbitrary custom hook. Extra hookData or callbacks require an explicit verified adapter.",
  },
  accounting: {
    title: "Fees, custom accounting and liquidity", source: hooks,
    facts: "Separate the v4 LP swap fee, hook return deltas, ERC20 transfer behavior and project fee recipients. Dynamic fee flags and return-delta permission bits have different meanings. Respect currency ordering, signed delta direction, exact-input/output semantics and the PoolManager's final settlement. Custom curves, auctions, inventory fees, rebates and JIT-liquidity policies may need stateful hooks and auxiliary contracts, not the read-only fee module. Fee-funded liquidity requires actual collected assets, balancing and a liquidity action; naming an LP recipient is not adding liquidity. Rebates need a funded budget and a defined claimant. Prevent donation manipulation, same-transaction gaming, reentry and double claims. Preserve mandatory chain-specific launch protections.",
  },
  "external-data": {
    title: "External data and scheduled actions", source: hooks,
    facts: "Solidity cannot fetch HTTP or execute itself when a timer expires. A time rule is evaluated by a transaction; autonomous execution needs an actual keeper. Weather, sports, prices, randomness or perpetual-related state need a defined trusted source or verifiable onchain interface, freshness, units, authentication, replay handling and failure behavior. Research citations do not make an oracle live. Separate producing an observation from submitting and consuming it. Cross-chain information needs a verified bridge/message path; another EVM chain's state is not directly readable. Never invent live feeds, exchange integrations, keepers, keys or funded rewards. Preserve the creative rule and mark the exact missing adapter or service.",
  },
  composition: {
    title: "Unconventional designs and composition", source: hooks,
    facts: "Translate creative language into trigger, state, actor, assets, action, limits and observable outcomes. Stateful counters, epochs, games, auctions, discounts, vesting, custom curves, vault integrations and combinations belong in general source when a fixed module cannot express every requirement. Keep a single canonical intent and all agreed constraints; never simplify an idea to a fee schedule just to fit a template. Decompose dependencies and auxiliary contracts explicitly. Ask only about an unresolved choice that changes economics or authority. Use pinned inline dependencies and inspect their actual interfaces; names, examples and a model's memory do not prove compatibility. Novel mechanics remain proposals until the corresponding behavior, router and dependency evidence exists.",
  },
  verification: {
    title: "Behavior and evidence boundaries", source: hooks,
    facts: "Write independent observable examples for every saved requirement before implementing it. Include time boundaries, two actors, cumulative transfers versus wallet balance, failed swaps and state rollback, unauthorized callbacks, fee caps, stale inputs and claim duplication where relevant. Use actual swaps and events instead of getter-only claims. The currently pinned isolated world covers native/token v4 pools and the protected native/token variant; unsupported pairs, custom router hookData, external protocols and cross-chain behavior need additional fixtures or evidence. Never remove their requirements to make checks pass. Source, compilation, scenario success, independent source review, production admission and wallet settlement are separate evidence states.",
  },
} as const;
export type ProtocolTopic = keyof typeof PROTOCOL_TOPICS;

export const PROTOCOL_CORE = `Protocol knowledge ${PROTOCOL_KNOWLEDGE_VERSION}: creative mechanics may require stateful general hooks and auxiliary contracts. Preserve every canonical rule. A hook observes transactions, not autonomous timers or HTTP. Oracle/keeper/dependency support must be established, not inferred. Callback sender, payer and recipient are distinct identities. Use the selected production router and exact pinned interfaces; fixture routing and Uniswap hosted routing are separate. Full scenario and production evidence determines support, not source generation. For details use the local protocol tool: ${Object.keys(PROTOCOL_TOPICS).join(", ")}.`;
