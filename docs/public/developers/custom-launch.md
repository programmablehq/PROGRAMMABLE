---
description: Custom Launch requirements, API access, request handling and wallet signing
---

# Custom Launch API

Custom Launch deploys your token, hook and supporting contracts through the Programmable Launch Stamp Router. The API checks the deployment request and prepares a transaction. The controller wallet reviews, signs and sends it.

Start with [Launch through the API](custom-launch-quickstart.md) for the commands. The [versioned API reference](https://programmable.market/developers/custom-launch-api-v1.md) contains the complete schemas, field limits and compatibility rules.

## Choose the request interface

The API-key workspace can prepare a general Custom Launch Plan. Read `GET /v4/chains/4663/custom-launch-capabilities` and check `availability.operations.create.state` before creating one. Creation requires `active`; preflight and reads can remain active while creation is disabled. `PLAN_OPERATION_DISABLED` describes a platform operation setting and is not resolved by rotating the key. The plan schema and agent instructions are published under `/v4/chains/4663/custom-launch-contract/`.

Existing profile-based integrations use the following layouts:

| Contract layout | API |
| --- | --- |
| Separate token and hook addresses | V4 |
| One contract acts as both token and hook | MultiRole V2 |

Read [discovery](https://programmable.market/.well-known/programmable.json) before building. Use the schema and verified client release advertised for the selected API. V4 and MultiRole have different request formats and funding rules.

MultiRole publishes its context, readiness, guide and client through `GET /v4/chains/4663/multi-role-custom-launches/capabilities`. Require a complete `context` and `readiness.status: "ready"`. Its automatic economic verifier accepts the exact Native20 reference contracts and supported constructor configuration. Different source or economic behavior can require additional verification. An `evidence_required` result does not authorize a wallet transaction.

## Robinhood Chain V4

Robinhood Chain uses chain ID `4663` and network identifier `eip155:4663`. Before authenticated preflight or creation, both `customLaunchApi.versions.v4` and the matching `chains[]` entry in discovery must report:

```json
{
  "publicAuthorization": true,
  "publicWrites": true,
  "releaseReady": true
}
```

Stop if a value is false or missing. An API key cannot enable an unavailable release. Install the compatible client from its immutable release and verify its checksum before use.

The following reads need no API key:

| Route | Purpose |
| --- | --- |
| `GET /v4/chains/4663/capabilities` | Request format, limits and supported client |
| `GET /v4/chains/4663/launch-guide` | Scenarios and next steps |
| `GET /v4/chains/4663/launch-coverage` | Supported contract layouts and verification requirements |

The coverage report separates what the request format can represent from what the server can verify. For example, `tokenAndHookMayShareAddress: false` describes the separate-contract V4 profile; shared token/hook projects use MultiRole. V4 profile 4.1 describes one native ETH/token pool. Multiple pools, projects without a pool and other settlement models need the support reported for that architecture.

Coverage always reports `requestAuthorized: false`. Run preflight for the exact project before creating a launch. A missing report or unknown report version is not a reason to rotate a key or assume support.

## Credentials and permissions

Create or reuse a suitable key in the [API-key manager](https://programmable.market/developers/api-keys). The key needs the selected chain grant and the scope for each operation:

| Scope | Operations |
| --- | --- |
| `custom-launch:create` | Preflight and create |
| `custom-launch:read` | List, status and wallet handoff reads |

A wallet key's bound address must match the request controller. A read-only key cannot preflight or create a launch. A module-contribution key does not grant Custom Launch access.

Partner roots and bounded subkeys follow `customLaunchApi.partnerCredentials`. A partner root sees every launch attributed to that partner. A subkey sees only its own stable lineage. Rotation preserves that lineage for the replacement credential and revokes the old key; a newly issued subkey starts a separate lineage. Partner credentials still require the selected controller to sign the transaction.

Keep the key in an encrypted secret store and provide it to the client as `PROGRAMMABLE_API_KEY`. Send `Authorization: Bearer` only to `https://api.programmable.market`. Keep the key out of source files, logs, screenshots and messages. The CLI never signs or broadcasts a wallet transaction.

## Existing-project integration

Inspect the project's source before choosing a profile or packing a request:

1. Pin the source repository and exact commit containing every submitted source file and dependency.
2. Preserve the exact compiler version, Standard JSON inputs, ABI, creation and runtime bytecode, libraries and constructor values. Include source contents in the build inputs; source URLs alone are insufficient.
3. Map the contracts and their address dependencies. Declare the hook permissions, pool, funding, reserves, liquidity ownership and withdrawal rules.
4. Add the required token metadata and project links. Follow the selected schema's image rules: V4 accepts PNG or single-frame GIF.
5. Create `programmable-launch.config.json` using that profile's schema. Let the packer derive hashes, salts, predicted addresses and request bytes. Do not enter derived hashes by hand.

The `verificationBundle` binds the submitted source and build to the deployment. `agentAttestation` records checks actually run; it does not establish an audit or platform approval.

Remote preflight checks the packed request before creation. It consumes the authenticated request rate budget but no launch-creation quota, allocates no nonce and persists no launch. Read `launchEligibility`, findings and remediation before proceeding. The server makes the authorization decision after submission and the required transaction simulation.

For `action_required`, follow the returned repair instructions, rebuild and submit a new immutable request when required. It is not a wallet action. Wider key permissions cannot repair source code or supply missing verification. Discovery's `customLaunchApi.agentIntegration` provides the matching remediation catalog. The selected profile determines which verification is required.

## Fees, funding and liquidity

The Robinhood Native20 fee is **20 bps (0.20%)** of the gross native ETH amount per successful buy or sell, rounded up to the next wei. A 1 ETH gross trade credits 0.002 ETH to Programmable. Creator fees and pool LP fees are additional. The platform recipient is fixed at `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`; claiming pays that recipient regardless of who triggers it.

Set creator buy and sell fees explicitly. Zero creator fees produce no Creator Rewards from those trades. Historical Ethereum contracts retain their own fee policy.

For V4 profile 4.1, the `fundingPlan` records the native allocations and agreed limits in `maxLaunchValueWei` and `maxGasCostWei`. A funded launch requires an atomic initial buy worth at least USD 1 at the server's reference rate, with positive minimum token output to the launch wallet. Read `GET /v4/chains/4663/initial-buy-quote` before packing. Count the initial buy once in transaction value and budget gas separately. Confirm any increase in the amount or budget with the wallet owner before repacking.

Calling `PoolManager.initialize` sets the pool's starting price; it does not add liquidity. An ordinary pool needs a funded liquidity position. A project starting with zero classical LP needs contracts that hold inventory or implement custom accounting, including a working sell or redemption path. Trading volume cannot create initial liquidity from nothing.

Generic fee claiming and buyback management are outside the launch scopes. An arbitrary hook is not automatically claimable; the reserved `fees:claim` and `buybacks:manage` scopes remain disabled.

## Submit safely

Create returns HTTP `202` for a new request or `200` for an exact idempotent replay. Save the original request bytes, `Idempotency-Key` and response. After a timeout, `429` or explicitly retryable `503`, retry the same operation with those exact bytes and key. Honor `Retry-After`. Repacking can change the request and must not be used to recover an uncertain submission.

`TX_SIMULATION_PENDING` with `launchEligibility.deployable: true` means creation performs the remaining transaction simulation. It does not indicate a failed API key or a completed launch. The response `requestHash` is the server's canonical digest, separate from the CLI receipt's SHA-256 of the request file.

## Lifecycle and wallet handoff

Poll the returned launch's single-resource route, `GET /v4/chains/4663/custom-launches/{launchId}`. For V4 CLI output, use `resource.launchId`; the support `requestId` is a different identifier. The detail response provides the current result and wallet handoff.

| V4 status | What to do |
| --- | --- |
| `received`, `validating` | Wait while the server checks the request. |
| `action_required` | Follow the returned remediation. This is not a wallet action. |
| `authorized`, `awaiting_wallet_signature`, `wallet_action_required` | Open the current handoff and review the exact wallet transaction. |
| `submitted` | Wait for chain confirmation. |
| `sequencer_soft_confirmed` | Wait; sequencer confirmation can still be reversed. |
| `ethereum_posted` | Wait for the configured Ethereum finality. |
| `finalized` | The launch satisfies the published finality policy. |
| `failed` | Read the failure before preparing another request. |

Use the response's `walletHandoffUrl` before `expiresAt`. Check chain `4663`, controller, Router address, calldata and value in the wallet. After expiry, fetch the current status and check for an existing transaction before preparing a replacement. Keep signing and broadcast as explicit wallet actions.

MultiRole uses its returned `statusUrl` and its own client's status and finality commands. Preserve the original launch ID and context when recovering a request.

## Exact-source status

Source verification starts after `finalized`. The server reports `queued`, `retrying`, `exact_match` or `needs_attention`; every required component must reach `exact_match` before the project is described as source verified. A provider result alone is insufficient. Explorer retries or failures do not change launch finality.

Finalized launches become eligible for Explore and the connected wallet's Profile as discovery refreshes. Source verification, indexing and trading support have separate results. A launch stamp records deployment provenance; it is not an audit or a guarantee of liquidity or safety.

## Ethereum Custom

Ethereum Mainnet uses V3 with chain ID `1` and its own schemas, funding rules and finality policy. Follow the Ethereum section of the versioned reference linked above. V1 and V2 creation are read-only: new requests return non-retryable `409 CUSTOM_LAUNCH_V1_READ_ONLY` or `409 CUSTOM_LAUNCH_V2_READ_ONLY`. Existing resources retain their original contract.

V3 `prepared` means the artifact exists but there is no wallet transaction to sign. `authorized` supplies the wallet transaction after the required server checks. EIP-3009 funding has a separate funding-signature step before the Router transaction. Neither action can be performed by an API key.

## Errors and support

| Response | Next step |
| --- | --- |
| `401 UNAUTHENTICATED` | Check that the intended key is present, active and unexpired. |
| `403 INSUFFICIENT_SCOPE` | Use a key with the scope for this operation. |
| `403 CHAIN_NOT_ALLOWED` | Check the key's grant for the intended chain. |
| `WALLET_BINDING_MISMATCH` | Match the controller to the key's wallet binding. |
| Detail `404 NOT_FOUND` | Check the launch ID, API version, chain and credential lineage. |
| `409 IDEMPOTENCY_CONFLICT` | Recover the request already bound to that key. Use a new idempotency key only for a deliberate new request. |
| `503 PLAN_OPERATION_DISABLED` | Check the selected operation in capabilities. A new key does not enable it. |
| `422` or `evidence_required` | Follow the reported source, funding or verification requirement. |
| `429` or explicitly retryable `503` | Honor `Retry-After` and preserve the original request bytes. |
| Expired permit | Check the existing request and transaction before preparing a replacement. |

For support, provide the public error code, HTTP status, UTC time and `error.requestId`. Include the launch ID when one exists. Never send an API key or wallet secret.
