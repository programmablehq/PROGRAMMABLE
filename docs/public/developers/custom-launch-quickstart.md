---
description: Prepare a Custom Launch, submit it with an API key and sign it from your wallet
---

# Launch through the API

Use Custom Launch for your own token, hook and supporting contracts. Choose the matching API, prepare the exact source and check the request. The controller wallet then reviews and signs the launch transaction.

## 1. Choose the matching API

Read [discovery](https://programmable.market/.well-known/programmable.json) to find the schema, capabilities and verified client release for your project.

| Network and layout | API |
| --- | --- |
| Robinhood Chain, separate token and hook contracts | V4 |
| Robinhood Chain, one contract acts as token and hook | MultiRole V2 |
| Ethereum Mainnet | V3 |

For Robinhood V4, require `publicWrites: true`, `publicAuthorization: true` and `releaseReady: true` in both the V4 and chain `4663` discovery entries. For MultiRole, require a complete `context` and `readiness.status: "ready"` in its capabilities response. Stop if readiness is missing or false.

Check architecture coverage before building. A supported request format does not mean the server can verify every hook or settlement model. Use the selected API's schema and client together; V4 and MultiRole requests are different.

## 2. Prepare the project and budget

Record the controller wallet, token metadata, exact source and compiler inputs, contract dependencies, initial inventory and reserves. Define who owns liquidity and how it can be withdrawn.

Set creator buy and sell fees explicitly. Robinhood Native20 charges a separate **0.20% platform fee** per successful buy or sell; pool LP fees are additional. Zero creator fees produce no Creator Rewards from those trades.

For V4 profile 4.1, read the public initial-buy quote advertised by the API. A funded launch requires an atomic initial buy worth at least USD 1 at the server's reference rate and positive minimum token output. Include the buy once in transaction value and budget gas separately. MultiRole follows its own funding configuration.

## 3. Create or reuse an API key

Open the [API-key manager](https://programmable.market/developers/api-keys) with the controller wallet. Use a key with the selected chain grant and both scopes:

- `custom-launch:create` for preflight and creation.
- `custom-launch:read` for status and the wallet handoff.

The request controller must match the wallet key's binding. Partner roots and subkeys follow the controller and lineage rules in discovery.

Provide the key as `PROGRAMMABLE_API_KEY` from your secret store. Send it only to `https://api.programmable.market` with `Authorization: Bearer`. Keep it out of source files, chat and screenshots. The key authorizes API requests; your wallet signs the transaction.

## 4. Pack, check and submit

Install the compatible client from the immutable release in discovery and verify its checksum. For separate-contract V4, prepare `programmable-launch.config.json` using the selected schema, then run:

```sh
programmable-launch pack --config programmable-launch.config.json --output launch.json
programmable-launch validate launch.json --config programmable-launch.config.json --remote
```

Read the returned eligibility, findings and remediation. `TX_SIMULATION_PENDING` with `launchEligibility.deployable: true` means creation performs the remaining transaction simulation.

When the response permits creation:

```sh
programmable-launch submit launch.json --config programmable-launch.config.json
```

Save the original request bytes, idempotency key and response. If a timeout leaves the result uncertain, retry with the same bytes and `Idempotency-Key`. Honor `Retry-After`; do not repack an uncertain submission.

For MultiRole, use the request packer and client advertised by its capabilities. Replace example values with your project's controller, context, contracts, funding and permit window before submission.

## 5. Track and sign the launch

For V4, use `resource.launchId` from the response as `LAUNCH_ID`:

```sh
programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until authorized
```

`action_required` means follow the returned remediation. An `authorized` response supplies the wallet handoff. Check the network, controller, Router address, calldata, value and expiry in the wallet, then sign and send.

After sending:

```sh
programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until finalized
```

MultiRole uses its returned `statusUrl` and its own client's commands. Keep the original launch ID and request context when recovering an existing launch.

On Robinhood, `submitted` is followed by sequencer confirmation, posting to Ethereum and the required Ethereum finality. Source verification starts after finality. Indexing and trading support have separate results.

## If the request is blocked

Check the returned error before changing the key. Authentication, missing scopes, the chain grant and controller binding are separate checks. Source findings, missing verification and unavailable releases need the remedy reported by the service.

The [Custom Launch API reference](custom-launch.md#errors-and-support) explains these errors and the request lifecycle. For support, include the error code, HTTP status, UTC time, `error.requestId` and launch ID if one exists. Never send credentials.
