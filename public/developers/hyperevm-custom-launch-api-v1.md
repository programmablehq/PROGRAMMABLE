# HyperEVM Custom Launch API

Launch a coin with your own Solidity contracts on HyperEVM, chain ID `999` (`eip155:999`). This interface uses the same exact-source graph review and controller-wallet signing flow as Ethereum. HyperEVM currently supports Custom Launch through the API. Module Mode is not offered on HyperEVM.

## Before building

Read [live capabilities](https://api.programmable.market/v4/chains/999/capabilities) and [readiness](https://api.programmable.market/v4/chains/999/readiness). Require `mode: "active"`, `ready: true` and `publicLaunchAuthorized: true` before telling a user that public launching is available. `canary` admits only the release operator. Documentation and deployed contracts alone do not activate public requests.

Use the [HyperEVM API reference](https://programmable.market/openapi/hyperevm-custom-launch-v1.json). The endpoint is chain-qualified V4; its exact request schema is `programmable.custom-launch-create-request.v3`, with `chainId: "999"` and the complete HyperEVM profile returned by capabilities. Do not send the Robinhood V4 request layout or substitute Ethereum contract addresses.

Create a wallet API key in the [HyperEVM setup](https://programmable.market/developers/api-keys?guide=custom-hook&chainId=999), with `custom-launch:create` and `custom-launch:read` and a HyperEVM grant. The request's `launchWallet` must match that key's wallet. Partner keys are not accepted on this route. Fund that wallet with HYPE on HyperEVM for deployment, initial liquidity and gas. An Ethereum balance cannot pay HyperEVM gas.

The HyperEVM client is included in [CLI 4.3.0](https://github.com/programmablehq/PROGRAMMABLE/releases/tag/programmable-launch-v4.3.0). Use that immutable release and verify its published asset checksums and GitHub attestations before installation. Direct HTTP access uses the same review and signing requirements.

## First HyperEVM launch

HyperEVM uses separate small and large blocks. Custom deployments require large blocks. Activate your wallet on HyperCore once, then enable large blocks using the launch client's `enableHyperEvmLargeTransactionsV1` helper before signing the launch. HyperCore charges its one-time account activation fee; the API key cannot pay or sign for you. Use the same wallet on both layers. Once enabled, your launch follows the same review and wallet handoff as Base. Large blocks are produced roughly once per minute, so show a pending transaction until it is finalized and never resend it with a fresh nonce.

## Prepare, review and launch

1. Compile with the exact compiler and settings. Include the complete source closure, creation bytecode, constructor bindings and materialized runtime for every target and relevant externally created contract. Include complete token metadata, image and project links.
2. Build the exact HyperEVM profile `3.6.0` graph. The graph has 3–16 targets and supports native HYPE or an ERC-20 quote, with funding through the controller transaction's value. EIP-3009 funding is not enabled on HyperEVM. `buildProtectedHyperEvmLaunchV1` in the current launch client builds the protected native-HYPE reference package; arbitrary contracts still require their own full review.
3. Preflight the exact request, then submit it once with a stable idempotency key. Keep the returned request ID. Reuse exactly the same request bytes and key after an uncertain network response.
4. Follow the request's review status and feedback. Approval applies only to the exact submitted version. A changes request needs a corrected source package; do not create duplicate submissions for an unchanged package.
5. Once authorized, follow its wallet handoff to Programmable. Verify HyperEVM, the controller, router, value and calldata. The controller wallet signs and sends the transaction.
6. Poll the request until finalized. Verify the transaction and resulting token, hook and pool against the returned evidence. The finalized public feed supplies automatic Explore indexing.

| Method | Route | Authentication |
| --- | --- | --- |
| GET | `/v4/chains/999/capabilities` | None |
| GET | `/v4/chains/999/readiness` | None |
| POST | `/v4/chains/999/custom-launches/preflight` | Wallet API key, create scope |
| POST | `/v4/chains/999/custom-launches` | Wallet API key, create scope; `Idempotency-Key` |
| GET | `/v4/chains/999/custom-launches` | Wallet API key, read scope |
| GET | `/v4/chains/999/custom-launches/{launchId}` | Wallet API key, read scope |
| GET | `/v4/chains/999/finalized-custom-launches` | None |

```sh
curl --fail-with-body https://api.programmable.market/v4/chains/999/custom-launches/preflight \
  -H "Authorization: Bearer $PROGRAMMABLE_API_KEY" \
  -H 'Content-Type: application/json' --data-binary @launch.json

curl --fail-with-body https://api.programmable.market/v4/chains/999/custom-launches \
  -H "Authorization: Bearer $PROGRAMMABLE_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: your-stable-request-id' --data-binary @launch.json
```

Use `Retry-After` for rate limits or temporary unavailability. A `503`, pending review, approval, signature or receipt each represents a different state; none replaces finality. Never expose the API key in public source or client-side code.

## Protection and fees

The HyperEVM review requires a fresh oracle check supporting at least USD 15,000 initial FDV; separate cumulative 2% supply limits for the authenticated buyer and recipient for 300 seconds; 99% total opening buy fees declining to normal fees over 30 seconds; and working sells. The developer and at most six fixed extra wallets may be exempt only from the opening surcharge. Caps still apply. Protection, surcharge custody and normal fees remain separate.

The additional opening tax goes to the fixed platform treasury. The platform receives 0.3% on buys and sells. With `pool_enforced` collection, a trading integration must not charge the platform fee a second time. Require all twelve protection scenarios and exact buy, sell and fee evidence. Exceptions granted to a particular project on another chain do not transfer to HyperEVM.

## Index HyperEVM launches

Read the unauthenticated finalized feed and follow every `nextCursor` until it is null. Use the same `cursor` query convention as the Ethereum finalized feed. Persist records before advancing the cursor. On subsequent scans, overlap the latest records and deduplicate by `(chainId, router, routerLaunchId)`. Store the request `resourceId`, `token`, `hook`, `poolManager`, `poolId`, `creator`, `poolKey`, metadata hashes and finality evidence separately. Symbols and names are display fields, not identities.

Only admit records for chain `999` and the exact HyperEVM router below. Verify the receipt, stamp and pool initialization against independent HyperEVM providers. Check the supplied `routingFeePolicy` and token metadata readback. Retain the last known valid data if a provider fails, label it stale and retry; do not replace an unavailable feed with an empty successful index.

HyperEVM uses HyperBFT finality. Require the common finalized checkpoint from two independent providers to cover the launch block. Do not apply an Ethereum L1 derivation rule or an arbitrary confirmation count.

HyperCore system transactions can change the absolute transaction and log indices reported by different node implementations. For cross-provider checks, match the transaction hash, canonical block and ordered event contents, while verifying each provider's log coordinates against its own receipt. Retain the raw indices with the provider identity; an index offset alone is not a reorganization.

The canonical coin page is `/token/{token}?chain=999`. Finalized HyperEVM launches appear in the shared [Explore catalog](https://programmable.market/explore) alongside Ethereum and Robinhood launches. Verify quote assets from `poolKey`: the zero address is native HYPE, and wrapped HYPE is a separate asset. Match market data by chain, token, PoolManager and pool ID. An external terminal must consume this source and support the contract's actual trading route; Programmable cannot guarantee a third-party listing or swap route.

## HyperEVM deployment bindings

| Component | Address |
| --- | --- |
| Programmable Launch Stamp Router | `0x65AF2809dd2d7E1974c34730E97Ce3ac95F46FDB` |
| Graph deployment factory | `0xEf972d7A9e7e064Ba0842c4537d7cc697c5d2eF4` |
| Permit authority Safe | `0xe7Ca55aD80b07bf83A8f6E71Bdd66bF5D482b81b` |
| Uniswap v4 PoolManager | `0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F` |
| Reference protected route: Universal Router 2.1.2 | `0xeD270A1Bcdc63cf1356D695e7f40961d4819d6bF` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Platform treasury | `0xD88539d3c4C460136a733A3Fd60cf6BF269079da` |

Use the current release's runtime hashes and policy from capabilities, not addresses copied from another network. Uniswap's [deployment registry](https://developers.uniswap.org/docs/protocols/v4/deployments) describes its HyperEVM contracts. For the wider integration model, read [Index launches](https://programmable.market/docs/developers/indexing).

## Trading and fee claims

After finality, open `https://programmable.market/token/TOKEN_ADDRESS?chain=999` to buy or sell through the canonical Uniswap Universal Router. The website simulates the exact transaction through independent providers, applies the selected slippage limit, and requests only the allowance required for that trade. Wait for a submitted transaction before requesting another quote.

Creator fees accrue in the hook’s `feeVault`. Its `claimCreator()` method always pays the immutable creator recipient. The coin page’s Creator fees control prepares the same claim. Platform fees and opening taxes are separate balances paid to the fixed treasury; claiming them never withdraws pool liquidity.
