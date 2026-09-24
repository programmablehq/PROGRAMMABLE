# Fees and revenue

Programmable earns a platform fee on trades covered by its fee contracts. A creator fee goes to the recipients chosen by the project. Gas pays the network. These are separate charges.

## Module Mode

The current coin builder uses Foundation. Its platform fee is **0.30% on each buy and sell through the launch pool**. You can add a creator fee of **0% to 10% in whole percentage points**. Selected modules may receive part of the creator fee; they do not change the platform's 0.30%.

Both fees are calculated in the asset paired with the coin. For a **1 WETH** trade (wrapped ETH) with a **1% creator fee**:

| Recipient | Amount |
| --- | --- |
| Programmable | 0.003 WETH |
| Creator and any selected module recipients | 0.01 WETH |

The combined Foundation fee is **1.30%**. The initial pool has no additional LP fee. Other pools used along a trade route may charge their own fees.

These percentages apply to trades, not an allocation of the coin's token supply. [Creator earnings](creators/earnings.md) explains how recipients collect their fees.

## Custom launches

The planned platform fee for Custom Launch is **0.30% on buys and sells**. The API update for this rate is still in progress. Until it is available, the fee depends on the launch's deployed contracts and recorded settings. Creator and pool fees are separate.

Existing launch contracts retain their original fees. The [fee reference](reference/fee-versions.md) covers those versions.

## Programmable's V4/ETH pool

The V4/ETH pool on **Robinhood Chain** charges a **1% pool fee**, shared by liquidity providers according to their positions. Programmable receives the fees earned by its own locked liquidity position.

The position's V4 buyback and burn allocation is processed automatically. The [V4 token page](v4-token.md) covers the token and its liquidity.

## Platform revenue

The same 50/50 allocation applies to Module Mode platform fees, Custom Launch platform fees and fees received from Programmable's own V4/ETH liquidity position:

| Use | Share |
| --- | --- |
| V4 buybacks and burns | 50% |
| Programmable treasury | 50% |

At a **0.30% platform fee**, this is **0.15% of the trade value for V4 buybacks and burns** and **0.15% for the treasury**. The treasury pays ongoing platform costs and funds future development and other platform needs.

Creator fees and module rewards belong to their recipients and are excluded from this allocation. V4 already received within the burn allocation can be burned directly; other fee assets are used to buy V4 first.

## Check the records

[Dune Analytics](https://dune.com/programmablehq/analytics) tracks launches, fees and completed burns, with links to the burn transactions. It refreshes every 24 hours. Each query identifies the contracts and transactions it covers.

Earned fees can still be unclaimed. Withdrawing them is not new revenue. Gas, liquidity deposits and funds reserved for module behavior are excluded from platform fee revenue.
