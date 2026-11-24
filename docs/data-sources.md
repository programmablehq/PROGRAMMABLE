# Public data sources

Codex (`graph.codex.io`) supplies token prices, charts, volume, market
capitalization and exact-pool liquidity for Ethereum and Robinhood. A missing
observation is shown as unknown; the website does not substitute DexScreener
or an independently computed price.

Ethereum Classic launch discovery uses Codex `filterPairs` with the released
Uniswap v4 hook addresses. Every page uses a fixed creation-time boundary.
`count` is the number of results in one page, so discovery continues until a
short page. Token creation transaction hashes also come from Codex.

The website verifies each discovered launch receipt against the pinned
launcher, hook and full launch event bundle. This establishes creator and
reward-vault authority. These are individual contract checks, not a second
history-scanning index. A verified market observation cannot grant permission
to claim another wallet's rewards.

Explore, creator articles and Classic reward actions share this Codex-backed
catalog. Source evidence identifies Codex and the release digest. Its block
number identifies the contract-verification boundary; it is not a claim about
Codex's internal indexing watermark. New observations are cached for 15 seconds;
a failed refresh may use the last verified catalog, marked `last-known-good`,
for at most five minutes.

Custom and Module launch records retain the platform's transaction and finality
evidence, including launches that have not created a market yet. Their market
observations come from Codex. Claims continue to read contract balances and
beneficiaries. Envio is no longer a live website catalog dependency. Historical
release artifacts remain evidence of previous deployments.

## Website indexing health

[`GET /api/ops/health`](https://programmable.market/api/ops/health) reports
`programmable.operations-health.v2` for the Ethereum and Robinhood website
launch indexes. It reads the same verified catalogs as the chain Explore routes.
Each read is bounded to five seconds and concurrent requests share an observation
cached for 15 seconds. `checkedAt` is the observation time; each index's
`updatedAt` is its catalog source time.

The overall status is `ready` only when both indexes are ready, `unavailable`
when both are unavailable, and `degraded` for partial, syncing, stale or mixed
availability. An empty current catalog can be ready. Responses use `no-store`;
both unavailable returns HTTP 503, while ready and degraded return HTTP 200.
Legacy Explore reset routes retain their own status.

The `providers` field identifies Codex's data roles with `health: not-checked`.
Catalog readiness is not a direct probe of Codex's service or indexing watermark.

Indexing health does not establish launch or simulator availability. Use the
separate `customLaunchReadiness` links: Ethereum
[`/readyz`](https://api.programmable.market/readyz) and
[`/v3/capabilities`](https://api.programmable.market/v3/capabilities), or Robinhood
[`custom-launch-plans/readiness`](https://api.programmable.market/v4/chains/4663/custom-launch-plans/readiness)
and [`custom-launch-capabilities`](https://api.programmable.market/v4/chains/4663/custom-launch-capabilities).
Require the selected chain's current create authorization before submitting. On Robinhood, require `mode: "active"` for public
plan submission. Read the [Robinhood plan readiness OpenAPI reference](https://programmable.market/openapi/robinhood-custom-launch-plan-readiness-v1.json).
