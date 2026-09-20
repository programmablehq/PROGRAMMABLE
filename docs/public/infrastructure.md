---
description: From launch configuration to wallet execution, verification and public discovery
---

# How Programmable works

A launch moves through configuration, transaction preparation, wallet execution and public verification. Programmable records these steps separately so a prepared request, a confirmed transaction and an indexed coin have clear meanings.

## Module Mode

The builder reads the active release and module catalog, validates the configuration and prepares the launch transaction. Foundation creates the coin, its hook and its Uniswap v4 pool, records the selected modules and supplies the initial token liquidity. An optional initial buy runs in the same transaction. The pool remains the trading venue as the coin grows.

An indexer verifies the factory events and contract reads against the published release. Foundation does not require a Custom Launch stamp. The [Foundation indexing guide](developers/foundation-indexing.md) defines the source contract; [earlier Native and Engine launches](developers/module-mode-indexing.md) retain their own adapters.

## Custom Launch

The client packages one exact source and deployment plan. The chain-specific API checks the package, permissions, economics and execution evidence required by its profile. A returned wallet handoff binds the transaction to the intended controller, chain and launch. The API key cannot sign for that wallet.

The controller reviews and signs the authorized transaction. The appropriate Launch Stamp Router records the deployed project and its components. Source verification, transaction finality and public indexing each have their own result. The [API quickstart](developers/custom-launch-quickstart.md) explains the sequence and how to recover from a rejected or incomplete request.

## Classic on Ethereum

Classic creates a fixed supply token, initializes its ETH pool, locks the initial liquidity position and completes the initial buy through the selected launcher. The deployed version determines its creator fees, rewards and custody. Read the [Classic reference](models/classic.md) for the exact model.

## Public discovery

The website publishes verified launch identities and adds market data when available. A coin is identified by its chain and token address. Its source record explains which launcher or Router created it and which version-specific verifier applies.

Price, liquidity, chart data and trading support are separate from launch identity. A missing chart does not remove a valid launch. A launch stamp does not prove that another trading application supports the hook. [Index launches](developers/indexing.md) describes the common ingestion rules and links to each source.
