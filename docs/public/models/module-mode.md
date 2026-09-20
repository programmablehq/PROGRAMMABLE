---
description: Launch a coin with a Uniswap v4 pool and optional compatible modules
---

# Module Mode

Module Mode uses Foundation to create a coin and its Uniswap v4 pool on Robinhood Chain. You choose the coin details, quote token, creator fee and optional initial buy. Compatible modules can add behavior when they are available in the live catalog.

Foundation supplies the initial liquidity from the new coin's token supply. A standard launch does not require a separate deposit of ETH or quote tokens into the pool. You pay network gas, any initial buy you choose and any additional funding required by selected modules. Trading starts in the Uniswap v4 pool and continues there without a later migration.

## Launch a coin

1. Open the [Foundation builder](https://programmable.market/launch/modules/foundation) and connect your wallet.
2. Enter the coin details, optional image and links, quote token, creator fee and initial buy.
3. Add available compatible modules if you want them and complete their configuration.
4. Review the fees and funding, create the launch and confirm the transaction in your wallet.

The ETH-funded flow creates the coin, pool and optional initial buy in one transaction, with one wallet confirmation. The builder checks the selected versions, capabilities, configuration and funding route before preparing it. Gas estimates and quoted outputs can change before execution.

An image is optional. If you launch without choosing one, the transaction records the Programmable logo as the token image. A selected image is used instead. Add a website, X or Telegram link directly; **Add more links** opens Discord, GitHub and GitBook fields. These links are stored in the token metadata and displayed on its Explore card and coin page.

After the transaction is confirmed, open the token or copy its contract address. Keep the transaction hash so you can verify the result if an interface or indexer is delayed.

## Configuration and compatibility

A module declares the fields it needs, their types and units, allowed values, dependencies and required permissions. The website uses those declarations to build the configuration form. A wallet address, duration or amount must have an explicit purpose and format.

Modules can have state, receive a declared operating budget and expose management actions. The host defines which actions are available and which wallet may execute them. The active release determines the supported engine, quote asset and resource limits.

Select a quote token by its contract address. Support is determined by the token's behavior and the route required for the chosen funding method, not by a list of tickers. An ETH initial buy needs a supported route with enough liquidity. Being an ERC-20 token alone does not guarantee that route exists.

Compatible modules share one launch. Combinations that conflict or exceed the host's limits are rejected before launch. A module that needs a capability outside the current host requires a reviewed extension or a new engine release before it becomes available.

## Manage a launched coin

Open a coin's available controls to use the actions exposed by its modules. The website checks the connected wallet's role and the action inputs before preparing a transaction. Indexing and external terminal visibility depend on the relevant service.

Each launch records the exact module versions and configuration it used. Publishing another module version does not replace code or settings in an existing coin. Changes to state or recipients follow the permissions of the deployed contracts.

## Fees and contributor rewards

Foundation charges **0.30% for Programmable** on buys and sells. Choose a creator fee of **0%, or 1% to 10% in 1% increments**, added separately. Selected modules can receive the share of the creator fee recorded at launch; they do not reduce the platform's 0.30% fee. For example, a 1% creator fee gives a 1.30% combined Foundation fee.

Fees accrue in the pool's quote token. The launch review shows the split before you confirm. Existing Native and Engine coins retain their original fee models, documented in [Fees and revenue](../economics.md#module-mode).

If the website is unavailable after you sign, keep the transaction hash from your wallet. Check its receipt before trying again. Your deployed contracts and earned claims retain their original permissions; the [developer recovery reference](../developers/module-mode.md#recover-transactions-and-claims) explains how to verify them with the existing clients or a contract interface.

## Build a module

You can build a module yourself or with an AI agent. Submit the source, configuration, management interface and required evidence through the API. The review checks its implementation and compatibility before a version can enter the public catalog.

Read [Build a module](../developers/module-mode.md) for the contribution workflow and [Index Foundation launches](../developers/foundation-indexing.md) for integration rules. The catalog is read from the service; documentation does not maintain a separate list of modules.
