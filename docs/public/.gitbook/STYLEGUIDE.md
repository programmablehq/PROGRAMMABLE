# Programmable documentation styleguide

## Readers and purpose

Programmable documentation serves token creators, hook developers, integrators, researchers and people verifying a launch. A reader should be able to understand what is public now, what an interface does, where a fact comes from and which action still belongs to a wallet or maintainer.

The documentation explains the product without turning technical evidence into a marketing claim. It separates caller-declared source evidence, API preparation, wallet execution, chain finality, indexing, price data and liquidity data because those states prove different things.

## Voice

Write calm, direct English in complete sentences. Sound like a knowledgeable person explaining the product to another capable person. Prefer a clear paragraph over a slogan, a stack of fragments or a long list of claims.

Use restrained language. Do not describe the product as revolutionary, effortless, risk free, fully secure or guaranteed. Do not use emojis, launch hype, artificial urgency or phrases such as “the goal is simple,” “our mission,” “game changer” and “built for everyone.”

## Facts and time

Write in the present tense when a capability is publicly available and supported by current evidence. Write “planned,” “not public” or “not activated” when that is the current state. Never move a future capability into the present tense to make the product sound further along.

Treat a green check, merged pull request, repository release, wallet transaction, finalized receipt, public index entry and fresh price response as separate facts. A successful check does not prove launch authority or chain execution. A visible token does not prove fresh valuation data. A published policy does not prove that every current contract already implements it.

When a fact can drift, link readers to the live status endpoint, developer manifest, contract address, release or canonical repository instead of copying an unqualified claim.

## Product terminology

Use “Programmable” with this capitalization. Use “Classic” and “Custom” for the documented launch models. Use “Custom project” for one concrete project and token bundle prepared through the authenticated Custom Launch API. Use “hook” only when the technical mechanism matters, and explain it in plain English when it first appears on a reader facing page.

Identify a token by contract address when identity matters. Distinguish a token contract from its pool, hook, launcher, Registry record, price record and liquidity record.

Use percentages in explanations written for creators and token holders. Write “0.1% of the amount exchanged,” not “10 bps.” When a contract or API field uses basis points, keep the literal field name in code formatting and translate its value into a percentage in the surrounding sentence.

Do not use “market” as a general substitute for a token, pool, trade, price, valuation or liquidity. Name the exact thing. Keep the word only when it is part of an official name, domain or unavoidable established term.

Use “protocol revenue” for revenue attributed under the published Programmable policy. Do not call it trading volume, token rewards or creator earnings. State the active processor split separately from a newer published target when they differ.

## Structure

Use sentence case headings without terminal punctuation. Start each page with the decision or understanding the reader needs, then provide the evidence, process and relevant boundary.

Do not use an em dash, en dash or hyphen as sentence punctuation. Prefer a comma, a full stop or a complete sentence. Keep hyphens only where they are required by code, a URL or an official name.

Keep navigation categories small. Prefer one complete page over several thin pages that repeat the same introduction. Use tables for exact mappings, addresses, status comparisons and repeated fields. Use ordered steps only when order changes the outcome.

Links should name their destination or action. Do not use “click here.” Code, addresses, endpoint paths, repository tags and configuration keys use inline code formatting.

## Procedures

State prerequisites before the first action. Use imperative verbs for steps and keep one consequential action in each step. Explain what the reader should verify after an action when the interface or chain can fail independently.

Never ask a reader to paste a private key, seed phrase, wallet signature, API secret or credential into documentation, an issue, a pull request or the GitBook Assistant.

## Errors and unavailable information

Describe what failed, what remains unchanged and what the reader can verify next. Do not blame the reader. Do not hide an unavailable value behind zero, “live” or a fabricated estimate.

If official sources do not establish a fact, say that it is unavailable. If a service is operational while its source snapshot is stale, state both conditions.

## Accessibility

Use meaningful alt text when an image carries information and empty alt text when it is decorative. Do not rely on color alone. Use descriptive link text, a logical heading order and complete labels for controls and fields.

## Ownership

The canonical public documentation source lives in the `programmablehq/PROGRAMMABLE` repository under `docs/public`. Changes are reviewed through the production branch and GitBook publishes the synced result. When product state changes, update the evidence and the explanatory copy together.
