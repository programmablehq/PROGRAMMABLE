# Custom hooks and the 0.3% platform fee

An Ethereum swap must not pay the platform fee twice. When an exact supported
hook already accrues the fee, the website omits its additional router fee and
checks the hook's actual accrual in both the quote and final transaction.

The website checks the complete deployed hook bytecode, its immutable values,
the pool, the recipient and the fee custody contract. A project declaring
`0.3%` or deploying a copy of a fee vault does not establish this property.

The custom bindings in `ethereum-custom-native30-recipes-v1.ts` cover the
submitted DuelHook and BrownieHook runtimes. They are derived from the exact
Solidity 0.8.26 compiler output and its AST immutable references. The recorded
`sourceArtifactHash` is the SHA-256 of the original Standard JSON input. The
fixture records immutable values from those compiled submissions; it is not
evidence of a public deployment or launch approval.

- DuelHook uses the unchanged EthereumNativeFeeVaultV3, with the hook as its
  kernel and the fixed Programmable recipient. Its fee rounds up per trade.
- BrownieHook holds native PoolManager claims itself. Its fee rounds down per
  trade. The check includes every fee liability: platform, project, module and
  launch-tax balances. Module payments may reduce the non-platform liability,
  but cannot consume the platform's backed balance.

The quote uses the actual native amount spent, including any refund, rather
than assuming that the entire requested input was used. A mismatch in the
fee, recipient, backing or runtime prevents that transaction from being
returned as ready. It does not fall back to charging another fee.

Fee recognition does not approve a project's opening tax, liquidity custody,
upgrade authority or other behavior. Those remain part of launch review.
Changing executable hook code requires a new exact binding and review.
Existing launch hashes, signatures and historical fee policies are unchanged.
