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

New Custom Launch approvals on Ethereum, Robinhood, Base, HyperEVM and Elysium require a **0.3% (30 bps)** platform fee on pool buys and sells, including the initial buy. The submitted contracts enforce this fee. Creator and liquidity-provider fees remain separate.

When capabilities select `programmable.automatic-platform-fees.v2`, the hook sends platform fees and the additional opening surcharge automatically. Ethereum and Base pay 100% as ETH to `0x9F5856A3578Faba96A6E8Dfd9C10563A1E598f62`. HyperEVM and Elysium pay 100% as HYPE to that address. Robinhood uses the existing router: 20% is paid as ETH and 80% is reserved for bounded V4 purchases delivered to the same wallet.

Purchases run in batches when gas, price and liquidity limits permit. Delivery to the team wallet is separate from burning tokens. If a payout cannot complete, its backed claim remains available for retry. Earlier immutable contracts retain their recorded destinations and claim paths. See the [fee reference](reference/fee-versions.md).

Before approval, Programmable records buy and sell checks for the exact submitted source and configuration, including the fee asset, assessment base, fixed recipient, backing and claim path. The Ethereum Native30 reference contracts use the gross native ETH leg and round up per trade. External routes depend on that hook's enforcement. A launch stamp establishes origin; it does not prove fee enforcement or payment. Existing contracts and versioned API profiles retain their recorded rates. The [fee reference](reference/fee-versions.md) lists the rates for Native20, earlier Module Mode contracts and Ethereum launches.

## Custom AI

[Custom AI](models/custom-ai.md) allocates **0.5% (50 bps)** to Programmable on every buy and sell through the launch pool, including the initial buy. The generated fee module can add a fee, with a maximum combined trading fee of **15%**. Normal token transfers are free.

Fees accrue in the paired asset. A **1 WETH** trade with a **3% total fee** allocates **0.005 WETH** to Programmable and **0.025 WETH** to the generated module's recipients. The fixed platform fee and the module's fees have separate accounting and claim paths.

## Platform revenue

Programmable allocates fee revenue after it has actually been collected. This includes its platform fees and the quote-asset fees collected from its own V4 liquidity position.

| Use | Share |
| --- | --- |
| V4 purchases, automatic for the new Robinhood router | 80% |
| Programmable treasury and operating costs | 20% |

For example, collecting 1 ETH of eligible fee revenue allocates 0.8 ETH to V4 buybacks and 0.2 ETH to the treasury. Creator fees, module rewards, customer funds, liquidity principal and transfers between Programmable wallets are excluded. Unclaimed fees do not create a buyback budget yet.

The automatic Robinhood router batches its 80% reserve into price-bounded V4 purchases when the configured gas and market limits permit. These purchases deliver V4 to the team wallet; they do not burn it. Ethereum revenue and revenue outside this router continue to use manual purchases. Burns remain separate transactions. Only confirmed transactions count as completed purchases or burns.

Fee tracking covers these Programmable wallets together on Ethereum and Robinhood:

| Wallet | Main role |
| --- | --- |
| `0x9F5856A3578Faba96A6E8Dfd9C10563A1E598f62` | Automatic Ethereum Custom Launch payouts, Robinhood native payouts and purchased V4 |
| `0xB7ec61e7f5a981F8C89E3788E61cE5EB2428A001` | Robinhood automatic Custom Launch fee router and V4 purchase reserve |
| `0xD88539d3c4C460136a733A3Fd60cf6BF269079da` | Earlier immutable fee contracts and other selected routes |
| `0x39544A7023081B56D7405c1af0bFaf72da7e24F6` | V4 liquidity fees and the project's burn wallet |
| `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` | Fees from earlier Ethereum contracts |

V4 received directly as fees from Programmable's own V4/ETH liquidity position is also burned. Those tokens are reported separately from purchased V4, so the same tokens are not counted as both a buyback and a liquidity-fee collection. The [V4 token page](v4-token.md) explains the token and its liquidity.

## Check the records

The [Dune dashboard](https://dune.com/programmablehq/analytics) reports the launches, fees and burns covered by its queries. Check each query's covered contracts, chains and indexed-through time. Collected fee revenue, the 80% buyback allocation, completed purchases and completed burns are separate measurements.

Earned fees can still be unclaimed. Withdrawing them is not new revenue. Gas, liquidity deposits and funds reserved for module behavior are excluded from platform fee revenue.
