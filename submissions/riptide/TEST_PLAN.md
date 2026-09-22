# Test plan

Toolchain: Foundry (forge 1.7.1), Solidity 0.8.26, EVM Cancun, optimizer 1000 runs, `via_ir = false`, no CBOR metadata.
Run `forge test`; the fork suite needs `MAINNET_RPC_URL`.

## Actual results: 16 tests pass, 0 failed, 0 skipped, across 4 suites.

### Core — `test/Riptide.t.sol` (10)
- Mandatory 10 bps in all four quadrants (`test_platformFee_*`) with solvency; `testFuzz_platformFee_exactRate`
  (1,000 runs); `test_bindsCanonicalPool`; owner-only claim (`test_claim_onlyOwner`, `test_claim_transfersClaims`).
- **`test_jit_sameBlockForfeitsFees`** — a JIT add-swap-remove in one block forfeits its fees; the committed LP collects
  ~the full swap fee (its share plus the JIT's donated share).
- **`test_longTermLP_keepsFees`** — a provider past the residency window keeps its fees.

### Named safety — `test/RiptideSafety.t.sol` (4)
`test_reentrancy_callbacksRejectNonPoolManager`, `test_zeroLiquidity_noPhantomFeeNoCorruption`,
`test_selfArbDrain_hookNeverDrainable`, `test_noDoubleFee_chargedExactlyOnce`.

### Stateful invariant — `test/RiptideInvariant.t.sol` (1)
`invariant_platformLiabilityBacked` — SOLVENCY across random swaps and JIT add/remove cycles: the hook's quote claims
always back the platform liability (withheld JIT fees only add to the balance). 256 x 64 calls, `fail_on_revert = true`.

### Mainnet fork — `test/RiptideFork.t.sol` (1)
`test_fork_platformFeeAndSolvency` against the real deployed PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90`:
initialize + bind + add liquidity + swap; the 10 bps accrues exactly and solvency holds on the live core.

## Universal hard tests
Zero/one/boundary fee values; both token orderings and swap directions; exact-input/output; unauthorized caller on
claim; partial-fill basis; re-initialization rejected; invariant call/revert counts recorded; mainnet-fork rehearsal.

## Planned / not yet done
- Independent audit of the composed contract; the autonomous atomic launch graph and its tests.
