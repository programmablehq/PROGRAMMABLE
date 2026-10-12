# Verify coverage and execution

The protected `Interface` and `Contracts` names remain completion gates. They
accept only successful required workers or a complete group of skipped workers
when the trusted scope says the group is unaffected. Missing scope, cancelled
work, failed work, and mixed success/skip groups fail. The production proof also
binds the exact source commit, workflow, run, attempt, and closed job inventory.

## Interface

Run `npm run verify:interface:plan` with `PROGRAMMABLE_CI_BASE_SHA` and
`PROGRAMMABLE_CI_HEAD_SHA` to see the checks selected for a change.

- CSS, images and proven copy edits use the existing presentation publisher.
- Application changes lint affected files and run related Vitest tests. The
  dependency graph includes literal file references; dynamic filesystem tests
  remain in the conservative set. Deleted modules and unknown build inputs use
  the full application suite.
- Browser suites follow the changed feature: trading, wallet sessions, module
  launches, profiles, navigation or Explore. A metadata-only change does not
  run wallet or migration fixtures.
- Module SDK/CLI checks run for those tools. Historical API activation audits
  run for release, binding or activation changes, not ordinary page changes.
- Verification-only maintenance runs the pipeline's own regression checks.
  This lane rejects changed application code, dependencies, contract jobs,
  protected aggregates and production-proof jobs. Existing application builds
  do not need rebuilding when only interface tests and their runner change.

For ordinary interface changes, production reuses a successful PR run when its
recorded checkout tree, workflow, base commit and repository match exactly.
The PR run and required jobs must all have succeeded within six hours. Missing,
stale or mismatched evidence falls back to running checks. Contract, database,
indexer, read-model and Custom V2 releases retain fresh verification. The source
record is stored in the PR run's `interface-source-*` artifact; the production
run links the reused run in its summary.

The production build and bundle credential checks remain. Custom V2 plus
Interface still selects full application coverage before sharing results.
Do not repeat successful checks locally and then run the same full suite again
for every small edit. Visual wording and CSS do not need source-string tests.

## Contracts

`Contracts build` bootstraps pinned dependencies, checks variants/format/lint,
and compiles the complete default Foundry profile once. Three independent
consumers receive that run's exact artifact ID, with artifact digest mismatch
treated as an error, and verify its source/run/attempt/workflow/toolchain receipt:

- `Contracts tests (1/2)` and `Contracts tests (2/2)` partition the actual Forge
  test inventory into disjoint complete source-file groups. The original
  deterministic exclusion, fuzz runs, and invariant configuration are retained.
  New test files are included automatically; malformed inventories fail.
- `Contracts release and forks` retains fork tests, official deployment/runtime
  verification, release bindings, and late-migration checks. All default-profile
  consumers finish before the late-migration profile compiles, avoiding the
  former repeated default/late/default compilation.

`Contracts static analysis` retains both Slither profiles in its own checkout.
Slither intentionally cleans and rebuilds its own build-info, so this worker
starts directly after scope classification without waiting for or downloading
the default-profile artifact. Its pinned toolchain and both analyses remain.

This is not a cross-commit compiler or release-proof cache. Artifact selection
has no repository/run override, and the receipt rejects another checkout,
workflow, run, attempt, or Foundry version. Five explicit worker jobs keep the
success/skip inventory stable even when Contracts is unaffected.

The CI official-runtime verifier reads all six contracts at one block without a
concurrent public-RPC burst. It may restart the entire snapshot on the next
fixed default provider only for recognized infrastructure failures. An explicit
`ETHEREUM_MAINNET_RPC_URL` remains the sole provider. Wrong chain, empty code,
runtime mismatch, malformed responses, and unclassified errors remain fatal.

## Other repeated work

The Verify concurrency group includes both ref and closed verification intent.
New changes supersede older changes on that ref, while a manual Custom V2
release verification cannot cancel a production push verification.

Ordinary `npm ci` steps disable implicit audit/funding requests. The explicit
production dependency audit and indexer audit remain required on their existing
scopes. These changes remove redundant work; worker separation additionally
reduces elapsed time. Hosted runner scheduling, artifact transfer, actual RPC
latency, complete builds, and mandatory security gates still have a cost.
