# Custom AI

Describe your coin's fee rules in the [Custom AI chat](https://programmable.market/launch/custom-ai), review the result and confirm the launch in your wallet. Ethereum and Robinhood are supported. Accepted drafts do not need a manual submission review.

The chat can fill in the name, ticker, chain, pair token and initial buy. Choose an image, review the checked rules and select **Launch coin**. The final action confirms that exact version. Keep an interrupted launch open so its saved wallet transaction can be checked again.

## Fixed rules

Every coin has 1 billion tokens with no later mint, burn, transfer tax, blacklist, pause or upgrade authority. Its pre-buy value starts at $15,000, with tick rounding up to $15,091.50. The initial buy must be worth at least 0.01 ETH; network fees are separate. There is no maximum purchase or holding limit.

Initial one-sided liquidity stays locked. Buys and sells change the pool reserves and price. The platform receives 0.5% on buys and sells, and total trading fees cannot exceed 15%. Normal token transfers are free.

## Supported behavior

The current builder creates immutable fee rules and schedules, including different buy and sell fees and changes over time. For example, a coin can charge a 3% total fee for its first day, then 1%. The schedule starts when the coin launches.

Edits use the saved contract and show whether the requested change was applied. Checked fee examples show the expected buy and sell fees over time. A new conversation can keep the existing design. The usage menu shows remaining generation credits and their reset times. Known provider outages preserve your design; a rejected provider request returns your generation allowance. A lost connection checks the saved request instead of generating it again.

The chat can look up public sources, indexed markets and basic onchain contract information. It includes source links; research does not establish that a contract is safe.

Event rules require a connected, named data feed. Optional funded programs support fixed distributions, proportional staking rewards and buybacks with a fixed batch cap and minimum exchange rate. These new launch paths remain unavailable until enabled on the selected network; the chat says when a design is only prepared for testing. Execution is permissionless and its timing is not guaranteed. The combined builder can prepare versioned time and event rules with locked-liquidity allocations. This path remains unavailable for public launches until its network deployment, data service and execution service have matching acceptance evidence. Arbitrary reward code is unsupported.

Pair tokens must be compatible ERC20 tokens on the selected chain with a supported price reference. External tokens can have their own admin rights. Robinhood WETH is upgradeable and its bridge can burn balances; these rights are shown before launch.

## After launch

The coin appears in Explore after finality and indexing. Its coin page provides swaps and creator-fee claims. Claims pay the recipients fixed in the contracts.

The [Custom AI catalog](https://programmable.market/api/custom-ai/tokens) provides finalized launch records and its indexing status. Chat, draft and wallet-operation APIs require an authenticated website account; a Custom Launch API key does not replace that session.
