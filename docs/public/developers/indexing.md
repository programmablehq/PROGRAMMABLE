---
description: Choose a launch source and build a complete, verifiable coin index
---

# Index launches

Use the chain and token contract address to identify a coin. Its launch source determines which events, contract reads and finality checks your indexer needs. Keep the original source record alongside the normalized coin so that you can reproduce the verification.

## Choose the source

| Launch source | Integration guide |
| --- | --- |
| Custom Launch Plans on Robinhood, including atomic execution and stamping | [Custom Launch Plan indexing](robinhood-terminal-indexer.md#custom-launch-plans) |
| Foundation on Robinhood | [Foundation indexing](foundation-indexing.md) |
| Earlier Native and Engine launches on Robinhood | [Native and Engine indexing](module-mode-indexing.md) |
| Custom V4 on Robinhood, with separate token and hook contracts | [Router V1 indexing](robinhood-terminal-indexer.md) |
| MultiRole Custom on Robinhood, including shared token and hook contracts | [Router V2 indexing](robinhood-terminal-indexer.md#multirole-v2) |
| Ethereum Classic and Custom | [Ethereum Router verification](verify.md) |

Robinhood Chain is `eip155:4663`; Ethereum Mainnet is `eip155:1`. Contracts with the same address on different chains are separate identities. Each guide provides its source discovery and verification rules.

## Build a complete index

1. **Bind the source.** Read its deployment descriptor, ABI, runtime hashes, start block and finality policy. Keep each historical binding when the active release changes.
2. **Collect every launch.** Scan bounded event ranges or traverse the complete feed. Preserve opaque cursors, retain any required overlap and deduplicate by the source's canonical identity.
3. **Verify the records.** Check the source's events, getters, component bindings and finality evidence. Save the block hashes and evidence needed to repeat those checks.
4. **Save a recoverable checkpoint.** Commit records and their checkpoint together. After a reorganization, return to the last common canonical checkpoint and replay. Incomplete coverage stays unknown.
5. **Add display data.** Attach metadata, prices and charts with their source and observation time. A missing image, price or trading route must not remove a verified launch.

Module Mode uses its factory, launcher or host as the source. It does not require a Custom Router stamp. Treat module IDs and configurations as data; a new module within a supported interface does not require a name-based allowlist. A changed source interface needs its own adapter.

A verified launch establishes origin. Track market data and trading support separately, so a terminal can show the coin while its quotes or execution are unavailable.

## Terminal stages

Foundation coins trade in their Uniswap v4 pool from launch. They have no later bonding-curve completion or pool migration. A terminal may group them by valuation using its own labels and thresholds.

For example, a terminal could use a **20 ETH fully diluted valuation (FDV)** milestone:

| Example display stage | Example rule |
| --- | --- |
| New Pairs | Verified launch, below 16 ETH FDV |
| Almost Bonded | At least 16 ETH and below 20 ETH FDV |
| Completed | At least 20 ETH FDV |

These are optional display settings. If a terminal uses a “Bonded” or “Migrated” column, identify this as a valuation milestone, retain the existing pool and leave migration transaction and destination-pool fields absent. Terminals that reserve those columns for actual migrations should use a direct-pool listing.

Calculate FDV as token price multiplied by total supply, with the correct decimals. Convert an ERC-20 quote through a validated, sufficiently liquid price source, and retain the source, time and block. Use circulating market cap only when circulating supply is independently established. Missing or stale prices leave the valuation stage unknown; they do not remove the coin.

An optional progress bar can use `clamp(FDV / 20 ETH, 0, 1)`. Its value can fall after sells. If a terminal retains a reached milestone instead, record the crossing time and apply the same reorganization policy as the rest of the index. Neither setting changes the pool or its liquidity custody.

## Service freshness

Check the selected source's coverage and finalized checkpoint. HTTP success alone does not establish complete data. The Developer API's normalized Robinhood feed is separate from the Custom V4 and MultiRole feeds; a failed normalized lookup does not mean those sources contain no launches. [Service status](../status.md) explains these availability states.

Each terminal decides which sources it indexes, displays and trades. This documentation does not activate a provider's integration.
