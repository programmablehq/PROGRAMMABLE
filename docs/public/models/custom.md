# Custom Launch

Custom Launch is for projects that need their own contracts. You bring the source code for your token, Uniswap v4 hook and any supporting contracts your project uses.

A hook runs code during pool operations, such as before or after a trade. It can define fee rules or other behavior. Your contracts determine what the project does.

## How it works

1. Build the project and prepare its source code and launch settings.
2. Use an API key to send the project to Programmable. The API checks the request and returns the required next steps.
3. Review and confirm the prepared transactions in your wallet.
4. Follow the launch status until confirmation and indexing are complete.

Available launch paths depend on the current API capabilities and the contracts in your project. The [Custom Launch quickstart](../developers/custom-launch-quickstart.md) covers access, preparation and the wallet handoff. An API key cannot sign for your wallet.

## Fees and liquidity

Your contracts define the project's fees, recipients and liquidity model. An ordinary Uniswap pool needs a funded liquidity position. Projects with their own reserve or settlement logic must provide the assets and mechanisms that design needs.

[Fees and revenue](../economics.md#custom-launches) explains how Programmable's platform fees relate to project and pool fees.

## After launch

The launch record identifies the project's contracts so the website and other apps can discover them. Trading support depends on the project's market and available routes. A launch record establishes origin; it is not an audit of your contracts.
