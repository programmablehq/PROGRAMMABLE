# Fees and revenue

Programmable earns a platform fee on trades covered by its fee contracts. A creator fee goes to the recipients chosen by the project. Gas pays the network. These are separate charges.

## Module Mode

The current coin builder uses Foundation. Its platform fee is **1% on each buy and sell through the launch pool**. You can add a creator fee of **0% to 10% in whole percentage points**. Selected modules may receive part of the creator fee; they do not change the platform's 1%.

Both fees are calculated in the asset paired with the coin. For a **1 WETH** trade (wrapped ETH) with a **1% creator fee**:

| Recipient | Amount |
| --- | --- |
| Programmable | 0.01 WETH |
| Creator and any selected module recipients | 0.01 WETH |

The combined Foundation fee is **2%**. The initial pool has no additional LP fee. Other pools used along a trade route may charge their own fees.

These percentages apply to trades, not an allocation of the coin's token supply. [Creator earnings](creators/earnings.md) explains how recipients collect their fees.

## Custom launches

New Custom Launch approvals on Ethereum Mainnet and Robinhood require a **1% (100 bps)** platform fee on buys and sells through the launch pool, including the initial buy. The fee must be enforced by the submitted contracts and paid or accrued to `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`. A website-only surcharge does not meet this requirement. Project fees and liquidity-provider fees are separate. Ethereum's routed fee uses the gross ETH input on buys and gross ETH output on sells. Robinhood's routed fee uses the gross output asset.

Before approval, Programmable records buy and sell checks for the exact submitted source and configuration, including the fee asset, assessment base, fixed recipient, backing and claim path. The Native100 reference contracts use the gross native ETH leg and round up per trade. External routes depend on that hook's enforcement. A launch stamp establishes origin; it does not prove fee enforcement or payment. Existing contracts and versioned API profiles retain their recorded rates. The [fee reference](reference/fee-versions.md) lists the rates for Native20, earlier Module Mode contracts and Ethereum launches.

## Platform revenue

Programmable's revenue policy allocates its platform fees as follows:

| Use | Share |
| --- | --- |
| Buy V4 and burn the purchased tokens | 50% |
| Programmable treasury | 50% |

Creator fees and module rewards are excluded. The policy calls for daily buybacks and burns; completed transactions show what has actually been processed.

V4 received as fees from Programmable's own V4/ETH liquidity position is also burned. This is separate from buying V4 with platform revenue. The [V4 token page](v4-token.md) explains the token and its liquidity.

## Check the records

The [Dune dashboard](https://dune.com/programmablehq/analytics) reports the launches, fees and burns covered by its queries. It refreshes every 24 hours and links completed burns to their transactions.

Earned fees can still be unclaimed. Withdrawing them is not new revenue. Gas, liquidity deposits and funds reserved for module behavior are excluded from platform fee revenue.
