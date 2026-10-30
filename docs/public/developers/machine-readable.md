---
description: Find the schema, client and ABI for your integration
---

# API reference

Use discovery to select the interface and version for your task. Deployment addresses and client versions belong to that release; do not copy them from an unrelated example.

## Custom Launch

Start with [product discovery](https://programmable.market/.well-known/programmable.json). It identifies supported networks, API profiles, immutable client releases and schema URLs.

| Contract layout | Interface |
| --- | --- |
| New Custom Launch Plans on Robinhood | [Plan capabilities](https://api.programmable.market/v4/chains/4663/custom-launch-capabilities) and [generated contract](https://api.programmable.market/v4/chains/4663/custom-launch-contract/manifest.json) |
| Historical separate token and hook on Robinhood | V4 profile selected by discovery; retain its read and recovery interfaces |
| Shared token and hook on Robinhood | [MultiRole V2 capabilities](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities) |
| Existing Ethereum integration | V3 profile selected by discovery |
| Custom Launch on Base | [Base capabilities](https://api.programmable.market/v4/chains/8453/capabilities), [readiness](https://api.programmable.market/v4/chains/8453/readiness) and [OpenAPI](https://programmable.market/openapi/base-custom-launch-v1.json) |
| Custom Launch on HyperEVM | [HyperEVM capabilities](https://api.programmable.market/v4/chains/999/capabilities), [readiness](https://api.programmable.market/v4/chains/999/readiness) and [OpenAPI](https://programmable.market/openapi/hyperevm-custom-launch-v1.json) |

The [Custom Launch guide](custom-launch.md) explains authentication, preparation, wallet confirmation and errors. The [versioned agent reference](https://programmable.market/developers/custom-launch-api-v1.md) retains exact commands and compatibility details.

Partner roots and subkeys follow `customLaunchApi.partnerCredentials`, including chain grants, scopes and launch history. API keys never sign or broadcast. Version availability and request eligibility must both be checked before a wallet handoff.

## Module Mode

[Ethereum Foundation discovery](https://programmable.market/api/module-foundation?chainId=1) and [Robinhood Foundation discovery](https://programmable.market/api/module-foundation?chainId=4663) supply the chain-specific launch interface and ABIs. Add `&token={checksummedTokenAddress}` to resolve an existing coin's release.

The [Native indexer contract](https://programmable.market/api/module-mode/indexer/v1) describes earlier Native launches. It must not be used to decode Foundation events. The [indexing guide](indexing.md) explains how to select the right source.

## Ethereum public read API

The Developer API at `https://developers.programmable.family` is read only and needs no API key. It is separate from the authenticated launch service at `https://api.programmable.market`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v2/status` | Service health and index freshness |
| `GET /api/v2/manifest` | Deployment addresses, hashes and verification rules |
| `GET /api/v2/launches` | Indexed launch records |
| `GET /api/v2/launches/1/{tokenAddress}` | Ethereum token lookup |
| `GET /api/v2/token-list` | Token list |

The [OpenAPI specification](../.gitbook/assets/programmable-v2.yaml) defines the fields and responses. Its source is maintained in the Developers repository and synchronized here.

## Source coverage

For every network and launch variant, start with [Index launches](indexing.md). The normalized Developer API is not a complete substitute for the chain-specific Module Mode and Custom Launch sources. Inspect its status, coverage and manifest extensions before relying on a result.

Ethereum Router indexing must include `launchStampRouter` and `extensions["programmable/launch-stamp-router-generations-v1"].routers[]`. The `programmable/module-discovery-v1` extension links to module sources and states whether the normalized feed covers them. Robinhood Custom Plans use the [finalized projection feed](https://api.programmable.market/v4/chains/4663/finalized-launch-projections) plus the historical adapters in the [Robinhood guide](robinhood-terminal-indexer.md).
