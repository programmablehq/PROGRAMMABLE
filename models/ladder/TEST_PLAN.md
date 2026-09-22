# Ladder test plan

## Unit behavior

- `registerPool` rejects a non-creator registrar, a vault bound to another hook or pool, ascending ticks, ticks off
  the pool's spacing, a dwell below the floor, and a second registration of the same pool. Complete:
  `test_rejectsNonCreatorRegistrar`, `test_rejectsVaultBoundToAnotherPool`, `test_rejectsAscendingTicks`,
  `test_rejectsTicksOffSpacing`, `test_rejectsDwellBelowFloor`, `test_rejectsSecondRegistration`.
- `LadderScheduleV1.validate` rejects zero tranches, more than five, non-descending ticks, a per-tranche share below
  the minimum, shares not totalling 10,000, and a dwell or expiry outside bounds. Complete in
  `test/LadderScheduleV1.t.sol`.
- Fee arithmetic with exact examples: a 1.00% pool splits 0.80% creator, 0.10% builder, 0.10% Programmable, and both
  fixed shares are carved from the total rather than added on top. Complete:
  `test_launcherShareIsCarvedOutNotAddedOn`, `test_buyExactInputSplitsThreeWays`.
- Authorized and unauthorized callers. Complete for the builder share, hook callbacks, custody release, ownership
  and forfeiture: `test_onlyBuilderCanClaimTheBuilderShare`, `test_onlyPoolManagerCanCallHookCallbacks`,
  `test_beneficiaryIsImmutable`, `test_releaseIsPermissionlessButPaysOnlyTheBeneficiary`.
  Outstanding: the creator-fee claim path through `FeeSplitVaultV1`, which is unmodified from the Classic release
  and covered by that model's suite.
- The wallet's own tranche-share and expiry bounds are enforced independently of the hook, since the wallet is a
  separate deployment that receives its own constructor arguments. Complete: `TrancheShareBelowMinimum` and
  `ExpiryDaysOutOfRange` revert paths in `test/EthLadderFeeHookV1.t.sol`.

## Integration lifecycle

- Create the token, register the pool, initialize it, and assert the anchor equals the initialization block.
  Complete: `test_disclosureRecordsTheLadderAndTheThreeWaySplit`. The anchor cannot be written twice because
  `PoolManager.initialize` reverts on an initialized pool.
- Exact-input swaps charge the declared fee and split it three ways to the wei, with the hook's claim-token balance
  matching the accounting. Complete: `test_buyExactInputSplitsThreeWays`.
  Outstanding: exact-output and sell-direction equivalents.
- Observation: a swap that leaves the pool below a tranche's target stamps a breach on that tranche and every one
  above it, and none below; a swap clearing every rung writes no breach slot. Complete:
  `test_breachStampsTheSuffixOnly`, `test_swapAboveEveryTrancheRecordsNoBreach`.
- Unlock: false until the dwell elapses and true immediately after; a mid-window breach resets the clock in full; a
  pool held above a target for the dwell and then sold below reports false again. Complete:
  `test_unlockRequiresTheFullDwellThenHolds`, `test_breachResetsTheClockInFull`,
  `test_heldThenDumpedReleasesNothing`.
- Custody: release pays exactly the tranche's share, refuses a second release of the same tranche, refuses an
  unearned one, is callable by anyone but pays only the beneficiary, and the final tranche sweeps the remainder so
  no dust is stranded. Complete: `test_releasePaysExactlyTheTrancheShare`,
  `test_releaseRefusesASecondClaimOfTheSameTranche`, `test_releaseRefusesAnUnearnedTranche`,
  `test_releaseIsPermissionlessButPaysOnlyTheBeneficiary`, `test_finalTrancheSweepsTheRemainder`.
- Forfeiture: reverts before expiry, succeeds after, is callable by anyone, sends only to the burn address, and
  blocks release once expired. Complete: `test_forfeitRevertsBeforeExpiry`,
  `test_forfeitBurnsTheRemainderAndIsPermissionless`, `test_releaseIsBlockedOnceExpired`.
- The partial-fill invariant reverts a swap whose settled native amount does not match the fee charged in
  `beforeSwap`. Demonstrated during development: oversized swaps that exhausted the liquidity range tripped
  `PartialFillUnsupported` as designed. Outstanding as a dedicated named test.
- External-call and recipient failures: a token whose `creator()` reverts, a reward vault that rejects its claim, a
  beneficiary contract that reverts on receipt. Outstanding.
- The full deployment-through-forfeiture sequence against the real, currently-deployed Ethereum Mainnet
  `PoolManager`, including both the hook factory and the custody wallet factory. Complete:
  `test_fullLifecycleAgainstTheRealPoolManager` in `test/EthLadderFeeHookV1MainnetFork.t.sol`. See
  `models/ladder/DEPLOYMENT_GRAPH.md` for the exact inputs and postconditions at each step.

## Properties

- Stateful invariants over an arbitrary observation sequence, in
  `test/invariant/LadderScheduleInvariant.t.sol`: recorded breaches never decrease; breaches ascend with tranche
  index; the unlocked set is always a prefix of the ladder; no tranche unlocks while the pool sits below its target
  price; nothing unlocks before a full dwell window from the anchor; a breach blocks unlock for a full window; the
  predicate never reverts. Complete, 16,384 calls per invariant.
- Fuzzed bounded parameters: fee endpoints, tranche counts, shares, dwell lengths, tick values, anchor and breach
  heights, and custodied amounts to 1e9 ether. Complete.
- Ordering assumptions: the schedule is a pure function of `block.number` and the pool's tick, asserted independent
  of timestamp and caller. Complete: `test_scheduleIsIndependentOfTimestampAndCaller`.
- Oracle assumptions: none, by construction. There is no external feed to model.
- Liquidity assumptions: the model deliberately does not constrain the depth at which a target is reached. Recorded
  as a limitation in `SECURITY.md` rather than tested as a property.

## Release evidence

- The suite runs against the revisions installed by `scripts/bootstrap-deps.sh`, and those exact revisions are
  now pinned in `spec/ladder.json`.
- A mainnet-fork lifecycle against the live `PoolManager` is complete:
  `test/EthLadderFeeHookV1MainnetFork.t.sol` runs the full deployment, registration, initialization, liquidity,
  trading, unlock, release and forfeiture sequence against the real, currently-deployed Ethereum Mainnet
  `PoolManager`, asserting its bytecode hash before running. The exact sequence, with concrete inputs and
  postconditions, is written up in `models/ladder/DEPLOYMENT_GRAPH.md`. The local integration suite above uses
  `Deployers`, which deploys a fresh `PoolManager` in-process; this test is the one that runs against the real one.
- Runtime code hashes and source verification are recorded after deployment. Not applicable at `design` status; no
  Ladder contract is deployed, and every hash field in `spec/ladder.json`'s `contracts` array is `null` for that
  reason.

## Defects found by this suite

Two, both before submission, both recorded in `SECURITY.md`:

1. `isUnlocked` subtracted the dwell start from the evaluated height without guarding their order, so a breach block
   at or beyond that height reverted instead of returning false. Found by
   `testFuzz_neverUnlocksBeforeDwellFromAnchor`.
2. The unlock comparison ran in the wrong direction. These pools use native ETH as `currency0`, so the tick falls as
   the token appreciates; tranches would have released as the token fell rather than rose. Found by the integration
   tests in this file.
