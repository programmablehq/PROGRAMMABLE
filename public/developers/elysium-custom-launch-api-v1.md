# Elysium Custom Launch API

Launch a coin with custom Solidity contracts on Elysium mainnet, chain ID `99901` (`eip155:99901`). Elysium uses HYPE for gas. The API uses the shared source review, controller signature, launch stamp and finalized indexing workflow.

## Read live availability

Read [capabilities](https://api.programmable.market/v4/chains/99901/capabilities) and [readiness](https://api.programmable.market/v4/chains/99901/readiness) before preparing a launch. Public creation requires `mode: "active"`, `ready: true` and `publicLaunchAuthorized: true`. Canary mode admits only the release operator.

The [API reference](https://programmable.market/openapi/elysium-custom-launch-v1.json) describes the chain-qualified V4 routes. Request bodies use `programmable.custom-launch-create-request.v3`, `chainId: "99901"` and the exact Elysium profile returned by capabilities.

Create an [Elysium wallet API key](https://programmable.market/developers/api-keys?guide=custom-hook&chainId=99901) with `custom-launch:create` and `custom-launch:read`. Its wallet must match `launchWallet`. Fund that wallet with HYPE on Elysium. An API key cannot sign a wallet transaction.

## Build and submit

The Elysium builder is included in [CLI 4.4.0](https://github.com/programmablehq/PROGRAMMABLE/releases/tag/programmable-launch-v4.4.0). Verify the release asset checksums and GitHub attestations before installation. `buildProtectedElysiumLaunchV1` creates the protected native-HYPE reference package. Direct HTTP clients use the same source and review requirements.

1. Compile the complete source closure with the specified Solidity compiler and settings. Bind creation code, constructors and materialized runtime for every target and internally created component. Supply the token name, symbol, image, description and required links.
2. Build the exact Elysium profile `3.6.0` graph with 3–16 targets. Funding uses the controller transaction value. The reference builder uses native HYPE; custom ERC-20 quotes require their own reviewed configuration.
3. Preflight the request and submit it with one stable idempotency key. Preserve the request ID and exact request bytes after an uncertain network response.
4. Follow the individual review and change requests. An approval applies to the submitted source and configuration.
5. The controller reviews and signs the returned wallet action on Elysium. Preserve an uncertain wallet attempt and reconcile its original transaction before sending another.
6. Wait for the API's finalized result and source-verification result, then use the canonical coin page at `/token/{token}?chain=99901`.

Elysium does not use HyperEVM's large-block wallet setting or HyperCore account activation. Connect the wallet directly to chain `99901` using the [official network configuration](https://elysium.kinetiq.xyz/docs/connecting-to-elysium).

## Fees and launch protections

The reference package retains the $15,000 opening FDV floor, 0.3% platform fee on buys and sells, opening buy tax starting at 99% and decaying over 30 seconds, and five-minute cumulative 2% buyer and recipient limits. Up to six additional wallets can be exempted from the additional opening tax. Other custody and fee rules still apply to those wallets.

The native HYPE/USD feed on Elysium is `0x65AF2809dd2d7E1974c34730E97Ce3ac95F46FDB`. Its immutable parent relay at `0xF3dacfb76eDCc24351B5a4C6a5736c11515363eA` on HyperEVM reads the existing HYPE/USD source and sends observations through Elysium's canonical Inbox. The feed accepts only the aliased parent relay and preserves the original source timestamp. The source freshness limit is 24 hours plus 120 seconds. A delayed message does not refresh an old price.

The `pool_enforced` fee is collected by the pool. Trading integrations must not add the same platform fee again. Source review and launch admission do not establish a claim that arbitrary custom contracts are safe.

## Index and trade

Read `/v4/chains/99901/finalized-custom-launches` and follow `nextCursor` until it is null. Persist before advancing the cursor and deduplicate by `(chainId, router, routerLaunchId)`. Preserve receipt, stamp, pool, source and fee-policy evidence separately from display metadata.

Elysium is an Arbitrum Orbit chain settling to HyperEVM. Require both configured providers to agree on a finalized checkpoint covering the launch. The latest head can remain current while the finalized head trails it. Never apply HyperEVM's immediate-finality or receipt-index exceptions to Elysium.

The zero-address quote asset is native HYPE. Wrapped HYPE is a separate token. Match market observations by chain, token and pool identity. The token page supports exact transaction simulation, slippage bounds, the required token approvals, buys, sells and claims to the fixed fee recipient.

## Deployment bindings

| Component | Address |
| --- | --- |
| Programmable Launch Stamp Router | `0xEf972d7A9e7e064Ba0842c4537d7cc697c5d2eF4` |
| Graph deployment factory | `0xB91488FEDC1d02eb365B7B5F2aCdA1A801bF692e` |
| Permit authority Safe | `0x8B134A7F24C8a97B999dcce9D10Eb2966c260209` |
| Uniswap v4 PoolManager | `0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1` |
| Reference Universal Router | `0xA13f7611115752DEB2B13813BDDE16A5073e4b45` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Platform treasury | `0xD88539d3c4C460136a733A3Fd60cf6BF269079da` |

Use the runtime hashes and policy returned by live capabilities. The [official explorer](https://elysium.kinetiq.xyz/explorer) and [Uniswap deployment registry](https://developers.uniswap.org/docs/protocols/v4/deployments) provide independent network references. Module Mode is available on its existing supported networks; Elysium uses Custom Contracts.
