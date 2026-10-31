# Custom AI

Describe your coin's fee rules in the [Custom AI chat](https://programmable.market/launch/custom-ai), review the result and confirm the launch in your wallet. Ethereum and Robinhood are supported. Accepted drafts do not need a manual submission review.

The chat can fill in the name, ticker, chain, pair token and initial buy. Open **Coin details** to edit those settings. Choose an image, review the checked rules and select **Launch coin**. If a name, ticker or image is missing, the next action opens the relevant editor. The final launch action confirms that exact version. Keep an interrupted launch open so its saved wallet transaction can be checked again.

## Fixed rules

Every coin has 1 billion tokens with no later mint, burn, transfer tax, blacklist, pause or upgrade authority. Its pre-buy value starts at $15,000, with tick rounding up to $15,091.50. The initial buy must be worth at least 0.01 ETH; network fees are separate. There is no maximum purchase or holding limit.

Initial one-sided liquidity stays locked. Buys and sells change the pool reserves and price. The platform receives 0.5% on buys and sells, and total trading fees cannot exceed 15%. Normal token transfers are free.

## Supported behavior

The current builder creates immutable fee rules and schedules, including different buy and sell fees and changes over time. For example, a coin can charge a 3% total fee for its first day, then 1%. The schedule starts when the coin launches.

Edits use the saved contract and show whether the requested change was applied. Checked fee examples show the expected buy and sell fees over time. **New coin** starts a separate saved design; its previous conversation and unsent message remain in **Chats**. Under **Options**, **Clear messages** clears the conversation view while retaining the current coin and its rules. Options also contains saved versions, request details and remaining generation credits. Known provider outages preserve your design; a rejected provider request returns your generation allowance. A lost connection checks the saved request instead of generating it again.

**Chats** lists the private conversations for the selected wallet. **New coin** or **New chat** opens a separate saved design. Search by chat name, rename a conversation, or archive it and restore it later from **Show archived**. Unsent text and selected rule edits stay with their chat. The original wallet draft remains available after this update. Switching chats keeps a running reply attached to its original request; returning reads that saved request instead of paying for another generation.

The assistant follows the language and level of detail you use. Copy an answer or a code block with its copy action. Streaming replies respect reduced motion. If you scroll back while a reply arrives, **Latest message** takes you back to the current response.

Reloading a running reply reconnects to the saved request. It does not start another generation. If the connection is unavailable, **Reconnect to saved reply** checks that same request again. Stopping waits for confirmation; if the reply finished before the stop arrived, its saved result is shown. Unsent text and earlier unapplied changes are retained.

**Requested rules** keeps the complete design, including exclusions and open choices. Unsupported parts remain visible. A partial implementation does not replace the full request. New and changed rules retain a reference to your message; a later question keeps the same design. When a change cannot be completed, the earlier contract remains available. **Keep previous rules** restores that contract's design. Saved requirements and source checks are different states, and neither proves public activation of an external capability.

The chat can look up public sources, indexed markets and basic onchain contract information. It includes source links; research does not establish that a contract is safe.

Event rules require a connected, named data feed. Optional funded programs support fixed distributions, proportional staking rewards and buybacks with a fixed batch cap and minimum exchange rate. These new launch paths remain unavailable until enabled on the selected network; the chat says when a design is only prepared for testing. Execution is permissionless and its timing is not guaranteed. The combined builder can prepare versioned time and event rules with locked-liquidity allocations. This path remains unavailable for public launches until its network deployment, data service and execution service have matching acceptance evidence. Arbitrary reward code is unsupported.

Pair tokens must be compatible ERC20 tokens on the selected chain with a supported price reference. External tokens can have their own admin rights. Robinhood WETH is upgradeable and its bridge can burn balances; these rights are shown before launch.

## After launch

The coin appears in Explore after finality and indexing. Its coin page provides swaps and creator-fee claims. Claims pay the recipients fixed in the contracts.

The [Custom AI catalog](https://programmable.market/api/custom-ai/tokens) provides finalized launch records and its indexing status. Chat, draft and wallet-operation APIs require an authenticated website account; a Custom Launch API key does not replace that session.
