---
description: Select the canonical source for Module Mode and Custom Launches on Robinhood, or Ethereum records
---

# Index launches

Identify a coin by its chain and token contract address. Select a verifier by its launch source and version, then retain the original source record alongside the normalized coin. Module Mode and Custom Launches can share an index without sharing the same event format.

## Choose the source

| Source | Discovery and verification |
| --- | --- |
| Foundation on Robinhood | [Foundation guide](foundation-indexing.md) and [release discovery](https://programmable.market/api/module-foundation) |
| Earlier Native and Engine launches on Robinhood | [Versioned adapters](module-mode-indexing.md); the [Native V1 indexer contract](https://programmable.market/api/module-mode/indexer/v1) covers Native V1 only |
| Custom V4 on Robinhood | [Router V1 guide](robinhood-terminal-indexer.md) and [finalized feed](https://api.programmable.market/v4/chains/4663/finalized-custom-launches) |
| MultiRole Custom on Robinhood | [Router V2 guide](robinhood-terminal-indexer.md#multirole-v2) and [MultiRole finalized feed](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/finalized) |
| Ethereum Classic and Custom | [Developer manifest](https://developers.programmable.family/api/v2/manifest), [launch feed](https://developers.programmable.family/api/v2/launches) and [Router verification](verify.md) |

Robinhood Chain is `eip155:4663`; Ethereum Mainnet is `eip155:1`. Never merge contracts with the same address on different chains. API request UUIDs and Router launch IDs are different identifiers and should be stored separately.

## Build a complete index

1. Read the source's current deployment descriptor, ABI, runtime hashes, start block and finality rules. Bind your ingestion configuration to that source version.
2. Scan canonical events or traverse the complete public feed. Pass opaque cursors back unchanged, retain the source's required overlap and deduplicate by canonical event or launch identity.
3. Verify each launch using that source's events, getters, component bindings and finality evidence. Store the source record, block hashes and checkpoint needed to reproduce the result.
4. Commit the records and checkpoint together. On a reorganization, rewind to the last common canonical checkpoint and replay idempotently. Treat incomplete or unavailable coverage as unknown, not an empty result.
5. Add token metadata and market data with their own source, timestamp and quality. Preserve the launch when a name, image, price, pool or chart is unavailable.

## Modules and shared contracts

Module Mode coins are verified against their Foundation factory, Native launcher or Engine host and recorded module configuration. They do not need a Custom Router stamp. Store module IDs, versions and configuration as data. A newly published module within a supported host does not require a coin-specific or module-name allowlist. A new host interface requires its own source adapter.

MultiRole V2 represents physical components with role masks. A component with token and hook roles can use one address; `roleMask: 3` represents that combination. Do not run V1's distinct-role assumptions against a V2 record. Use `market.token` for coin identity, retain the component's full role mask and verify its runtime under the published V2 contract.

## Provenance and trading support

A verified launch record establishes where a coin came from. It does not prove every trading route, current liquidity, a price, hook safety or fee behavior. Unknown trading behavior must not remove a recognized launch from the index. A terminal can display the identity while keeping quotes or execution unavailable until its adapter supports the exact market.

Fee accounting uses the exact deployed fee source. Count accrual events once, keep recipient liabilities separate and do not count a later claim as new revenue. The launch feed is not a universal fee-claim queue. Ethereum claim integration has a separate protocol fee claim reference.

## Terminal stages

Foundation coins trade in their Uniswap v4 pool from launch. There is no later pool migration or bonding-curve completion event. Terminals can still group them by valuation, using their own labels and thresholds.

For example, a terminal could use a **20 ETH fully diluted valuation (FDV)** milestone and show an approaching stage from **16 ETH**, or 80% of that milestone:

| Example display stage | Example rule |
| --- | --- |
| New Pairs | Verified launch, below 16 ETH FDV |
| Almost Bonded | At least 16 ETH and below 20 ETH FDV |
| Completed | At least 20 ETH FDV |

These values are an optional display example, not a protocol rule or a required integration setting. A terminal may use different thresholds, currencies, names, recency filters or placement rules. If it uses a “Bonded” or “Migrated” column for valuation milestones, identify Foundation's entry as a valuation milestone and retain the actual existing pool. Leave migration transaction and destination-pool fields absent. A provider that reserves those columns for real migrations should use its ordinary direct-pool listing instead.

Calculate FDV as token price multiplied by total supply, with the correct decimals. For an ERC-20 quote, convert the quote value to the chosen denomination using an independently validated, sufficiently liquid price source. Report the price source, observation time and block. Do not label FDV as circulating market cap unless a separate circulating-supply methodology supports it. Missing, stale or unreliable pricing means the valuation stage is unknown, not zero; retain the coin in the launch index.

If progress is shown, the example is `clamp(FDV / 20 ETH, 0, 1)`. This measures the current valuation, so it can move down after sells. A terminal may instead retain a reached milestone if it records when the threshold was crossed and applies its reorg policy. Neither choice changes the pool, liquidity custody or trading route.

Indexing, routing and column placement require each provider's integration. Publishing this guide does not register Programmable in a terminal's launchpad list or activate its trading adapter.

## Service freshness

Inspect the selected source's coverage and finalized checkpoint rather than relying on HTTP status alone. The Developer API's normalized Robinhood feed is a separate service from the public Custom V4 and MultiRole feeds. An unavailable normalized response does not establish that no Robinhood launches exist. Use the source interfaces above and [Service status](../status.md) to interpret availability.
