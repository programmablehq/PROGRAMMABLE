---
description: Check a coin against its canonical launch source
---

# Verify a launch

Start with the chain and token address. Then select the launch source and its verification rules. An address alone does not prove the network or origin.

| Source | Reference |
| --- | --- |
| Foundation | [Foundation indexing](foundation-indexing.md) |
| Earlier Native and Engine releases | [Native and Engine indexing](module-mode-indexing.md) |
| Robinhood Custom with separate token and hook | [Router V1](robinhood-terminal-indexer.md#bind-the-exact-identity) |
| Robinhood Custom with shared token and hook | [MultiRole V2](robinhood-terminal-indexer.md#multirole-v2) |
| Ethereum Router launches | The manifest procedure below |

## Verify Robinhood launches

Use the selected source's deployment addresses, ABI, runtime hashes and finality rules. Check the successful transaction, emitted events and recorded contract relationships at the same canonical block.

Foundation uses factory records and does not require a Custom Launch stamp. Earlier module releases have their own adapters. Custom V4 uses Router V1; MultiRole V2 uses Router V2 and permits one address to hold both token and hook roles.

Keep Robinhood inclusion, Ethereum posting and Ethereum finality separate. The API resource ID and onchain launch ID are also different. Follow the selected reference's exact fields.

## Verify Ethereum launches

Read the [Developer manifest](https://developers.programmable.family/api/v2/manifest), select chain ID `1` and require a live `launchStampRouter`. Verify the Router runtime hash and ABI checksum.

Scan events from the published start block and apply the manifest's finality policy. Match the launch ID, token, hook, PoolManager and pool ID with the point lookup, `launchStamp` and `stampProof` at the same block. The hosted feed helps discover records; it does not replace these checks.

A shared infrastructure component must not be used to identify a single launch. The token lookup identifies the launch, while the pool lookup identifies the market used for trading.

## Record the outcome

Assign a Programmable label when identity, runtime, record and proof agree. Record missing evidence separately from conflicting evidence. An unavailable provider does not prove that a launch is invalid.

A verified origin does not establish an audit, current liquidity, sellability or trading support. Check those properties separately when your integration needs them.
