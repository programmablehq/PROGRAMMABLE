import type { LaunchIntent } from "../launch-intent";

/** Versioned design knowledge, not an allowlist of products or a declaration
 * that an integration is deployed. Source admission remains independent. */
export const PRODUCT_DESIGN_KNOWLEDGE_VERSION = "2026-11-04.1";
const families = [
  { id: "execution", match: /order|auftrag|twamm|dca|auction|auktion|batch|limit|execution|ausfuhr/i,
    guidance: "Execution products can separate order funding, eligibility, execution and withdrawal. A hook is one possible settlement point; a vault can own outstanding orders. Choose partial-fill, cancellation, expiry and slippage semantics. If execution requires another transaction, identify its caller and funding instead of pretending elapsed time sends transactions. Route settlement through the actual selected PoolManager/router; consider both payer identity and exact-input/exact-output behavior." },
  { id: "incentives", match: /reward|holder|loyal|treue|point|punkt|rebat|dividend|stake|staking|ponzi/i,
    guidance: "Incentive products can reward duration, useful liquidity, participation or milestones rather than only token balance. Define the funded reward asset, eligible snapshot, entitlement calculation and once-only claim. Distinguish an accounting claim from transferable shares. A transfer, split wallet, flash-funded balance or late join must not manufacture eligibility unless that behavior is explicitly part of the design. Never describe new deposits as guaranteed yield." },
  { id: "liquidity", match: /liquid|position|rebalance|range|inventory|market.?mak|bonding|curve|kurve/i,
    guidance: "Liquidity products can coordinate a hook, a position-owning vault and a rebalance executor. Describe who owns positions, which assets fund them, how fees accrue, who can withdraw, and the conditions for changing a range. Custom accounting can alter deltas; it does not remove settlement obligations. Distinguish pooled funds from individual claims and protected principal from a target with market risk." },
  { id: "external-data", match: /api|oracle|weather|wetter|score|sport|sensor|perpetual|funding|external|offchain|off-chain/i,
    guidance: "An external-event product needs a data source, normalization rules, observation time, trust model and an execution path. Separate a signed report from proof the report is true. Handle stale, contradictory, missing and repeated observations explicitly. Onchain code cannot call HTTP. Keep credentials on the server and build an adapter as a separate component; identify the missing adapter as work to implement, not a reason to discard the idea or ask a user to write code." },
  { id: "treasury", match: /treasury|buy.?back|burn|reserve|insurance|versicher|lend|borrow|credit|kredit|collateral|rente/i,
    guidance: "Treasury and credit products need explicit balance ownership, liabilities, reserves and withdrawal priority. Fee revenue, deposited principal, debt, collateral and buyback budgets are different balances. State which party absorbs a deficit or adverse price move. Preserve ordinary exit rights when an optional external action fails unless the user explicitly chose another rule. A larger apparent APR does not demonstrate solvency." },
  { id: "governance", match: /vote|voting|abstimm|govern|dao|game|spiel|challenge|milestone|meilenstein|community/i,
    guidance: "Community and game products separate permissions, outcomes and payouts. Define participation and resolution, delayed or disputed outcomes, replay prevention and the exact powers a vote may change. Distinguish pseudonymous wallets from unique humans. Changing protocol parameters or awarding a prize requires the contract's real authority and funded balance, not a chat decision or unverified offchain event." },
] as const;

export function productDesignKnowledge(intent?: Pick<LaunchIntent, "requirements">, message = ""): string {
  const text = [message, ...(intent?.requirements.map(rule => rule.text) ?? [])].join(" ").normalize("NFD").replace(/\p{M}/gu, "");
  const selected = families.filter(family => family.match.test(text));
  const exploring = /creativ|kreativ|brainstorm|idea|idee|bigger|grosser|moglich|possible|what could|was konnt/i.test(text);
  if (!selected.length && !exploring) return "";
  return `Product design knowledge ${PRODUCT_DESIGN_KNOWLEDGE_VERSION}. These are design lenses, not the only allowed mechanisms and not deployment evidence.
Think beyond a fee template: derive the complete product from the user's outcome. Use contracts, adapters, automation, indexing and a small interface only where the mechanism needs them. Reuse verified components when they fit, and isolate the precise missing capability when they do not. Never narrow a creative idea merely to match an existing template.
When asked for ideas, offer a few materially different mechanisms with a concrete user action, trigger, source of funds and useful tradeoff. Vary the mechanism rather than renaming the same token or changing percentages. Explain naturally; don't dump this internal checklist. Exploring a variant never overwrites the accepted product. Update only after the user selects or changes it.
${(selected.length ? selected : families).map(family => `${family.id}: ${family.guidance}`).join("\n")}
Protocol references: https://developers.uniswap.org/docs/protocols/v4/concepts/hooks ; https://developers.uniswap.org/docs/protocols/v4/concepts/flash-accounting ; https://developers.uniswap.org/docs/protocols/v4/guides/custom-accounting . They describe mechanisms, not deployed Programmable capabilities.`;
}
