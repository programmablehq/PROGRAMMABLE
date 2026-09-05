# Verify coverage and execution

The protected `Interface` and `Contracts` names remain completion gates. They
accept only successful required workers or a complete group of skipped workers
when the trusted scope says the group is unaffected. Missing scope, cancelled
work, failed work, and mixed success/skip groups fail. The production proof also
binds the exact source commit, workflow, run, attempt, and closed job inventory.

## Interface

Ordinary interface changes run the complete quality/test command and the
browser/build command in independent checkouts. Browser fixtures and Next.js
builds remain sequential within one checkout because they share ports and
mutable build output. The full local entry point is `npm run verify:interface:ci`.

One narrow exception replaces the global lint, full Vitest batch (439 files at
introduction), and 74 unrelated wallet/late-migration browser cases with scoped
lint and 15 direct docs, discovery, and API-key UI test files. It requires an
actual URL-only change in one or both of these existing literals:

- `guideUrl` in `lib/custom-launch/v4-public-contract-discovery.ts`
- `robinhoodGuide` in `tests/public-robinhood-v41-agent-docs.test.ts`

Only a plain `/developers/*.md` path under the unchanged site origin may
change. The trusted-base classifier reads both Git blobs, requires an existing
regular file modified without a mode change, and compares every byte outside
the single literal. Escapes, interpolation, other code edits, unknown paths,
missing history, deletion, and renaming select full coverage. Changes to the
two exact existing companion Markdown files listed in the classifier may
accompany the literal edit. Markdown alone does not select this exception.

Every functional mixed scope, including Custom V2, selects full Interface
coverage. A trusted base without the new output also selects full coverage.
`npm run verify:interface:guidance:ci` retains all existing Interface Node
contracts and runs the 15 direct Vitest files, including the information-architecture
contract that reads the allowed companion Markdown. The browser/build worker still
runs the entire production build, complete-history V4 clean-room gate, and
both V4 and V4.1 activation audits. The aggregate explicitly rejects a guidance
claim combined with any functional scope.

When Custom V2 and full Interface are both required in the same run, the latter
already supplies identical global lint, 12 Custom V2 Vitest files, and the
production build. The Custom V2 worker runs its remaining typecheck/Node
contracts and any required operations gate. Both protected results are required
by the final aggregate and production proof. Custom V2 alone retains its full
original command. Guidance coverage cannot satisfy this shared-work condition.

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
