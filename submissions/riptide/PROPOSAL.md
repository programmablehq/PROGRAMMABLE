# Proposal

## What it is

Riptide is a Uniswap v4 launch model whose canonical pool **protects committed liquidity providers from
just-in-time (JIT) fee-sniping**, oracle-free and keeper-free, while enforcing the mandatory Programmable **10 bps**
volume fee non-bypassably on the same pool.

## The problem (usefulness)

A JIT provider adds a large position immediately before a big swap and removes it immediately after, capturing the
swap's LP fees that committed, always-on LPs should have earned. It is a documented drain on passive liquidity
(Wan & Adams, *Just-in-Time Liquidity on the Uniswap Protocol*), and it makes honest, always-on liquidity provision
structurally less profitable.

## The mechanism (genuine v4 fit)

Earned LP fees **vest by time-in-range**, built on the OpenZeppelin `LiquidityPenaltyHook` (pinned release). When liquidity is
removed within `blockNumberOffset` blocks of being added, a linear penalty is applied to the fees the position accrued
and **donated to the LPs still in range at removal time**:

```
penalty = fees * (1 - elapsedBlocks / blockNumberOffset)
```

100% at the same block, decaying to zero after the residency window. A parasitic add-swap-remove in one block forfeits
its entire fee take to the committed LPs; an LP who simply stays past the window keeps everything. Splitting additions
cannot reduce the penalty (it is measured from the last add). No oracle, no keeper: elapsed blocks is the only signal.

**Why this needs a hook, and cannot be done otherwise:** only a v4 hook can (a) meter each position's time-in-range
through the `afterAddLiquidity`/`afterRemoveLiquidity` callbacks and withhold/penalize fees via return deltas plus a
`donate`, and (b) collect the mandatory 10 bps on the quote side via quadrant-dependent swap return deltas atomically.
Neither is expressible as a router charge, a static LP fee, or a token transfer tax.

## The mandatory Programmable fee

Rates in hundredths-of-a-bip (`1000 = 10 bps = 0.10%`): `selected = 1000`, `effective = max(1000,1000) = 1000`,
`platform = 1000`, `project = 0`. Riptide takes **no project fee**. The 10 bps is charged on the **executed gross
quote-side volume** in all four swap quadrants via quadrant-dependent return deltas (quote = native ETH = `currency0`):
collect BEFORE when the quote is specified (basis `|amountSpecified|`), AFTER when unspecified (basis the executed
quote delta). Every returned delta is backed by ERC-6909 quote claims taken in the same unlock; the liability is
`(poolId, currency, owner)`-scoped, no cross-pool netting, claimable only by the immutable owner
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`.

The JIT-penalty accounting (liquidity callbacks) and the fee accounting (swap callbacks) are **independent callback
paths and never interact**.

## Authorities

The only privileged action is claiming the accrued platform liability, callable **only** by the immutable Programmable
owner. There is no builder/project/admin authority, no pause, no upgrade, no arbitrary call, no sweep; the JIT penalty
is formulaic and owner-independent, and LP/trader principal is never custodied. The hook is immutable.

## Evidence

Implemented in `src/Riptide.sol` and proven by a Foundry suite (see `TEST_PLAN.md` / `EVIDENCE.md`): 16 tests — 4-quadrant
fee correctness, a 1,000-run rate fuzz, owner-only claim, the four named safety cases, a stateful solvency invariant, a
**mainnet-fork rehearsal against the live PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90`**, and two anti-JIT
proofs: a same-block JIT forfeits its fees to the committed LP, while a provider past the residency window keeps them.

## Provenance & known limitations

Built through the mandatory Programmable v4 Builder skill (see `SKILL_FLOW.md`); the anti-JIT core uses OpenZeppelin
Uniswap Hooks primitives (`LiquidityPenaltyHook`) from the pinned release. Known limitation (inherited and disclosed):
in low-liquidity pools a multi-account strategy can
partially redirect penalty donations; a larger residency window reduces profitability. This is a builder proposal +
prototype for maintainer review — not accepted, audited, routed, deployed, or available.
