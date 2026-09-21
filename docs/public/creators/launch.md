# Launch a coin

Module Mode creates your coin and a Uniswap v4 pool on Robinhood Chain. You need a connected wallet and enough ETH for the first buy and network gas. A standard launch supplies the initial token liquidity without a separate liquidity deposit.

## Set up the coin

1. Open [Launch a Coin](https://programmable.market/launch/modules/foundation).
2. Enter a name, ticker and description. Add an image and project links if you have them.
3. Choose the creator fee under **Buy & Sell** and set the **First buy** amount.
4. Add any modules you want to use, then select **Create Launch** and confirm the transaction in your wallet.

The coin, pool and first buy are created in one transaction. If you leave the image blank, the coin uses the Programmable logo.

Website fields accept a domain or full URL. X accepts a username, an @username or a profile link. Use **Add More Links** for other project links.

## Add a module

The default **Classic** pairing uses ETH. To choose another token, select **Add module**, open **Pair another token** and enter its contract address. The form checks the address automatically. Save the module to add it to your launch; removing it restores the ETH pairing.

Pairing depends on the token's behavior and an available route for the ETH first buy. The builder checks these before preparing the transaction. Other modules use the configuration shown in the builder.

## After launch

The website opens your coin page after it verifies the confirmed transaction. The page contains the chart, contract address, project links and trading controls. Once indexed, the coin also appears in Explore and on your profile.

If the page does not update, keep the transaction hash and check its receipt before trying again. A delayed page does not mean the transaction failed.

For a project with its own contracts, use the [Custom Launch quickstart](../developers/custom-launch-quickstart.md).
