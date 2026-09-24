# Fees by contract version

Use a coin's launch source and recorded configuration to identify its fee rules. Existing contracts retain their settings when the website or module catalog changes. Rates below apply only to the relevant contract and pool; an external trade route can include additional fees.

The [Fees and revenue](../economics.md) guide explains the current builder and the platform's revenue policy.

## Foundation

Foundation charges 30 bps (0.30%) for Programmable on each buy and sell through its pool. Creator fees are additional. Both are calculated on the gross quote amount, and fees accrue in the quote asset. For ETH-funded launches with a WETH quote, the ledger asset is WETH.

Modules can receive an allocation of the creator fee recorded at launch. That allocation does not reduce the platform fee. Foundation's initial pool has a 0% LP fee.

Use the creator rate recorded for the trade's direction. Some releases support different buy and sell rates; earlier ones use a shared rate. The current website control selects one shared rate from 0% to 10% in whole percentage points.

## Earlier Native and Engine coins

| Version | Without eligible modules | With eligible modules |
| --- | --- | --- |
| Native V2 and Engine V1 quote trading | 0.10% to Programmable | 0.10% to Programmable and 0.20% total to module authors |
| Native V1 | 0.20% to Programmable | 0.10% to Programmable and 0.10% total to module authors |

Creator and pool fees are additional. Author rewards are divided equally between distinct eligible module families. Repeated instances do not create more shares. Escrow deposits, settlement requests and refunds do not generate trading fees.

## Custom launches

The planned Custom Launch platform fee is 30 bps (0.30%) on buys and sells. Its API rollout is still in progress. Use the deployed contract and recorded configuration for an existing launch's rate; the new policy does not change older contracts.

### Native20

Robinhood Native20 charges 20 bps (0.20%) on the gross native ETH amount of each successful buy or sell through its bound pool. Creator and pool fees are separate. For a gross amount of 1 ETH, Programmable earns 0.002 ETH.

Native20's rate is not a universal rule for custom contracts. Use the fee configuration and verified fee path of the exact launch and pool. A configured policy or a launch stamp alone does not establish that a fee is enforced. A creator fee of 0% produces no creator earnings from that trade.

## Ethereum launches

Classic includes Programmable's 0.10% within the selected fee. A 1% fee leaves 0.90% for creator rewards. Ethereum Custom contracts with a verified platform-fee path charge 0.10% for Programmable in addition to project fees.

[Classic on Ethereum](../models/classic.md) describes its deployed contracts, liquidity and recipient rules.

## Accounting

Fees accrue before they are claimed. A claim withdraws an existing balance and must not be counted again as revenue. Keep creator fees, module rewards, LP-position proceeds and platform fees separate. Gas, liquidity deposits, escrow and refunds do not count as platform trading revenue.

The Dune dashboard uses **Custom Launches** for confirmed launches, **Custom Creator Rewards** for creator fees and **Custom Protocol Revenue** for Programmable's fees. Each query identifies the contracts and transactions it covers. Earned fees are distinct from completed buybacks and burns.

The 50/50 use of Programmable's income is documented in [Fees and revenue](../economics.md#platform-revenue). It covers platform fees and fees received from Programmable's own V4/ETH LP position on Robinhood Chain; these remain separate revenue sources in the accounting.
