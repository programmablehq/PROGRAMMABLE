---
description: Verify Foundation coins, their Uniswap v4 pools and selected modules
---

# Index Foundation launches

Foundation creates an ERC-20 coin and its Uniswap v4 pool on Robinhood Chain, `eip155:4663`. Use the factory's launch record to verify the coin, pool and selected modules. The same procedure covers coins with no modules.

Foundation does not require a Custom Launch Router stamp. Existing Native and Engine coins use [separate source adapters](module-mode-indexing.md).

## Resolve the launch source

Read [Foundation discovery](https://programmable.market/api/module-foundation) for the current release. For an existing coin, use `GET /api/module-foundation?token={checksummedTokenAddress}` to find its original release. Keep verified historical bindings when the active factory changes; current discovery alone is not a history of every factory.

The response supplies `factoryVersion`, `releaseDigest`, `sourceCommit`, `startBlock`, and the factory and hook-deployer runtime hashes. Verify these against its source and deployment evidence. Check the RPC chain, deployed code and required infrastructure before accepting the source. A failed lookup leaves the result unknown.

The [Foundation integration source](https://github.com/programmablehq/PROGRAMMABLE/tree/production/lib/module-foundation) contains the versioned ABIs in `abi.ts`, verification in `readback.ts` and discovery helpers in `discovery.ts`. Pin these files to the release's `sourceCommit` when building an adapter.

| Factory version | Launch event | `launchOf(token)` result |
| --- | --- | --- |
| V3 | `FoundationLaunchedV3` | `LaunchResultV2`; separate creator buy and sell fees |
| V2 | `FoundationLaunchedV2` | `LaunchResultV2` |
| V1 | `FoundationLaunched` | Original result with `baseVault` |

All three use SDK source kind `module-foundation-v1`; store `factoryVersion` separately. Discovery selects the version available for new launches. The Native V1 contract at `/api/module-mode/indexer/v1` does not describe Foundation.

## Discover and verify coins

1. **Find launch events.** Scan the bound factory from `startBlock` in bounded ranges, using its versioned ABI. Reject removed logs.
2. **Confirm the launch record.** Fetch the successful receipt and check its factory, transaction hash, block hash and log index. At a canonical block, compare `launchOf(token)` with the event's token, hook, ledger, pool ID and position IDs.
3. **Verify the pool and configuration.** Read the hook's `token()`, `quote()`, `creator()`, `ledger()`, `poolKey()`, `poolId()` and `compositionHash()`. Use the release's verifier to check these bindings, deployed code, token metadata commitment, module instances and liquidity custody.
4. **Save the evidence.** Retain the receipt and block coordinates, then commit each complete range with its checkpoint. Recheck saved hashes on restart and replay affected records after a reorganization.

V2 and V3 events index `token`, `creator` and `poolId`. Their remaining fields are `hook`, `ledger`, `quote`, `metadataHash`, `compositionHash`, `custodyId`, `initialBuyQuoteAmount` and the complete `LaunchResultV2`. Use the event's creator, verified against the hook; a transaction sender or router may be acting for someone else.

`readFoundationLaunchIndex` accepts windows of at most 5,000 blocks and pages of 1 to 100 entries. Follow every cursor before moving to the next window, and split dense or provider-limited ranges. `discoverFoundationLaunch` reconstructs parameters and module selections from a direct transaction; internal factory calls require trace evidence.

| Identity | Key |
| --- | --- |
| Coin | `(chainId, tokenAddress)` |
| Pool | `(chainId, poolManager, poolId)` |
| Launch | `(chainId, factoryAddress, tokenAddress)` |
| Event | `(chainId, blockHash, transactionHash, logIndex)` |

Keep a checkpoint per factory and release digest, and preserve raw integer amounts. The discovery helpers establish canonical L2 reads. Apply the release's rollup finality policy separately before marking a launch finalized.

## Read the pool and trades

For factory V2 and V3, the PoolKey contains the sorted token and quote addresses, `fee: 0`, `tickSpacing: 60` and the launch's hook. Compute the pool ID as `keccak256(abi.encode(poolKey))` and check it against the factory and PoolManager. A v4 pool is identified by its PoolManager and pool ID.

Read price and liquidity through the bound Uniswap `StateView`, accounting for token ordering and decimals. Preserve the quote asset's address. The ETH launch option uses the bound wrapped ETH token in the pool.

Quote and simulate supported routes through the official Uniswap v4 Quoter and Universal Router, including the hook, fees, minimum output and recipient. An ETH route to another quote asset also needs connecting liquidity; accepting an ERC-20 as a quote does not establish that route.

Index PoolManager `Swap` events for activity. Reconcile the hook's `FoundationSwap` event to read trade direction and quote-denominated fees:

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

For factory V3 launches, read `creatorBuyFeeBps()` and `creatorSellFeeBps()` from the hook. V1 and V2 launches use `creatorFeeBps()` for both directions. Each rate is fixed at launch, from 0 to 1,000 basis points in steps of 100. The platform adds 30 basis points per direction. Module shares divide the creator fee.

`router` identifies the caller, which may differ from the trader. Deduplicate by log position and reconcile swaps in receipt order. Read actual fee amounts and ledger credits to account for rounding. Hook fees are additional to the PoolKey's LP fee, so `fee: 0` still permits hook fees. A later claim withdraws accrued fees and adds no new trade volume or revenue.

V2 and V3 launch position NFTs belong to `0x000000000000000000000000000000000000dEaD`. Verify their recorded IDs, owners, approvals and liquidity through the bound PositionManager. The optional creator-funded position may be absent. V1 has different custody rules.

## Read selected modules

Read `moduleCount()` and each `moduleAt(index)` in order. Preserve the instance address, runtime code hash, configuration hash and full descriptor, including `moduleId` and `abiVersion`. Launch parameters also bind module factories, descriptor hashes, configuration bytes and creator-fee shares.

Treat module IDs as opaque. Names, icons and controls are display data; an unfamiliar module must not hide a verified coin. Enable trading and management only when the adapter supports the selected behavior.

A changed host, ABI or launch source needs a versioned adapter. Catalog changes do not alter an existing pool's hook or module configuration. Keep historical configurations when a module is disabled for future launches.

## Read token metadata

Read `name()`, `symbol()`, `decimals()`, `totalSupply()` and `metadata()` from the verified token. The metadata getter returns `(description, website, image, extraData)`. Reconstruct the launch tuple `(name, symbol, description, imageURI, website, socialData)` and compute `keccak256(abi.encode(metadata))`. It must match the token's `metadataHash()` and launch event.

Validate URLs and social data as untrusted display content. Missing optional metadata leaves the verified coin in the index. Keep price, liquidity, routing support and their observation times separate from identity.

A verified pool price can fill a gap in external price data. Use the token's supply and decimals at the same block, and a current independent price for the quote asset. Store price multiplied by total supply as `fdvUsd`; populate `marketCapUsd` only with an established circulating supply. Missing prices remain unavailable. Charts should contain observed trades or prices with timestamps.

The optional [terminal-stage example](indexing.md#terminal-stages) explains how to group coins by valuation. Foundation keeps its pool from launch; there is no migration transaction or replacement pool to report.
