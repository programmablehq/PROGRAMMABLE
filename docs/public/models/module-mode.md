# Module Mode

Module Mode lets you launch a coin on Robinhood Chain by choosing its settings and modules on the website. The launch creates the token and its Uniswap v4 pool.

## Choose your modules

Modules add behavior to a coin without requiring you to write a contract. Each module has its own settings, and the builder checks that your selections can work together. You can also launch with the standard settings.

ETH is the default pair. A pairing module lets you choose another supported token by its contract address, including meme coins or tokenized stocks. The builder checks the token and the route needed for the first buy.

Choose modules before launching. Each coin keeps the versions and settings recorded at launch. Later changes are limited to the controls those contracts provide; adding a module to the catalog does not add it to existing coins.

## Pool and costs

The coin's initial token supply provides the launch liquidity. A standard launch needs no separate ETH or paired-token deposit into the pool. You pay for the first buy, network gas and any funding required by your selected modules.

Trading starts in the Uniswap v4 pool and stays there. There is no later bonding-curve migration. The initial liquidity position is permanent.

You choose the creator fee before launch. Programmable's platform fee is separate. Some modules use a share of creator fees to fund their behavior. [Fees and revenue](../economics.md#module-mode) explains the calculation.

## Launch your coin

The [launch guide](../creators/launch.md) covers coin details, modules and wallet confirmation. After the transaction is confirmed and verified, the website opens the coin page with its contract address, project links, chart and trading controls. The coin appears in Explore once its launch is indexed.

Developers use the [Foundation indexing guide](../developers/foundation-indexing.md) to discover these launches and read their module settings.
