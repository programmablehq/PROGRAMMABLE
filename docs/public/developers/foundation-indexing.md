---
description: Discover Foundation coins, verify their Uniswap v4 pools and integrate any compatible module
---

# Index Foundation launches

Foundation creates an ERC-20 coin and its Uniswap v4 pool on Robinhood Chain, `eip155:4663`. The pool exists from launch. Trading continues in that pool without a later bonding-curve migration.

Use this guide for Foundation coins, including launches with no modules. Existing Native and Engine coins have [separate source adapters](module-mode-indexing.md). A Foundation launch does not require a Custom Launch Router stamp.

## Resolve the launch source

Read [Foundation discovery](https://programmable.market/api/module-foundation) for the current release. For an existing coin, request `GET /api/module-foundation?token={checksummedTokenAddress}` to resolve its release. Retain every verified historical binding when the active factory changes. The current-release response alone is not a complete history of all factories.

The response binds `factoryVersion`, `releaseDigest`, `sourceCommit`, `startBlock`, the factory and hook deployer to their runtime code hashes. Follow its source and deployment evidence. Verify the chain, deployed code and required infrastructure before admitting a source. An unavailable response is a failed lookup, not proof that a coin no longer exists.

Use the [factory and token ABIs](https://github.com/programmablehq/PROGRAMMABLE/blob/production/lib/module-foundation/abi.ts), [pool and module readback](https://github.com/programmablehq/PROGRAMMABLE/blob/production/lib/module-foundation/readback.ts) and [discovery implementation](https://github.com/programmablehq/PROGRAMMABLE/blob/production/lib/module-foundation/discovery.ts) for the selected release. Pin the implementation used by your adapter. Contract source and deployment bindings take precedence over a moving branch reference.

| Factory version | Launch event | Record |
| --- | --- | --- |
| V3 | `FoundationLaunchedV3` | `launchOf(token)` returns `LaunchResultV2`; creator buy and sell fees are separate |
| V2 | `FoundationLaunchedV2` | `launchOf(token)` returns `LaunchResultV2` |
| V1 | `FoundationLaunched` | `launchOf(token)` returns the original result with `baseVault` |

The SDK source kind is `module-foundation-v1` for these factory versions. A version is available for new launches only when the verified discovery response selects it. Store `factoryVersion` separately. The Native V1 JSON contract at `/api/module-mode/indexer/v1` does not describe Foundation.

## Discover and verify coins

1. Scan the selected factory's launch event from its `startBlock` in bounded ranges. Use the exact versioned ABI and reject removed logs.
2. Fetch the successful receipt and verify the emitting factory, transaction hash, block hash and log index. Read `launchOf(token)` at a canonical block and match the token, hook, ledger, pool ID and position IDs to the event.
3. Read the hook's `token()`, `quote()`, `creator()`, `ledger()`, `poolKey()`, `poolId()` and `compositionHash()`. Match them to the launch record and verify their deployed code and configuration through the release's verifier.
4. Verify the token metadata commitment, selected module instances and liquidity custody. Preserve the receipt and block coordinates needed to reproduce these checks.
5. Commit complete ranges with their checkpoints. Recheck block hashes on restart; roll back and replay affected records after a reorganization.

The V2 and V3 events contain indexed `token`, `creator` and `poolId`, followed by `hook`, `ledger`, `quote`, `metadataHash`, `compositionHash`, `custodyId`, `initialBuyQuoteAmount` and the complete `LaunchResultV2`. Use the event's creator, verified against the hook. The transaction sender or a router is not a universal creator or trader identity.

The reference `readFoundationLaunchIndex` accepts windows of at most 5,000 blocks and pages of 1 to 100 entries. Traverse every returned cursor, then continue with the next window. Split dense or provider-limited ranges. The direct-transaction helper `discoverFoundationLaunch` also reconstructs launch parameters and module selections; internal factory calls need separate trace evidence.

| Identity | Key |
| --- | --- |
| Coin | `(chainId, tokenAddress)` |
| Pool | `(chainId, poolManager, poolId)` |
| Launch | `(chainId, factoryAddress, tokenAddress)` |
| Event | `(chainId, blockHash, transactionHash, logIndex)` |

Keep a checkpoint per factory and release digest. Preserve raw integer amounts. A canonical L2 receipt and Ethereum-backed finality are separate evidence: the discovery helpers establish canonical reads, not independent rollup finality. Apply the release's finality policy before marking a launch finalized.

## Read the pool and trades

Read the complete PoolKey. Foundation V2 and V3 use the sorted token and quote addresses, `fee: 0`, `tickSpacing: 60` and the launch's hook. Recompute the pool ID from the ABI-encoded PoolKey and check it against the factory and PoolManager. A v4 pool is identified by its PoolManager and pool ID, not a separate pair contract.

Read prices and liquidity through the bound Uniswap `StateView`. Decode token ordering and decimals before converting the quote price. A quote token may be any asset accepted by the release; do not replace its address with ETH or infer it from its ticker. The ETH launch option uses the bound wrapped ETH token in the Foundation pool.

Use the official Uniswap v4 Quoter and Universal Router interfaces for supported routes. Quote and simulate the complete path, including the Foundation hook, fees, output minimum and recipient. An ETH route to another quote token needs executable connecting liquidity. ERC-20 compliance alone does not establish route support. See [Uniswap v4 routing](https://developers.uniswap.org/docs/protocols/v4/guides/swapping/routing).

Index PoolManager `Swap` events for pool activity and reconcile the hook's `FoundationSwap` event for direction and quote-denominated fees:

```solidity
event FoundationSwap(
    bytes32 indexed poolId,
    address indexed router,
    bool buy,
    bool exactInput,
    uint256 grossQuote,
    uint256 platformQuote,
    uint256 creatorQuote,
    int128 coreAmount0,
    int128 coreAmount1
);
```

Read `creatorBuyFeeBps()` and `creatorSellFeeBps()` from a V3 hook. V1 and V2 hooks expose `creatorFeeBps()` for both directions. Each creator rate is fixed at launch, from 0 to 1,000 basis points in steps of 100. Add the fixed 30-basis-point platform fee for the selected direction; module shares divide the creator fee rather than add another fee. Use the verified factory version to select these getters.

`router` identifies the caller, not the end trader. Deduplicate by log position and reconcile multiple swaps within the same receipt in execution order. Hook fees are additional to the PoolKey's LP fee; `fee: 0` does not mean a free trade. Read actual fee amounts and ledger credits rather than estimating them from a rounded percentage. Claims withdraw previously accrued fees and must not count as new volume or revenue.

V2 and V3 launch position NFTs belong to `0x000000000000000000000000000000000000dEaD`. Verify the recorded position IDs, owners, approvals and liquidity against the bound PositionManager. The optional creator-funded position can be absent. V1 uses different custody; never apply V2's owner rule to a V1 record.

## Keep modules extensible

Read `moduleCount()` and every `moduleAt(index)` in their recorded order. Preserve each instance address, runtime code hash, configuration hash and full descriptor, including `moduleId` and `abiVersion`. The launch parameters also bind the module factories, descriptor hashes, configuration bytes and creator-fee shares.

Treat module IDs as opaque identifiers. Names, icons and custom controls are optional enrichment. A new module within a supported interface uses the same launch discovery; an unfamiliar module must not hide the coin. Independently enable trading and management only when the adapter supports their behavior.

A changed host, ABI or launch source needs a versioned adapter. New catalog entries do not alter the modules or hook of an existing pool. Preserve historical configurations when a module is disabled for future launches.

## Metadata and terminal display

Read `name()`, `symbol()`, `decimals()`, `totalSupply()` and `metadata()` from the verified token. The metadata getter returns `(description, website, image, extraData)`. Foundation's launch commitment is `keccak256(abi.encode(metadata))`, using the launch tuple `(name, symbol, description, imageURI, website, socialData)`. Match it to the token's `metadataHash()` and launch event.

Treat URLs and social data as untrusted display content. Missing or invalid optional metadata must not remove a verified coin. Keep price, valuation, liquidity, routing support and freshness separate from launch identity.

When external price feeds have no pool data, a verified pool price can provide a fallback. Use the actual token supply and decimals at the same block, and convert the quote asset with a current, independently supported price. Keep price multiplied by total supply in `fdvUsd`. Populate `marketCapUsd` only when the circulating supply is established. An unavailable price stays unavailable; it is not zero. Charts should show observed trades or prices and their timestamps, without inventing earlier history.

Terminals can place Foundation coins in their own discovery columns. Follow the optional [valuation-stage example](indexing.md#terminal-stages) for “New Pairs”, “Almost Bonded” and a completed column. The thresholds are display choices; Foundation has no migration transaction or replacement pool to report.
