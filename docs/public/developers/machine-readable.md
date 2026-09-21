---
description: Find the schema, client and ABI for your integration
---

# API reference

Use discovery to select the interface and version for your task. Deployment addresses and client versions belong to that release; do not copy them from an unrelated example.

## Custom Launch

Start with [product discovery](https://programmable.market/.well-known/programmable.json). It identifies supported networks, API profiles, immutable client releases and schema URLs.

| Contract layout | Interface |
| --- | --- |
| Separate token and hook on Robinhood | V4 profile selected by discovery |
| Shared token and hook on Robinhood | [MultiRole V2 capabilities](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities) |
| Existing Ethereum integration | V3 profile selected by discovery |

The [Custom Launch guide](custom-launch.md) explains authentication, preparation, wallet confirmation and errors. The [versioned agent reference](https://programmable.market/developers/custom-launch-api-v1.md) retains exact commands and compatibility details.

Partner roots and subkeys follow `customLaunchApi.partnerCredentials`, including chain grants, scopes and launch history. API keys never sign or broadcast. Version availability and request eligibility must both be checked before a wallet handoff.

## Module Mode

[Foundation discovery](https://programmable.market/api/module-foundation) supplies the current launch interface and ABIs. Add `?token={checksummedTokenAddress}` to resolve an existing coin's release.

The [Native indexer contract](https://programmable.market/api/module-mode/indexer/v1) describes earlier Native launches. It must not be used to decode Foundation events. The [indexing guide](indexing.md) explains how to select the right source.

Module contributions use a separate author API. [Build a module](module-mode.md) covers submission access, configuration and review. A Custom Launch key does not grant module contribution scopes.

## Ethereum public read API

The Developer API at `https://developers.programmable.family` is read only and needs no API key. It is separate from the authenticated launch service at `https://api.programmable.market`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v2/status` | Service health and index freshness |
| `GET /api/v2/manifest` | Deployment addresses, hashes and verification rules |
| `GET /api/v2/launches` | Indexed launch records |
| `GET /api/v2/token-list` | Token list |

The [OpenAPI specification](../.gitbook/assets/programmable-v2.yaml) defines the fields and responses. Its source is maintained in the Developers repository and synchronized here.
