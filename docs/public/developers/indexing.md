---
description: Index Module Mode and Custom Launches on Ethereum and Robinhood Chain
---

# Index launches

Use this guide to add Programmable coins to a wallet, explorer or trading terminal. Public indexing does not require a launch API key or a wallet signature.

A coin is identified by **chain ID + token address**. A verified launch record proves its Programmable origin. Prices, images and trading routes are added separately.

Base Custom Launches use the chain-qualified [Base finalized feed](base-custom-launch.md#index-base-launches). Module Mode remains on its existing chains.

## Choose your integration

| Launch type | Chain | Source and verification |
| --- | --- | --- |
| Module Mode | Ethereum Mainnet · `1` | [Foundation: Ethereum](foundation-indexing.md#ethereum-module-launches). Verify the Router stamp and module implementation. |
| Module Mode | Robinhood Chain · `4663` | [Foundation: Robinhood](foundation-indexing.md#robinhood-module-launches). Verify the factory release and launch record. |
| Custom Launch | Ethereum Mainnet · `1` | [Ethereum Custom indexing](ethereum-custom-indexing.md). Include every published Router generation. |
| Custom Launch | Robinhood Chain · `4663` | [Robinhood Custom indexing](robinhood-terminal-indexer.md). Read finalized projections and retain the historical source adapters. |

For older Robinhood Module Mode launches, retain the [Native and Engine adapter](module-mode-indexing.md). A new module within the same interface does not need a name-based allowlist. A new source interface needs its own adapter.

For historical Ethereum Classic launches, read the public [Classic identity snapshot](https://programmable.market/api/indexers/v1/classic-identities). It contains the verified catalog before Explore visibility and market-data filters, using Codex discovery and canonical Ethereum receipt checks. No API key is required. Preserve its release, block hash, status and source evidence; `last-known-good` is a cached observation. Its `identityCommitment` is SHA-256 of `programmable.classic-launch-identity-snapshot.v1`, a zero byte, and canonical JSON of `{chainId, releaseDigest, asOfBlock, asOfBlockHash, entries}`. Check the snapshot block against Ethereum before advancing a checkpoint. The retired `/api/explore` route is not this source.

## Start with discovery

The website feeds are the shortest path to discovering currently listed coins:

```text
https://programmable.market/api/explore/ethereum?page=1&pageSize=50&sort=newest
https://programmable.market/api/explore/robinhood?page=1&pageSize=50&sort=newest
```

Read every page through `page.totalPages`, deduplicate by chain and token address, and retain each record's `sourceEvidence`. These are website discovery feeds. For a complete onchain history, backfill the original sources in the selected guide, including historical releases and launches excluded from the website's display.

For a verified integration:

1. **Resolve the source.** Download its deployment descriptor, ABI, runtime hashes, start block and finality rules. Keep historical bindings when a new release appears.
2. **Collect and verify.** Follow all pages or scan bounded block ranges. Check receipts, events and contract readbacks against that source at a consistent canonical block.
3. **Store the evidence.** Keep source identity, launch ID, transaction hash, block number and hash, finality, token, hook and pool references. Commit records and their checkpoint together.
4. **Display the coin.** Add the verified Programmable label, pair, image and links. Missing optional data must not remove the launch.
5. **Keep updating.** Resume with overlap and deduplicate. After a reorganization, roll back to a common canonical checkpoint and replay.

A `confirmed` Explore record is not yet `finalized`. HTTP 200 alone does not establish complete coverage. Preserve the last verified data during a provider failure, mark it stale and retry with backoff. Do not replace an unavailable feed with an empty successful result.

## Label the launch correctly

| Record | What it establishes |
| --- | --- |
| Application submitted or approved | The project has entered or passed review. It has not necessarily launched. |
| Wallet signature or submitted transaction | The user authorized or broadcast a transaction. Check its receipt. |
| Canonical receipt and matching source record | The launch was included onchain. Apply the source's finality rules. |
| Verified, finalized launch evidence | The coin can be attributed to Programmable. |
| Image, price, liquidity or supported route | Separate presentation and trading information, each with its own freshness. |

Ethereum Module Mode can have a `custom-graph` stamp and `custom` category. Verify its module implementation before classifying the launch; do not discard it based on that category. Robinhood modules use factory, launcher or host evidence and do not require an Ethereum-style Custom stamp.

Custom Launch may use an existing token. Index the token bound by the verified launch record even when the launch transaction does not deploy a new ERC-20. Keep the token address separate from the controller, graph account, hook and pool.

## Show the pair, image and links

| Field | Rule |
| --- | --- |
| Pair | Resolve the launched token and its actual paired currency from the verified pool. Display `TOKEN/QUOTE`, without leading dollar signs. Do not assume every quote is ETH or USDC. |
| Name, symbol and decimals | Read the token contracts on the correct chain. Keep addresses as identity even when symbols match. A missing symbol is unknown, not a contract address used as a ticker. |
| Native currency | Distinguish the native currency from wrapped ETH using the actual PoolKey and chain definition. |
| Image and social links | Use the launch's bound or published metadata. Validate supplied digests and URLs. Missing metadata may use a placeholder while the coin remains listed. |
| Market data | Match chain, token, PoolManager and pool ID. Record the provider and observation time. Never attach a same-symbol market or a pool from another chain. |
| Valuation | FDV is token price × total supply with correct decimals. Use “market cap” only with independently established circulating supply. Unknown or stale prices remain unknown. |

Use [the source-specific guides](#choose-your-integration) for metadata commitments and exact response fields. Display symbols do not replace addresses in requests or storage keys.

## Pools and trading

Foundation coins use a Uniswap v4 pool from launch. They do not need a later bonding-curve completion or migration. Custom projects may use different liquidity models; read the actual contracts and pool evidence.

Verify current liquidity, hook requirements and the intended router's buy and sell paths before enabling trading. A valid Programmable stamp alone does not prove sellability, an audit or locked liquidity.

Codex and other market-data providers may enrich the verified launch with price and pool data. They do not replace its original onchain provenance. GMGN and other terminals must consume the relevant source and support the pool's route themselves; a label or route on one site does not activate it on another.

## If a launch is missing

| Symptom | Check |
| --- | --- |
| New Ethereum launches are missing, older ones appear | Read both the primary Router and the manifest's Router generations extension. |
| Some Module Mode coins are missing | Include the chain's Foundation adapter and retained Native/Engine history. Do not require a fixed module name or Custom stamp on Robinhood. |
| An existing-token Custom Launch is missing | Resolve the token from the verified stamp or projection, not only token deployment events. |
| A token shows on Explore but not in a normalized feed | Check that feed's source coverage. The normalized Developer feed does not cover every module source or every Robinhood source. |
| The coin exists but has no image, ticker or price | Retry metadata and market enrichment independently of launch verification. |
| A third-party label or swap is missing | Check that provider's source coverage and router support. Do not relaunch an already verified coin to repair indexing. |

Keep the chain ID, token address, launch transaction, source address and source version with any indexing report. Include the pool ID when the issue concerns a market. See [service status](../status.md) for coverage and freshness terminology.
