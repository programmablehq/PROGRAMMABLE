# Custom hooks and the 0.3% platform fee

An Ethereum swap must not pay the platform fee twice. When an exact supported
hook already accrues the fee, the website omits its additional router fee and
checks the hook's actual accrual in both the quote and final transaction.

The website checks the complete deployed hook bytecode, its immutable values,
the pool, the recipient and the fee custody contract. A project declaring
`0.3%` or deploying a copy of a fee vault does not establish this property.

The custom bindings in `ethereum-custom-native30-recipes-v1.ts` cover the
submitted DuelHook, BrownieHook and QubitHook runtimes. They are derived from the exact
Solidity 0.8.26 compiler output and its AST immutable references. The recorded
`sourceArtifactHash` is the SHA-256 of the original Standard JSON input. The
fixture records immutable values from those compiled submissions; it is not
evidence of a public deployment or launch approval.

- DuelHook uses the unchanged EthereumNativeFeeVaultV3, with the hook as its
  kernel and the fixed Programmable recipient. Its fee rounds up per trade.
  The second exact binding covers its partial-fill rejection and corrected
  gross-native buyback fee; the original binding remains separately identified.
- BrownieHook has separate exact runtime bindings for optimizer runs 200 and
  1000. Both hold native PoolManager claims in the hook itself. Its fee rounds down per
  trade. The check includes every fee liability: platform, project, module and
  launch-tax balances. Module payments may reduce the non-platform liability,
  but cannot consume the platform's backed balance.
- QubitHook uses the unchanged EthereumNativeFeeVaultV3 child at CREATE nonce 1.
  Its exact runtime fixes the native/QBT pool at a 1% LP fee and spacing 60.
  Its 0.3% platform share rounds up and is backed by PoolManager native claims
  in that vault; the project's separate hook levy and LP fee are not platform
  fees. The hook's buybacks also accrue the platform share.

The quote uses the actual native amount spent, including any refund, rather
than assuming that the entire requested input was used. A mismatch in the
fee, recipient, backing or runtime prevents that transaction from being
returned as ready. It does not fall back to charging another fee.

Fee recognition does not approve a project's opening tax, liquidity custody,
upgrade authority or other behavior. Those remain part of launch review.
Changing executable hook code requires a new exact binding and review.
Existing launch hashes, signatures and historical fee policies are unchanged.

RivetHook and DecayingVolumeFeeHookV1 also have exact submitted-runtime
bindings. Rivet holds native ETH in the hook; its three credit balances must
remain fully backed by the hook's ETH balance. The decaying-volume hook holds
PoolManager native claims. Its platform and project liabilities must equal
the recorded total and remain fully backed by those claims. Its fractional
platform fee remainder carries between swaps, so both the before and after
remainder are checked with the exact contract integer arithmetic.

Both paths require the successful callbacks for the exact pool and transaction,
current runtime observations, backed fee accrual and fixed-recipient claims.
Recognition changes no project contracts, salts, launch addresses or review
decisions, and does not approve reward-management rights or project taxes.
