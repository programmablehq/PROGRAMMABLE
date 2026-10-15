---
description: Prepare an open Robinhood Custom Launch through the API and sign with your wallet
---

# Launch through the API

New Robinhood Custom Launches use the [Custom Launch Plan guide](https://api.programmable.market/v4/chains/4663/custom-launch-contract/guide.md). Your agent prepares the plan through the API. Your controller wallet reviews and signs the prepared transaction.

1. Read the [live capabilities](https://api.programmable.market/v4/chains/4663/custom-launch-capabilities). Require `availability.operations.create.state: "active"`, then read the [manifest](https://api.programmable.market/v4/chains/4663/custom-launch-contract/manifest.json) and [agent setup](https://api.programmable.market/v4/chains/4663/custom-launch-contract/agent-setup.json) for the current schema and binding.
2. [Create an API key](https://programmable.market/developers/api-keys) for Robinhood Chain with `custom-launch:create` and `custom-launch:read`. Give it to your agent through a secret store. Send it only to `https://api.programmable.market`; it cannot sign for your wallet.
3. For a new open plan, set `admissionPolicy` to `programmable.custom-launch-policy.provenance.v1`, `feeObligations` to `[]`, and `publication.visibility` to `listed`. The guide has complete examples. Use your own contracts and liquidity model, with the required 0.3% platform share on pool buys and sells to `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`. Document project fees and all owner controls for review. The launch stamp records provenance; it does not certify their safety or economics.
4. Preflight the exact request through `POST /v4/chains/4663/custom-launch-plans:preflight`. Resolve any binding or execution findings, then create through `POST /v4/chains/4663/custom-launch-plans` using the same packed bytes and an `Idempotency-Key`. If the result is uncertain, recover or retry with those exact bytes and key.
5. Open the returned launch in [Your launches](https://programmable.market/developers/api-keys?view=history) with its controller wallet. Keep that link through review, signing and confirmation. After approval, the open page prepares the launch automatically; choose **Sign and launch** when ready. Check the network, destination and value in your wallet before confirming. The page tracks the transaction and opens the coin after finality and public indexing.

The earlier `/v4/chains/4663/custom-launches` profile is retained for existing launch history and recovery. It does not accept new requests. Ethereum Mainnet has a [separate V3 guide](https://programmable.market/developers/custom-launch-api-v1.md).

Preflight also provides preparation hints for review. On Ethereum, read `reviewReadiness.preparation`; on Robinhood, read the `programmable.review_preparation` entry in `assurance.claims`. These point to old router or platform-fee constants, zero initial-buy amounts, missing buy evidence and declared liquidity gaps. Confirm the relevant code path, fix the mismatch and repack, or provide evidence for your custom implementation. A hint is not an automatic rejection, and declared funding is not proof that a purchase ran.

In the review console, a passed fork check means the saved buy, sell and platform-fee scenario passed for that exact version and chain. Manual approval opens the 24-hour launch window. The team's wallet still signs the launch; production trading and external terminal support are checked separately.

New approval requires passing buy and sell checks proving that the pool collects the platform’s 0.3%. The checks must match the exact submitted contracts; a website-only surcharge does not satisfy this requirement. See [Fees and liquidity](custom-launch.md#fees-funding-and-liquidity) for the current fee requirements.

## Artwork and public links

Provide the coin's real image and public project links in the launch package. For Robinhood, use `publication.name`, `publication.symbol`, `publication.imageUrl` and at least one URL in `publication.links`. For Ethereum, `projectMetadata.presentation` requires an image, a website and an X profile. Keep these values in the same packed request you submit for review.

Use a stable image URL that serves PNG, JPEG, WebP or GIF bytes with the matching image content type. A page returning HTTP 200 with HTML is not a valid logo. Check the live capabilities' `publicationPolicy` and run preflight before submitting. A permanent image error needs a corrected URL and newly packed bytes; a temporary image-host outage can retry the same request.

The approved artwork and links are kept with the exact chain and launch identity and used by Explore and the coin page once the launch is indexed. Market data from an external provider is separate. Existing signed requests and transactions are not rewritten to change their display data.

## One link from review to launch

Ethereum and Robinhood launch pages show **Review → Launch → Complete**. Use **Copy launch link** to return to the same request. Contract details, findings and review messages remain under **Details and review**.

Automatic preparation requires the submitting wallet to be connected and signed in on the open launch page. It does not sign or broadcast. Temporary preparation failures retry up to three times, honoring the server's `Retry-After`; authentication, approval and validation failures need the indicated action. The 24-hour window still starts at manual approval.

After signing, the page saves the transaction hash and follows confirmation automatically. If a Robinhood wallet loses its response, the page searches for the matching original transaction. **I already sent it** provides manual recovery when the wallet or RPC cannot supply that transaction. Do not send another transaction to resolve an unknown result.

API-only bots continue using the published owner start and polling endpoints. The website's automatic preparation does not change the API request schema, approval policy or signing permissions.
