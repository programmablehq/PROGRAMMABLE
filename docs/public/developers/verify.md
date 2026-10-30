---
description: Check a coin against its canonical launch source
---

# Verify a launch

Start with the chain and token address. Then select the launch source and its verification rules. An address alone does not prove the network or origin.

| Source | Reference |
| --- | --- |
| Module Mode on Ethereum or Robinhood | [Foundation indexing](foundation-indexing.md) |
| Earlier Native and Engine releases | [Native and Engine indexing](module-mode-indexing.md) |
| Robinhood Custom with separate token and hook | [Router V1](robinhood-terminal-indexer.md#bind-the-exact-identity) |
| Robinhood Custom with shared token and hook | [MultiRole V2](robinhood-terminal-indexer.md#multirole-v2) |
| Ethereum Custom | [Ethereum Custom indexing](ethereum-custom-indexing.md) |
| Robinhood Custom Launch Plans | [Finalized projections](robinhood-terminal-indexer.md#custom-launch-plans) |
| Base Custom | [Base finalized feed and bindings](base-custom-launch.md#index-base-launches) |
| HyperEVM Custom | [HyperEVM finalized feed and bindings](hyperevm-custom-launch.md#index-hyperevm-launches) |

## Verify Robinhood launches

Use the selected source's deployment addresses, ABI, runtime hashes and finality rules. Check the successful transaction, emitted events and recorded contract relationships at the same canonical block.

Robinhood Foundation uses factory records and does not require a Custom Launch stamp. Earlier module releases have their own adapters. Custom V4 uses Router V1; MultiRole V2 uses Router V2 and permits one address to hold both token and hook roles.

Keep Robinhood inclusion, Ethereum posting and Ethereum finality separate. The API resource ID and onchain launch ID are also different. Follow the selected reference's exact fields.

## Verify Ethereum launches

Read the [Developer manifest](https://developers.programmable.family/api/v2/manifest) for chain ID `1`. Include both `launchStampRouter` and `extensions["programmable/launch-stamp-router-generations-v1"].routers[]`, preserving each deployment's address, range, runtime hash and ABI checksum. Follow the [Router generation procedure](ethereum-custom-indexing.md#include-every-router-generation); scanning only the primary Router omits successor launches.

Scan events from the published start block and apply the manifest's finality policy. Match the launch ID, token, hook, PoolManager and pool ID with the point lookup, `launchStamp` and `stampProof` at the same block. The hosted feed helps discover records; it does not replace these checks.

A shared infrastructure component must not be used to identify a single launch. The token lookup identifies the launch, while the pool lookup identifies the market used for trading.

Ethereum Module Mode also has a `custom-graph` Router stamp. After verifying that stamp, follow [Ethereum module verification](foundation-indexing.md#ethereum-module-launches) to bind the module implementation and graph initializer. Do not require a Robinhood factory event or exclude a launch because the Router category is `custom`.

## Verify Base and HyperEVM launches

Resolve the network's current capabilities and deployment bindings, then read its chain-qualified finalized feed. Match the token, hook, Router launch ID, PoolManager and pool ID against the receipt, launch stamp and pool initialization. Keep the API resource ID separate from the onchain launch ID.

Use two independent providers and require their common finalized checkpoint to cover the launch block. Base finality follows its Ethereum derivation. HyperEVM uses HyperBFT finality; do not apply an Ethereum L1 posting rule to it. Retain source and block evidence with the verified record.

## Record the outcome

Assign a Programmable label when identity, runtime, record and proof agree. Record missing evidence separately from conflicting evidence. An unavailable provider does not prove that a launch is invalid.

A verified origin does not establish an audit, current liquidity, sellability or trading support. Check those properties separately when your integration needs them.
