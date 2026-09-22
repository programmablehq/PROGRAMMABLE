# Threat model

## Trust boundaries
- **PoolManager** (`0x000000000004444c5dc75cB358380D2e3dE08A90`) is the only trusted dependency; every callback is
  `onlyPoolManager`. No oracle, keeper, external protocol, or off-chain input.
- **Immutable Programmable owner** (`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`) is the sole claimant of the platform
  liability. No other authority exists.

## Assets at risk
- The accrued **10 bps platform liability** (ERC-6909 quote claims) and **withheld JIT fees** (temporary, per position).
- LP and trader principal is **never** custodied by the hook.

## Threats and mitigations
| # | Threat | Mitigation |
| --- | --- | --- |
| 1 | JIT fee-sniping | Fees vest by residency; early removal forfeits a linear share, donated to in-range LPs (100% at same block). Tested both ways. |
| 2 | Splitting adds to dodge the penalty | Penalty is measured from the last add across the window; splitting does not reduce it (OZ base property). |
| 3 | Unbacked return delta (hard-fail) | Every swap-fee delta is backed by ERC-6909 claims taken in the same unlock; JIT penalties are donated, not minted. Solvency invariant: the platform liability is always backed (16,384 calls). |
| 4 | Fee bypass (router / alt-pool / LP-fee / transfer-tax) | 10 bps enforced inside the hook on the canonical PoolKey, executed gross quote-side, all four quadrants. |
| 5 | Owner drain / confiscation | No sweep/rescue/pause/upgrade/arbitrary-call. Owner moves only the accrued platform liability, to itself or a per-claim destination; `claimProgrammableFee` is `onlyOwner`, rejects the zero address, sets state before transfer (CEI). |
| 6 | Reentrancy | Callbacks are `onlyPoolManager`; the only external calls are to the trusted PoolManager (`take`/`transfer`/`donate`) within an unlock. No untrusted-callable value path. |
| 7 | Donation to no recipients | If no in-range liquidity exists at removal, the early removal reverts (`NoLiquidityToReceiveDonation`) rather than losing the penalty. |
| 8 | Low-liquidity multi-account penalty redirection | Disclosed OZ-base limitation; a larger `blockNumberOffset` reduces profitability. Not a fund-loss vector for committed LPs. |
| 9 | Wrong pool / re-bind | `afterInitialize` binds one-shot and reverts on a pool without the quote asset (`NotQuotePool`) or a re-bind (`AlreadyBound`). |
| 10 | Partial-fill over-charge | After-quadrant fee basis is the executed quote delta, never the requested amount. |

## Residual risk
- Low-liquidity penalty redirection (#8) — disclosed, bounded.
- Independent audit of the composed contract is not yet performed (the JIT base is the OZ LiquidityPenaltyHook (pinned release)).
