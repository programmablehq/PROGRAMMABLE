---
description: Trading fees, creator earnings and platform revenue
---

# Fees and revenue

Trading fees depend on the contract a coin launched with. Creator fees and module rewards belong to their recipients. Programmable's platform fee is accounted for separately. Network gas, liquidity deposits and module funding are not trading fees.

## Module Mode

### Foundation

Foundation charges **0.30% for Programmable** on each buy and sell. The creator chooses **0%, or 1% to 10% in 1% increments**, added separately. Fees accrue in the pool's quote token.

Modules can receive a share of the creator fee recorded at launch. That allocation divides the creator's amount and does not change the platform's 0.30%.

For a **1 ETH** trade with a **1% creator fee**, **0.003 ETH** belongs to Programmable and **0.01 ETH** goes to the creator and any selected module recipients. The combined Foundation fee is **1.30%**. Foundation's initial pool has a 0% LP fee; other pools used by a trade route may charge their own fees.

Use the creator rate recorded for the trade's direction. Some deployed releases support different buy and sell rates; earlier ones use a shared rate. Existing coins keep their settings.

### Earlier Native and Engine coins

| Version | Without eligible modules | With eligible modules |
| --- | --- | --- |
| Native V2 and Engine V1 quote trading | 0.10% to Programmable | 0.10% to Programmable and 0.20% total to module authors |
| Native V1 | 0.20% to Programmable | 0.10% to Programmable and 0.10% total to module authors |

Creator and pool fees are additional. Author rewards are divided equally between distinct eligible module families. Repeated instances do not create more shares. Escrow deposits, settlement requests and refunds do not generate trading fees.

## Custom launches

Robinhood Native20 charges **0.20% (20 bps)** of gross native ETH per successful buy or sell. Creator and pool fees are separate. On a **1 ETH** trade, Programmable earns **0.002 ETH**. A creator who selects 0% earns no creator fees from that trade.

Custom fee behavior depends on the verified contract and API profile. Use the coin's recorded fee configuration for the rate and where it applies.

## Ethereum launches

Classic includes Programmable's **0.10%** within the selected fee. A 1% fee leaves 0.90% for the creator. Ethereum Custom contracts with a verified platform-fee path charge 0.10% for Programmable in addition to project fees.

## Platform revenue

Programmable allocates **50% of platform fee revenue to V4 buybacks and burns** and **50% to the treasury**. Creator fees and module rewards are excluded. The policy is to process buybacks and burns daily; completed transactions are recorded in the analytics.

V4 tokens collected as fees from Programmable's V4/ETH liquidity position are also burned. These are separate from tokens bought with platform revenue. The [V4 token page](v4-token.md) explains the token and its liquidity.

## Accounting

The [Dune dashboard](https://dune.com/programmablehq/analytics) reports launches, earned fees and burns and refreshes every 24 hours.

| Metric | Meaning |
| --- | --- |
| Custom Launches | Confirmed launches through Programmable |
| Custom Creator Rewards | Fees earned by coin creators |
| Custom Protocol Revenue | Fees earned by Programmable |

Earned fees include unclaimed balances. Claims withdraw those balances and are not new revenue. Gas and liquidity deposits are excluded. The dashboard's queries identify the contracts and transactions covered.
