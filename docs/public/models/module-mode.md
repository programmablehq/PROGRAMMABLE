---
description: Launch a coin with a Uniswap v4 pool and optional compatible modules
---

# Module Mode

Module Mode uses Foundation to create a coin and its Uniswap v4 pool on Robinhood Chain. You choose the coin details, pairing, creator fees and first buy. Compatible modules can add behavior when they are available in the catalog.

Foundation supplies the initial liquidity from the new coin's token supply. A standard launch does not require a separate deposit of ETH or quote tokens into the pool. You pay network gas, the first buy and any additional funding required by selected modules. Trading starts in the Uniswap v4 pool and continues there without a later migration.

## Launch a coin

1. Open [Launch a Coin](https://programmable.market/launch/modules/foundation) and connect your wallet.
2. Enter the name and ticker, add an image and links if you have them, then choose the pairing, creator fees and first buy.
3. Add available compatible modules if you want them and complete their configuration.
4. Review the fees and funding, create the launch and confirm the transaction in your wallet.

The website requires a first buy and suggests a small starting amount. The ETH-funded flow creates the coin, pool and first buy in one transaction, with one wallet confirmation. The builder checks the configuration and funding route before preparing it. Gas estimates and quoted outputs can change before execution.

If you launch without choosing an image, the transaction records the Programmable logo as the token image. Add a website or X profile directly; **Add More Links** opens Telegram, Discord, GitHub and Docs fields. A website can be entered as a domain or full URL. X accepts a username, an @username or a profile link. These links are stored in the token metadata and displayed on its Explore card and coin page.

After the confirmed transaction is verified, the website opens the coin page. **View Coin** provides the same destination. The page shows the chart, full contract address and project links. You can copy the address directly. The coin appears among the newest launches in Explore and on its creator's profile once the index verifies it. Keep the transaction hash so you can recover the page if an interface or indexer is delayed.

## Configuration and compatibility

A module declares the fields it needs, their types and units, allowed values, dependencies and required permissions. The website uses those declarations to build the configuration form. A wallet address, duration or amount must have an explicit purpose and format.

Modules can have state, receive a declared operating budget and expose management actions. The host defines which actions are available and which wallet may execute them. The active release determines the supported engine, quote asset and resource limits.

Under **Pair with**, **Classic** uses wrapped ETH in the pool. Choose **Other (Stocks or Meme Coins)** to enter another token's contract address. Support depends on the token's behavior and the required funding route. An ETH first buy needs a supported route with enough liquidity. Being an ERC-20 token alone does not guarantee that route exists.

Compatible modules share one launch. Combinations that conflict or exceed the host's limits are rejected before launch. A module that needs a capability outside the current host requires a reviewed extension or a new engine release before it becomes available.

## Manage a launched coin

Open a coin's available controls to use the actions exposed by its modules. The website checks the connected wallet's role and the action inputs before preparing a transaction. Indexing and external terminal visibility depend on the relevant service.

Each launch records the exact module versions and configuration it used. Publishing another module version does not replace code or settings in an existing coin. Changes to state or recipients follow the permissions of the deployed contracts.

## Fees and contributor rewards

Foundation charges **0.30% for Programmable** on buys and sells. Choose a creator fee of **0%, or 1% to 10% in 1% increments**, added separately. Selected modules can receive the share of the creator fee recorded at launch; they do not reduce the platform's 0.30% fee. For example, a 1% creator fee gives a 1.30% combined Foundation fee.

The selected launch version determines whether Buy and Sell can use independent creator rates. Earlier versions use one rate for both. Each coin keeps the fee configuration it launched with.

Fees accrue in the pool's quote token. The launch review shows the split before you confirm. Existing Native and Engine coins retain their original fee models, documented in [Fees and revenue](../economics.md#module-mode).

If the website is unavailable after you sign, keep the transaction hash from your wallet. Check its receipt before trying again. Your deployed contracts and earned claims retain their original permissions; the [developer recovery reference](../developers/module-mode.md#recover-transactions-and-claims) explains how to verify them with the existing clients or a contract interface.

## Build a module

You can build a module yourself or with an AI agent. Submit the source, configuration, management interface and required evidence through the API. The review checks its implementation and compatibility before a version can enter the public catalog.

Read [Build a module](../developers/module-mode.md) for the contribution workflow and [Index Foundation launches](../developers/foundation-indexing.md) for integration rules. The catalog is read from the service; documentation does not maintain a separate list of modules.
