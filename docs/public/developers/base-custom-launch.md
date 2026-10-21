---
description: Launch and index exact-source Custom Launch coins on Base
---

# Base Custom Launch API

Launch a coin with your own Solidity contracts on Base, chain ID `8453` (`eip155:8453`). This interface uses the same exact-source graph review and controller-wallet signing flow as Ethereum. Base currently supports Custom Launch through the API. Module Mode is not offered on Base.

## Before building

Read [live capabilities](https://api.programmable.market/v4/chains/8453/capabilities) and [readiness](https://api.programmable.market/v4/chains/8453/readiness). Require `mode: "active"`, `ready: true` and `publicLaunchAuthorized: true` before telling a user that public launching is available. `canary` admits only the release operator. Documentation and deployed contracts alone do not activate public requests.

Use the [Base API reference](https://programmable.market/openapi/base-custom-launch-v1.json). The endpoint is chain-qualified V4; its exact request schema is `programmable.custom-launch-create-request.v3`, with `chainId: "8453"` and the complete Base profile returned by capabilities. Do not send the Robinhood V4 request layout or substitute Ethereum contract addresses.

Create a wallet API key in the [Base setup](https://programmable.market/developers/api-keys?guide=custom-hook&chainId=8453), with `custom-launch:create` and `custom-launch:read` and a Base grant. The request's `launchWallet` must match that key's wallet. Partner keys are not accepted on this route. Fund that wallet with ETH on Base for deployment, initial liquidity and gas. An Ethereum balance cannot pay Base gas.

## Prepare, review and launch

1. Compile with the exact compiler and settings. Include the complete source closure, creation bytecode, constructor bindings and materialized runtime for every target and relevant externally created contract. Include complete token metadata, image and project links.
2. Build the exact Base profile `3.6.0` graph. The graph has 3–16 targets and supports native ETH or an ERC-20 quote, with funding through the controller transaction's value. EIP-3009 funding is not enabled on Base. `buildProtectedBaseLaunchV1` in the current launch client builds the protected native-ETH reference package; arbitrary contracts still require their own full review.
3. Preflight the exact request, then submit it once with a stable idempotency key. Keep the returned request ID. Reuse exactly the same request bytes and key after an uncertain network response.
4. Follow the request's review status and feedback. Approval applies only to the exact submitted version. A changes request needs a corrected source package; do not create duplicate submissions for an unchanged package.
5. Once authorized, follow its wallet handoff to Programmable. Verify Base, the controller, router, value and calldata. The controller wallet signs and sends the transaction.
6. Poll the request until finalized. Verify the transaction and resulting token, hook and pool against the returned evidence. The finalized public feed supplies automatic Explore indexing.

| Method | Route | Authentication |
| --- | --- | --- |
| GET | `/v4/chains/8453/capabilities` | None |
| GET | `/v4/chains/8453/readiness` | None |
| POST | `/v4/chains/8453/custom-launches/preflight` | Wallet API key, create scope |
| POST | `/v4/chains/8453/custom-launches` | Wallet API key, create scope; `Idempotency-Key` |
| GET | `/v4/chains/8453/custom-launches` | Wallet API key, read scope |
| GET | `/v4/chains/8453/custom-launches/{launchId}` | Wallet API key, read scope |
| GET | `/v4/chains/8453/finalized-custom-launches` | None |

```sh
curl --fail-with-body https://api.programmable.market/v4/chains/8453/custom-launches/preflight \
  -H "Authorization: Bearer $PROGRAMMABLE_API_KEY" \
  -H 'Content-Type: application/json' --data-binary @launch.json

curl --fail-with-body https://api.programmable.market/v4/chains/8453/custom-launches \
  -H "Authorization: Bearer $PROGRAMMABLE_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: your-stable-request-id' --data-binary @launch.json
```

Use `Retry-After` for rate limits or temporary unavailability. A `503`, pending review, approval, signature or receipt each represents a different state; none replaces finality. Never expose the API key in public source or client-side code.

## Protection and fees

The Base review requires a fresh oracle check supporting at least USD 15,000 initial FDV; separate cumulative 2% supply limits for the authenticated buyer and recipient for 300 seconds; 99% total opening buy fees declining to normal fees over 30 seconds; and working sells. The developer and at most six fixed extra wallets may be exempt only from the opening surcharge. Caps still apply. Protection, surcharge custody and normal fees remain separate.

The additional opening tax goes to the fixed platform treasury. The platform receives 0.3% on buys and sells. With `pool_enforced` collection, a trading integration must not charge the platform fee a second time. Require all twelve protection scenarios and exact buy, sell and fee evidence. Exceptions granted to a particular project on another chain do not transfer to Base.

## Index Base launches

Read the unauthenticated finalized feed and follow every `nextCursor` until it is null. Use the same `cursor` query convention as the Ethereum finalized feed. Persist records before advancing the cursor. On subsequent scans, overlap the latest records and deduplicate by `(chainId, router, routerLaunchId)`. Store the request `resourceId`, `token`, `hook`, `poolManager`, `poolId`, `creator`, `poolKey`, metadata hashes and finality evidence separately. Symbols and names are display fields, not identities.

Only admit records for chain `8453` and the exact Base router below. Verify the receipt, stamp and pool initialization against independent Base providers. Check the supplied `routingFeePolicy` and token metadata readback. Retain the last known valid data if a provider fails, label it stale and retry; do not replace an unavailable feed with an empty successful index.

Base finality is tied to Ethereum finality. Require the common finalized Base checkpoint from both independent providers to cover the launch block. A sequencer receipt or an arbitrary confirmation count is insufficient. See the [Base derivation specification](https://docs.base.org/base-chain/specs/protocol/consensus/derivation).

The canonical coin page is `/token/{token}?chain=8453`. Finalized Base launches appear in the shared [Explore catalog](https://programmable.market/explore) alongside Ethereum and Robinhood launches. Verify quote assets from `poolKey`: the zero address is native ETH, and wrapped ETH is a separate asset. Match market data by chain, token, PoolManager and pool ID. An external terminal must consume this source and support the contract's actual trading route; Programmable cannot guarantee a third-party listing or swap route.

## Base deployment bindings

| Component | Address |
| --- | --- |
| Programmable Launch Stamp Router | `0xEf972d7A9e7e064Ba0842c4537d7cc697c5d2eF4` |
| Graph deployment factory | `0xB91488FEDC1d02eb365B7B5F2aCdA1A801bF692e` |
| Permit authority Safe | `0x872478Df54f15f9d0faa3936b174cDaFe70d1B97` |
| Uniswap v4 PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| Reference protected route: Universal Router 2.1.2 | `0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Platform treasury | `0xD88539d3c4C460136a733A3Fd60cf6BF269079da` |

Use the current release's runtime hashes and policy from capabilities, not addresses copied from another network. Uniswap's [deployment registry](https://developers.uniswap.org/docs/protocols/v4/deployments) describes its Base contracts. For the wider integration model, read [Index launches](https://programmable.market/docs/developers/indexing).
