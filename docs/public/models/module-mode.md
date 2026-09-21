---
description: How Module Mode coins, pools and modules work
---

# Module Mode

Module Mode creates a coin and its Uniswap v4 pool on Robinhood Chain. Foundation is the contract system behind these launches. You configure the coin on the website and add compatible modules before launching.

## The pool

Foundation supplies the initial liquidity from the coin's token supply. A standard launch needs no separate deposit of ETH or quote tokens into the pool. You pay for the first buy, network gas and any funding required by selected modules.

Trading starts in the Uniswap v4 pool and stays there. There is no later bonding-curve migration.

ETH is the default pairing. The **Pair another token** module lets you enter another token's contract address. The token and the route used for the ETH first buy must be supported and have sufficient liquidity. An ERC-20 address alone does not establish that a route is available.

The [launch guide](../creators/launch.md) covers the website flow.

## Modules and compatibility

A module defines its inputs, permissions, funding needs and any actions available after launch. The builder checks whether the selected modules can work together before preparing the transaction.

Each coin records the exact module versions and settings used at launch. Adding a new module to the catalog does not add it to an existing coin. Later actions can change only what the deployed contracts permit.

A module that needs a new host capability must be reviewed and supported before it can be offered in the builder. See [Build a module](../developers/module-mode.md) for the development requirements and submission status.

## Fees

Foundation charges **0.30% for Programmable** on buys and sells. The **Buy & Sell** control sets a creator fee of **0%, or 1% to 10% in 1% increments**, added separately. A 1% creator fee therefore gives a 1.30% combined Foundation fee.

Modules may receive a recorded share of the creator fee. This comes from the creator's amount and does not reduce the platform fee. Fees accrue in the pool's quote token. Existing coins keep the fee settings of their deployed version.

[Fees and revenue](../economics.md#module-mode) covers the calculation and earlier releases.

## Coin pages and integrations

After confirmation and verification, the coin page shows its contract address, project links and available market data. The coin appears in Explore once the index verifies its launch.

A terminal can index new coins and future modules through the same launch source, provided they use the same interface version. The [Foundation indexing guide](../developers/foundation-indexing.md) defines that interface.
