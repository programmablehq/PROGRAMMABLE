---
description: Launch, trade and index Custom Launch coins on HyperEVM
---

# HyperEVM Custom Launch

Launch a coin with your own token, hook and supporting contracts on HyperEVM, chain ID `999`. Preparation, review and wallet signing follow the same flow as Base. HyperEVM supports Custom Launch; Module Mode is not offered on this network.

Start with [live capabilities](https://api.programmable.market/v4/chains/999/capabilities) and [readiness](https://api.programmable.market/v4/chains/999/readiness). Public launching requires `mode: "active"`, `ready: true` and `publicLaunchAuthorized: true`. Use the profile and deployment bindings returned for HyperEVM.

## Prepare and launch

1. Create a wallet API key in the [HyperEVM setup](https://programmable.market/developers/api-keys?guide=custom-hook&chainId=999) with `custom-launch:create` and `custom-launch:read`. The request's launch wallet must match the key's wallet.
2. Fund that wallet with HYPE on HyperEVM for the launch, initial liquidity and gas. Activate the same wallet on HyperCore and enable large transactions before deployment. The [versioned guide](https://programmable.market/developers/hyperevm-custom-launch-api-v1.md#first-hyperevm-launch) explains this one-time setup and the client helper.
3. Prepare the complete source and compiler package, token artwork, project links and HyperEVM configuration. Preflight it through `POST /v4/chains/999/custom-launches/preflight`.
4. Submit the same package through `POST /v4/chains/999/custom-launches` with a stable `Idempotency-Key`. Keep the returned request ID and follow its review feedback. After an uncertain response, retry the exact bytes and key.
5. After approval, open the returned wallet handoff. Check HyperEVM, the controller wallet, destination, value and calldata before signing. An API key cannot sign or broadcast for the wallet.
6. Follow `GET /v4/chains/999/custom-launches/{launchId}` until finalized. Keep the original transaction hash while it is pending; do not send a second transaction to repair an unknown result.

The [versioned API guide](https://programmable.market/developers/hyperevm-custom-launch-api-v1.md) contains exact request formats, protection and fee requirements, contract bindings, and client instructions. The [OpenAPI reference](https://programmable.market/openapi/hyperevm-custom-launch-v1.json) defines the routes and fields. Use these bindings rather than copying addresses from another chain.

## Trade and claim fees

Once indexed, the coin page at `/token/{token}?chain=999` provides its supported buy and sell route and creator-fee claim. Read the actual pool currency and fee policy. Native HYPE and wrapped HYPE are different assets. A verified launch record establishes origin; trading also requires a supported route and available liquidity.

For a custom fee implementation, follow the claim method and recipient defined by its reviewed contracts. The protected reference's creator-fee claim pays its fixed creator recipient; platform fees and opening tax are separate balances.

## Index HyperEVM launches

Read the public [finalized feed](https://api.programmable.market/v4/chains/999/finalized-custom-launches). Follow each `nextCursor` until null, persist records before the cursor, and resume with overlap and deduplication. Use `(chainId, router, routerLaunchId)` as the launch identity and `(chainId, token)` as the coin identity.

Verify the receipt, launch stamp and pool initialization against the HyperEVM bindings from capabilities and two independent providers. Their common finalized checkpoint must cover the launch block. HyperEVM uses HyperBFT finality; an Ethereum L1 derivation rule does not apply.

Keep the token, hook, PoolManager, pool ID, pool key, creator, source identity, metadata and finality evidence. Enrich prices and images separately. When a provider fails, retain the last verified records, mark their freshness and retry with backoff.

Node implementations can count HyperCore system transactions differently. Compare transaction hashes, canonical blocks and ordered event contents across providers, and validate the log positions within each provider's own receipt. Store the original indices with their provider identity.

The website's [HyperEVM discovery feed](https://programmable.market/api/explore/hyperevm?page=1&pageSize=50&sort=newest) supplies the current Explore listing. It is separate from the complete finalized launch history. See [Index launches](indexing.md) for shared indexing and market-data rules.
