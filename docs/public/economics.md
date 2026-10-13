# Fees and revenue

Programmable earns a platform fee on trades covered by its fee contracts. A creator fee goes to the recipients chosen by the project. Gas pays the network. These are separate charges.

## Module Mode

The current coin builder uses Foundation. Its platform fee is **0.3% on each buy and sell through the launch pool**. You can add a creator fee of **0% to 10% in whole percentage points**. Selected modules may receive part of the creator fee; they do not change the platform's 0.3%.

Both fees are calculated in the asset paired with the coin. For a **1 WETH** trade (wrapped ETH) with a **1% creator fee**:

| Recipient | Amount |
| --- | --- |
| Programmable | 0.003 WETH |
| Creator and any selected module recipients | 0.01 WETH |

The combined Foundation fee is **1.3%**. The initial pool has no additional LP fee. Other pools used along a trade route may charge their own fees.

These percentages apply to trades, not an allocation of the coin's token supply. [Creator earnings](creators/earnings.md) explains how recipients collect their fees.

## Custom launches

New Custom Launch approvals on Ethereum Mainnet and Robinhood require a **0.3% (30 bps)** platform fee on buys and sells through the launch pool, including the initial buy. The fee must be enforced by the submitted contracts and paid or accrued to `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`. A website-only surcharge does not meet this requirement. Project fees and liquidity-provider fees are separate. Ethereum's routed fee uses the gross ETH input on buys and gross ETH output on sells. Robinhood's routed fee uses the gross output asset.

Before approval, Programmable records buy and sell checks for the exact submitted source and configuration, including the fee asset, assessment base, fixed recipient, backing and claim path. The Ethereum Native30 reference contracts use the gross native ETH leg and round up per trade. External routes depend on that hook's enforcement. A launch stamp establishes origin; it does not prove fee enforcement or payment. Existing contracts and versioned API profiles retain their recorded rates. The [fee reference](reference/fee-versions.md) lists the rates for Native20, earlier Module Mode contracts and Ethereum launches.

## Platform revenue

Programmable allocates fee revenue after it has actually been collected. This includes its platform fees and the quote-asset fees collected from its own V4 liquidity position.

| Use | Share |
| --- | --- |
| Manual V4 buybacks and burns | 80% |
| Programmable treasury and operating costs | 20% |

For example, collecting 1 ETH of eligible fee revenue allocates 0.8 ETH to V4 buybacks and 0.2 ETH to the treasury. Creator fees, module rewards, customer funds, liquidity principal and transfers between Programmable wallets are excluded. Unclaimed fees do not create a buyback budget yet.

Buybacks and burns are executed manually. There is no automatic purchase on each trade or fixed daily execution schedule. The 80% allocation is a spending policy; only confirmed transactions count as completed buybacks or burns.

Fee tracking covers these Programmable wallets together on Ethereum and Robinhood:

| Wallet | Main role |
| --- | --- |
| `0xD88539d3c4C460136a733A3Fd60cf6BF269079da` | Current platform fees from Module Mode and Custom Launches |
| `0x39544A7023081B56D7405c1af0bFaf72da7e24F6` | V4 liquidity fees and the project's burn wallet |
| `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` | Fees from earlier Ethereum contracts |

V4 received directly as fees from Programmable's own V4/ETH liquidity position is also burned. Those tokens are reported separately from purchased V4, so the same tokens are not counted as both a buyback and a liquidity-fee collection. The [V4 token page](v4-token.md) explains the token and its liquidity.

## Check the records

The [Dune dashboard](https://dune.com/programmablehq/analytics) reports the launches, fees and burns covered by its queries. Check each query's covered contracts, chains and indexed-through time. Collected fee revenue, the 80% buyback allocation, completed purchases and completed burns are separate measurements.

Earned fees can still be unclaimed. Withdrawing them is not new revenue. Gas, liquidity deposits and funds reserved for module behavior are excluded from platform fee revenue.
