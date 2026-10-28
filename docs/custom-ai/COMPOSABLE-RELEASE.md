# Composable Custom AI release

The existing fee-only V1 launch path remains separate from the new combined path. A combined design is never launchable merely because compilation, simulation or a website deployment succeeded.

The new code supports consecutive fee phases, linear ramps, fixed fees and bounded conditions over up to four named feeds. Stale data removes only the fee depending on that data. An earlier time phase can run without a later phase's feed. Immutable allocation programs separate creator funds, fixed distributions, staking, buybacks and permanently held additional liquidity. Event-gated actions currently use the liquidity program; other action types require an unconditional allocation.

A weather-change action uses a transition id; repeated readings of the same observation and later execution windows do not create another transition. Normal recurring actions use their configured interval. All financial values and recipients remain explicit in the visible design.

## Network activation

The operator must provide a matching `CUSTOM_AI_COMPOSABLE_RELEASES` record for each network with the checked bundle hash, acceptance evidence hash, program factory, supported feed ids and action kinds. This configuration is absent by default. Runtime reads verify the factory, helper contracts, core binding and live operational dependencies. Existing launch transactions cannot be converted to a different core or program version.

`CUSTOM_AI_EVENT_FEEDS_V2` binds each feed id to its exact chain, address, runtime hash and source version. The onchain feed identity, source version and runtime must match. A data provider contract and approved reporter/gas budgets are needed before service activation. The included London Open-Meteo adapter explicitly handles model data, not a promise of observed minute-by-minute weather.

The worker entry point is `ops/custom-ai-worker/main.ts`. Inject reviewed source-specific adapters with explicit target allowlists and budgets through the operator runtime. No public route can sign arbitrary worker transactions. Signed bytes and cost reservations are committed before broadcast. Unknown outcomes reuse the same transaction; one pending operation reserves the signer across workers.

## Verification

Run the Custom AI Foundry profile, then `node scripts/custom-ai/export-composable.mjs --check`. The exported bundle is bound to the checked contract sources. Compiler tests compare the independent integer reference evaluator with the generated module and exercise the existing Core on both supported chain ids. The real-pool contract test proves positive added liquidity, permanently held position ownership, fee claims, replay rejection and continued selling.

Browser tests use `playwright.custom-ai.config.ts`. They prove saved drafts, unapplied edits and keyboard/mobile behavior without paid model calls or real wallet transactions. Ordinary read-only tools use the existing targeted interface verification; changing financial contracts additionally runs the isolated financial profile in the protected contract job.

Before public activation, record source/runtime verification, a funded lifecycle on each approved chain, genuine feed updates, restart recovery and actual positive locked liquidity. Funding approval and provider contracts are not implied by a code merge. Do not claim the new path is publicly active until these records and live readback exist.
