---
description: Prepare an open Robinhood Custom Launch through the API and sign with your wallet
---

# Launch through the API

New Robinhood Custom Launches use the [Custom Launch Plan guide](https://api.programmable.market/v4/chains/4663/custom-launch-contract/guide.md). Your agent prepares the plan through the API. Your controller wallet reviews and signs the prepared transaction.

1. Read the [live capabilities](https://api.programmable.market/v4/chains/4663/custom-launch-capabilities). Require `availability.operations.create.state: "active"`, then read the [manifest](https://api.programmable.market/v4/chains/4663/custom-launch-contract/manifest.json) and [agent setup](https://api.programmable.market/v4/chains/4663/custom-launch-contract/agent-setup.json) for the current schema and binding.
2. [Create an API key](https://programmable.market/developers/api-keys) for Robinhood Chain with `custom-launch:create` and `custom-launch:read`. Give it to your agent through a secret store. Send it only to `https://api.programmable.market`; it cannot sign for your wallet.
3. For a new open plan, set `admissionPolicy` to `programmable.custom-launch-policy.provenance.v1`, `feeObligations` to `[]`, and `publication.visibility` to `listed`. The guide has complete examples. Your contracts may implement their own owner controls, pause behavior, liquidity model and fees. The launch stamp records provenance; it does not certify their safety or economics.
4. Preflight the exact request through `POST /v4/chains/4663/custom-launch-plans:preflight`. Resolve any binding or execution findings, then create through `POST /v4/chains/4663/custom-launch-plans` using the same packed bytes and an `Idempotency-Key`. If the result is uncertain, recover or retry with those exact bytes and key.
5. Open the returned launch in [Your launches](https://programmable.market/developers/api-keys?view=history). Check the network, controller, transaction destination, calldata and value before signing in your wallet. Follow the plan through finality and public indexing.

The earlier `/v4/chains/4663/custom-launches` profile is retained for existing launch history and recovery. It does not accept new requests. Ethereum Mainnet has a [separate V3 guide](https://programmable.market/developers/custom-launch-api-v1.md).
