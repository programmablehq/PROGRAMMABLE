---
description: Verify existing Native and Engine launches with their original source contracts
---

# Native and Engine indexing

This reference covers the earlier Native and Engine sources on Robinhood Chain, `eip155:4663`. For Foundation coins, use [Foundation indexing](https://programmable.market/docs/developers/foundation-indexing).

Select the adapter by source version. Coins with and without modules use the same launch identity; the selected modules are configuration attached to that record.

## Source versions

| Source version | ABI and verifier |
| --- | --- |
| `module-native-v1` | Native V1 launch and configuration commitments, described below |
| `module-native-v2` | ABI selector in `lib/module-mode/native-abi.ts`; verifier in `lib/module-mode/provenance-v2.ts` |
| `module-engine-v1` | ABI and verifier in `lib/module-engine/index/abi-v1.ts` and `provenance-v1.ts` |

Bind the adapter to the installed release's deployment, source and finalized lifecycle evidence. The public `/api/module-mode/indexer/v1` contract covers Native V1 only. A source interface describes how to verify a launch; its deployment evidence establishes where that interface applies.

For Engine, verify the creator against the host's launch record and canonical launch parameters, including smart-wallet calls. Verify the token through the pinned factory, CREATE2 inputs and metadata, then check the engine instance and admitted revision against their constructor and runtime commitments. Each token instance can have its own runtime hash. Retain verified escrow or settlement coins that have no pool.

## Start with discovery

The public [Native V1 indexer contract](https://programmable.market/api/module-mode/indexer/v1) supplies the ABI, event topics, identity fields, metadata format and release path. It uses the same ABI as the website verifier.

```sh
curl --fail --silent --show-error https://programmable.market/api/module-mode/indexer/v1
curl --fail --silent --show-error https://programmable.market/api/module-mode
```

The second response's `release` must have schema `programmable.module-mode-source.v1`, `sourceVersion: "module-native-v1"`, `chainId: 4663`, `enabled: true` and `status: "active"` before you accept it as a new source. Stop source activation if the release is missing or unsupported.

Bind the launcher address and runtime hash from `release.contracts.launcher`, dependencies from `release.contracts` and scan origin from `release.startBlock`. Verify `releaseDigest` with the published release implementation and retain the profile, `sourceCommit` and underlying deployment, source and lifecycle evidence. Keep each historical binding when discovery selects another release.

## Discover and verify a launch

1. **Verify the source.** Check RPC chain ID 4663 and the launcher's runtime hash against the release.
2. **Collect candidates.** Scan `ModuleNativeLaunched` from `release.startBlock` in bounded ranges. Split rejected or truncated ranges so that no launches are skipped.
3. **Verify the receipt.** Require success and check the emitter, transaction hash, block number and hash, log index and canonical ABI encoding. Reject removed logs.
4. **Match the launch record.** At the receipt's canonical block, read `launchIdentityVersion()`, `getLaunch(token)` and `getLaunchIdentity(token)`. Require version 1 and agreement on launch ID, launching wallet, token, pool, hook and recipe. Check the PoolManager against the release.
5. **Verify configuration.** Correlate `ModuleNativeProgramBound`, `ModuleNativeConfigurationBound` and `ModuleNativeTokenIdentityBound` in the same receipt. At the same canonical block, check the runtime, launch key, funding, token identity, PoolKey, registry revisions and module instances. Recompute the recipe, program, launch and instance commitments with the release's verifier.
6. **Finalize and save.** Authenticate finality, store the record and advance the checkpoint only after the complete range passes.

The verifier checks supplied evidence. Your collector must authenticate the RPC results, receipt inclusion, deployed code and rollup finality before passing that evidence to it.

## Finality and checkpoints

Native V1 uses `robinhood-ethereum-finalized-v1`. Establish the transaction's L2 block, rollup batch membership and Ethereum batch posting at or before the common finalized Ethereum checkpoint. The reference collector compares two independent L2 observations and two independent Ethereum providers. A sequencer receipt alone does not meet this policy.

Keep a checkpoint for `(chainId, sourceAddress, sourceReleaseDigest)`, with its block number and hash. Process logs in block, transaction and log order, then commit rows and checkpoint atomically. A failed or incomplete range must not advance it.

On restart, compare checkpoint hashes with the canonical chain. Roll back to the last matching checkpoint and replay after a reorganization. Retry temporary provider errors with bounded backoff and retain previously verified rows with their freshness.

## Record identity

| Identity | Key |
| --- | --- |
| Coin | `(chainId, tokenAddress)` |
| Pool | `(chainId, poolManager, poolId)` |
| Launch | `(chainId, sourceAddress, launchId)` |
| Event | `(chainId, blockHash, transactionHash, logIndex)` |

Normalize addresses for comparison, preserve integer amounts and deduplicate before committing a batch. The creator is `ModuleNativeLaunched.launchWallet`, checked against the launcher getters. Relayers and later fee-recipient changes do not alter this identity.

The normalized Native V1 record contains:

| Field | Meaning |
| --- | --- |
| `sourceKind` | `module-native-v1` |
| `sourceAddress`, `sourceReleaseDigest` | Verified launcher and release |
| `launchId`, `tokenAddress`, `creator` | Launch, token and launching wallet |
| `poolManager`, `poolId`, `hookAddress` | Pool and host hook |
| `recipeHash`, `runtime`, `launchKey` | Configuration and runtime binding |
| `modulePackageIds`, `moduleFamilyIds` | Selected revision and family IDs in recorded order |
| `transactionHash`, `blockNumber`, `blockHash`, `logIndex` | Launch-event coordinates; `blockNumber` is a decimal string |
| `launchedAt`, `name`, `symbol`, `decimals` | Launch time and token metadata |
| `verificationDigest` | Verification artifact identity |
| `routerAddress`, `stampHash` | `null`; Native launches do not require a Custom Router stamp |

## Preserve module configuration

Package and family IDs are opaque `bytes32` values. Keep selected revisions, configuration bytes, instance addresses and commitments in the order defined by the source. An empty selection is valid.

Read revision evidence at the launch block. Disabling a revision for future launches does not remove existing coins or change their configuration. Unfamiliar module names, missing controls or unsupported trading behavior must not remove a verified launch. Track those capabilities separately.

## Read token metadata

After verifying the token address, call `metadata()`. It returns `(string description, string website, string image, bytes extraData)`. The image and website are public HTTPS URLs.

`extraData` is optional UTF-8 JSON with version `v: 1` and supported fields `x`, `telegram`, `discord`, `github` and `gitbook`. The builder's Twitter field maps to `x`; the website stays in the separate `website` value.

```json
{"v":1,"x":"https://x.com/project"}
```

Empty `extraData` (`0x`) and absent fields are valid. Limits are 512 UTF-8 bytes per social URL, 1,200 bytes for encoded JSON and 2,048 bytes each for image and website URLs. Validate HTTPS and the supported platform hosts before rendering links. GitBook may use a custom public HTTPS domain. Treat all metadata as display data and never execute its content.

For the launch commitment, compute `keccak256(abi.encode(name, symbol, metadata))`, where `metadata` is the tuple `(description, website, image, extraData)`. Match it to `ModuleNativeConfigurationBound.metadataHash` in the verified receipt. The indexer contract's `tokenMetadata` object provides the getter ABI, field mapping and default image URL. Missing images, malformed optional links and unsupported metadata versions leave the launch identity intact.

## Website reads and archive indexing

`GET /api/explore/robinhood` provides website listings. `GET /api/profile/robinhood?account={launchWallet}` looks up a creator's coins. Both return `status`, `updatedAt`, `items` and pagination; follow `page.totalPages` and `page.hasMore` to read every page.

`GET /api/explore/robinhood/presentation?token={tokenAddress}` adds `imageUrl`, `description`, labeled `links` and optional market data. Explore also includes this presentation data.

These endpoints apply website visibility and display filters. For a complete archive, scan the bound launch contract and maintain its checkpoint. A displayed coin count cannot establish scan coverage.

## Check the integration

Exercise coins with no modules, configured coins, unfamiliar module IDs, disabled historical revisions and relayed launches. Also test duplicate logs, incomplete ranges and changed checkpoint hashes. Invalid source, receipt, configuration or finality evidence must prevent admission; missing optional metadata must leave a verified record intact.
