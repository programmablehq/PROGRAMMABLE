---
description: Launch coins and custom contracts on Uniswap v4
cover: .gitbook/assets/programmable-warm-night-v3.gif
coverY: 0
---

# Programmable

Programmable lets you launch coins and custom contracts on Uniswap v4. Use Module Mode to configure a coin on the website, or Custom Launch to build a project with your own code.

## Launch a coin

Module Mode creates a coin and its pool on Robinhood Chain. Enter the coin details, choose creator fees and a first buy, and confirm the launch in your wallet. ETH is the default pair. You can add a module to pair with another supported token.

The [launch guide](creators/launch.md) walks through the form. [Module Mode](models/module-mode.md) explains how the pool, modules and fees work.

## Build custom contracts

Custom Launch accepts your token, hook and supporting contracts through an API. The API checks the submitted project and prepares the launch transaction. Your wallet reviews and signs it.

Start with the [Custom Launch quickstart](developers/custom-launch-quickstart.md). Availability depends on the selected network, contract layout and verification requirements.

## Fees and integrations

Creators can earn fees from trades in their coins. Programmable receives a separate share according to the launch model. [Fees and revenue](economics.md) explains the rates and recipients.

Terminals, explorers and wallets can use the public launch records to identify coins. The [indexing guide](developers/indexing.md) covers each launch source and the checks an integration needs.
