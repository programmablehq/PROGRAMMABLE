# Public indexer feed

Programmable publishes machine-readable metadata for launches recognized by
the production read model.

## Public feeds

- Developer API v2
  [`GET /api/v2/status`](https://developers.programmable.family/api/v2/status)
- Developer API v2 Ethereum launch feed
  [`GET /api/v2/launches?chainId=1`](https://developers.programmable.family/api/v2/launches?chainId=1)
- Developer API v2 Ethereum token list
  [`GET /api/v2/token-list?chainId=1`](https://developers.programmable.family/api/v2/token-list?chainId=1)
- Ethereum Explore catalog
  [`GET /api/explore/ethereum`](https://programmable.market/api/explore/ethereum)
- Robinhood Explore catalog
  [`GET /api/explore/robinhood`](https://programmable.market/api/explore/robinhood)

These read-only endpoints require no API key and are intended for indexers,
wallets and trading applications. They publish launch identity, project
metadata and available market enrichment with explicit source and quality
states. Keep a recognized launch when optional market data is unavailable.

The former `/api/indexers/v1/tokens`, `/api/indexers/v1/token` and
`/api/indexers/v1/token-list` routes are retired. Do not use them for new
integrations.

## Explore read-model availability

Read the catalog's `status`, `updatedAt`, `items` and pagination fields.
Existing clients calling `/api/explore?chain=1`, `/api/explore?chain=4663` or
`/api/explore/token` can receive HTTP 503 with `index_rebuilding`. Follow the
`Link` response header with `rel="alternate"` to the corresponding catalog or
token presentation. Read the current query and response formats before migrating.
[Indexing guide](public/developers/indexing.md)

For the Robinhood Router, start block and finalized-feed details, see the
[Robinhood terminal integration](https://programmable.market/developer-reference/robinhood-terminal-indexer).

## Launch models

`launch.modelId` is the stable product model, such as `classic` or
`stock-paired`. `launch.modelVersion` identifies the contract release where a
version is required.

Stock-Paired records also disclose the quote-asset address, symbol and its
currency ordering in the v4 pool. Public launches select the launched token as
`currency0`; the quote asset is therefore `currency1`. Fees are denominated in
that quote asset, not ETH.

Third-party platforms control their own ingestion and refresh schedules.
Publishing a record here does not guarantee that another platform will display
it immediately.
