---
description: Verify Custom Launch provenance, finality and source evidence on Robinhood Chain
---

# Index Custom Launches on Robinhood

Custom Launches on Robinhood Chain use two Router interfaces. Select the one identified by the source's published route and Router protocol.

| Contract layout | Reference |
| --- | --- |
| Separate token and hook contracts | [V4 with Router V1](#resolve-the-v4-source) |
| Shared token/hook or other supported combined roles | [MultiRole V2 with Router V2](#multirole-v2) |

The V4 procedure below requires feed validation, Router verification, Ethereum finality and exact source matching before applying the **Programmable Custom** label. Module Mode has its own [indexing sources](indexing.md).

## Resolve the V4 source

Start with discovery to find the deployment and schemas your adapter must verify.

| Resource | Purpose |
| --- | --- |
| [Discovery](https://programmable.market/.well-known/programmable.json) | V4 paths, schemas and write-activation gates |
| [Capabilities](https://api.programmable.market/v4/chains/4663/capabilities) | `chainDeployment` and `chainDeploymentDescriptorDigest`, including runtime hashes and finality policy |
| [Readiness](https://api.programmable.market/v4/chains/4663/readiness) | Matching source commit, source tree, policy, deployment identity and `openApiSha256` |
| [Finalized feed](https://api.programmable.market/v4/chains/4663/finalized-custom-launches) | Public launch candidates; no API key required |
| [Router V1 ABI](https://programmable.market/contracts/robinhood/ProgrammableLaunchStampRouterV1.abi.json) | Event decoding and registry reads |

Use `chainDeployment` from capabilities and require the same binding in readiness and each finalized item. Discovery's top-level `manifestUrl` belongs to the Ethereum V2 API; it does not describe this Robinhood source.

Download the OpenAPI URL selected by discovery. Hash its exact response bytes as `sha256:<lowercase hex>` and compare the result with readiness `openApiSha256` before generating types or validating the feed. A missing or mismatched digest makes the schema `UNAVAILABLE`. The V4.1 and historical V4.0 schemas have different digests.

## Bind the exact identity

Check the source identity before accepting any records:

| Field | Required value |
| --- | --- |
| `chainId` | `4663` |
| `caip2` | `eip155:4663` |
| `chainDeploymentId` | `robinhood-mainnet-custom-launch-v1` |
| `platformId` | `programmable` |
| `category` | `custom` |
| Stamp generation | `programmable-launch-stamp-router-v1` |
| Router launch kind | `LaunchKindV1.CustomGraph = 1` |
| Provenance key | `(eip155:4663, onchain.router, onchain.routerLaunchId)` |

`launchId` is the API request UUID; `onchain.routerLaunchId` is the Router ID. Store both. Read the token address from `launchStamp(onchain.routerLaunchId)` at the verified L2 receipt block. `projectMetadata.token` contains name and symbol metadata, not the token address.

### Verify the Router binding

Scan from block `50469365`. At each item's `onchain.l2Inclusion.blockNumber`, check these addresses and runtime hashes against the deployment binding and independent provider reads:

| Component | Address | Runtime Keccak-256 |
| --- | --- | --- |
| Launch Stamp Router V1 | `0x34965F2A2ee9254522232C32F02056E92BE0C98a` | `0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388` |
| Graph Factory | `0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd` | `0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8` |
| Permit authority | `0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06` | `0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c` |
| PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | `0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626` |

Before decoding, check the downloaded ABI's SHA-256:

```text
bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86
```

The profile-normalized ABI uses one `jq -cS` serialization followed by LF and has a different SHA-256:

```text
ab25262ce1cb907eba1cb820492754c0cd5d7278eb5fd6a024ba24c767323ac0
```

Verify the Router's `CHAIN_ID`, Graph Factory, permit authority and PoolManager getters. At the same canonical L2 block, verify `launchIdByToken`, `launchIdByPool`, `launchIdByComponent`, `launchStamp`, `stampProof` and `componentRuntimeCodeHash`. This generation stores the authoritative registry in the Router.

## Decode the Router events

Accept these events only from the bound Router at or after its start block:

| Full signature | `topic0` | Indexed inputs |
| --- | --- | --- |
| `ProgrammableLaunchStampedV1(bytes32,address,address,address,bytes32,bytes32)` | `0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2` | `launchId`, `token`, `hook` |
| `ProgrammableLaunchRouteStampedV1(bytes32,uint8,bytes32,bytes32,bytes32)` | `0x45e7cc355b63ca67d6278a0d8d23470ce2a0741a9c60283d7dee712df7a877a5` | `launchId`, `kind`, `routePayloadHash` |
| `ProgrammableComponentStampedV1(bytes32,address,uint8,bytes32)` | `0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b` | `launchId`, `component`, `kind` |
| `EIP712DomainChanged()` | `0x0a6387c9ea3628b88a633bb4f3b151770f70085117a15f9bf3787cda53f13d31` | None; this event does not identify a launch |

Correlate Component, Route and Launch events by launch ID in the same successful receipt. The Route event must precede the Launch event. Replay registry reads at that receipt block and verify kind `1`, token, hook, PoolManager, pool ID, route launcher, component proofs, runtime hashes and stamp commitments. Graph Factory logs alone cannot establish the Router stamp.

## Traverse and validate the finalized feed

The finalized feed provides public discovery. Private request history has a different purpose and cannot replace it.

1. **Validate each page.** Use the digest-bound OpenAPI schema: `CustomLaunchFinalizedListV4` for the response and `CustomLaunchFinalizedMetadataV4` for every item.
2. **Follow pagination.** Set `limit` from 1 to 25; the default is 10. Pass each non-null `nextCursor` back unchanged as `cursor`. A repeated cursor makes traversal `INDETERMINATE`.
3. **Check coverage.** Finish only at a null cursor with every page schema-valid and `quality.status: ready`. The global totals must satisfy `sourceRowCount == publishedRowCount`, `quarantinedRowCount == 0` and `launches.length <= publishedRowCount`. These are dataset totals, not page counts.
4. **Stop on incomplete output.** HTTP, schema or quality failures make the feed `UNAVAILABLE`. A malformed eligible candidate fails the endpoint; partial output or row-wise quarantine cannot establish a complete index.

For each item, require `platformId: programmable`, `category: custom`, `chainId: "4663"`, `caip2: "eip155:4663"`, the expected Router and `onchain.schemaVersion: programmable.custom-launch-onchain-evidence.v3`. Deduplicate by the provenance key.

When scanning Router logs, retain an overlap window and saved block hashes. After a reorganization, rewind to the last common finalized checkpoint. Save only complete ranges with their checkpoint; a Router log remains a candidate until finality and source checks pass.

## Verify finality and source

A public candidate requires `onchain.terminal: true`, `onchain.checkpointType: ethereum_finalized` and all three evidence objects:

| Evidence | Required check |
| --- | --- |
| `onchain.l2Inclusion` | Successful Robinhood receipt, block hash and exact Route and Launch log positions. Its transaction hash must equal `onchain.transactionHash`. Replay this receipt before the Router reads. |
| `onchain.l1Posting` | Ethereum batch-posting transaction and event on `eip155:1`, with rollup `0x23A19d23e89166adedbDcB432518AB01e4272D94` and SequencerInbox `0xBd0D173EEb87D57A09521c24388a12789F33ba96`. |
| `onchain.l1FinalizedCheckpoint` | Common Ethereum checkpoint tagged `finalized`. Provider readbacks must be ordered `drpc` / `drpc.org`, then `quicknode` / `quicknode.com`, matching the deployment's providers and the common block number and hash. |

`sequencer_soft_confirmed` and `ethereum_posted` are earlier lifecycle states. The deprecated flat fields `onchain.blockNumber`, `blockHash` and `logIndex` are stage projections: at finality, the block fields describe the L1 checkpoint and the log index describes the earlier L1 posting. Use the nested evidence objects to locate transactions. Historical V2 evidence needs a fully revalidated canonical V3 projection before it can enter this public feed.

Require `sourceVerification.status: exact_match` for the aggregate and every component, keyed by `targetId` and address. Verify the protected source closure, reproducible hosted build, compiler settings, finalized creation transaction, and exact creation and runtime bytecode. Sourcify alone does not establish this authority. Blockscout is optional and does not determine source matching or finality.

## Return independent result axes

Keep these results separate so that missing market support or closed write access cannot erase a verified launch.

| Axis | Result |
| --- | --- |
| Provenance | `STAMPED` after every Router check passes at the verified L2 block. `NOT_STAMPED` only after a canonical identity lookup returns zero. Otherwise `INDETERMINATE`. |
| Feed availability | `AVAILABLE` for schema-valid pages with ready quality; failures are `UNAVAILABLE`. Record whether traversal completed. |
| Finality | `FINALIZED` when all required V3 evidence agrees; otherwise `INDETERMINATE`. |
| Source verification | Aggregate and all components must be `exact_match` for publication; missing or conflicting evidence is `INDETERMINATE`. |
| Write activation | `ACTIVE`, `INACTIVE` or `UNAVAILABLE`, using the rule below. |
| Fee behavior | `UNAVAILABLE` until the launch's fee behavior is proven. Per-launch applicability stays `UNVERIFIED` without an explicit backend binding. |
| Security and market support | `UNVERIFIED` until assessed separately. Provenance and source matching do not establish safety, liquidity or a working trade route. |

Write activation is `ACTIVE` only when live discovery has `customLaunchApi.versions.v4.publicWrites`, `publicAuthorization` and `releaseReady` all exactly `true`, and readiness identifies the matching ready release. An explicit false gate gives `INACTIVE`; missing or unreadable authority gives `UNAVAILABLE`. Finalized records retain their provenance when writes close.

For fee policy, read `customLaunchApi.versions.v4.platformFeePolicy` and preserve `rateBps`, `ratePpm`, `ratePercent`, `recipient`, scope and enforcement fields. This global API requirement does not establish a fee for every historical launch. Report actual fee behavior only with evidence for that launch's applicable rate, basis, currency, recipient, rounding, accounting, accrual, claim path and onchain enforcement.

## Third-party indexing is not guaranteed

Each terminal decides whether to ingest, display or trade a launch. Read `customLaunchApi.versions.v4.externalIndexingGuaranteed` for any explicit guarantee; otherwise report external indexing as `UNVERIFIED`.

Use the [integration fixture](https://programmable.market/fixtures/robinhood-terminal-indexer-v1.json) to test constants, event decoding, pagination and failure states. It contains test data. Retain the endpoint, observation time, response status, deployment digest, Router, finality coordinates and provider identities for each verification.

## MultiRole V2

Read [MultiRole capabilities](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities) and its [versioned guide](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/guide.md). The protocol is `programmable.multi-role-launch-stamp-router.v2`. Bind the complete `context`, including `chainBindings`, deployment, profile and providers. Use the V2 Router, runtimes, events and getters from that context.

### Read finalized records

```sh
curl --fail --silent --show-error 'https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/finalized?limit=25'
```

The list schema is `programmable.multi-role-finalized-metadata-list.v2`; records use `programmable.multi-role-finalized-metadata.v2`. `limit` accepts 1 to 25 and defaults to 25. Pass each non-null `nextCursor` back unchanged and finish at null. Repeated cursors, malformed records or failed pages must not advance the checkpoint.

Keep the API UUID `apiLaunchId` separate from the lowercase bytes32 Router ID `onchainLaunchId`. Use `(caip2, chainBindings.router, onchainLaunchId)` for provenance and `(caip2, market.token)` for coin identity. A single record is available at `/finalized/{onchainLaunchId}` under the same base path.

### Preserve combined roles

Each physical component has `account`, `roleMask`, `runtimeCodeHash`, `scope` and `resultIndex`. Token and hook in one contract use role mask `3`, so `market.token` and `market.hook` may be equal. Store the component once with its full mask. Retain auxiliary components with role mask `0` as well.

Verify the V2 event bindings and getters with its published context. Router V1's `LaunchKindV1.CustomGraph` decoder and distinct-role checks do not apply. Compatible projects use this same source verification without a project-name or hook-address allowlist.

### Keep evidence coordinates separate

Public MultiRole records require protected Ethereum finality and the matching original request, source, image, artifact and permit window. Here, `onchain.blockNumber`, `blockHash` and `transactionHash` identify L2 inclusion. `onchain.ethereumPosting` identifies the L1 posting event, and `onchain.ethereumFinalizedCheckpoint` identifies the Ethereum finalized checkpoint.

Check `onchain.checkpointType: ethereum_finalized` and retain the original record's evidence and provenance hashes. Historical finalized records remain readable after their admission release changes or expires.

MultiRole reports external source publication and indexer publication separately. Sourcify and Blockscout can be `not_verified`, while indexer publication is `not_claimed`. Preserve these values alongside protected launch finality. The V4 `sourceVerification.status: exact_match` response rule does not apply to this V2 projection.

Fetch images from the record's digest-bound public path and verify their content hash and type. Treat descriptions and links as untrusted metadata. Assess market support and execution separately from the public launch record.
