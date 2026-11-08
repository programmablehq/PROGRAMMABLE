# Custom AI

Describe your coin or hook in the [Custom AI chat](https://programmable.market/launch/custom-ai). The chat keeps the agreed rules and explains which parts can be built on your selected network.

Connect and sign in with your wallet before building or saving a hook. You can write your idea first and select **Connect wallet**; the current idea is kept for your signed-in chat. Coin details, images and launch controls become available after sign-in. The active wallet is shown in the chat toolbar. Connecting does not submit a launch transaction.

Browser agents can use the same labelled controls and saved chats. The [browser workflow guide](https://programmable.market/developers/custom-ai-browser.md) describes input, progress and recovery. Read [live capabilities](https://programmable.market/api/custom-ai/capabilities) for the current network and launch-preparation scope.

When live capabilities reports `projectPlatform.state: "enabled"`, the [project workspace guide](https://programmable.market/developers/project-platform.md) covers persistent projects, editable files, private connections and application previews in that environment. Your first message creates and names a project. **Your work** lists projects and existing coin conversations together. An enabled workspace does not establish that an individual project is verified or published.

The fixed fee builder supports launches on Ethereum and Robinhood. Its accepted drafts do not need a manual submission review. General contract projects use a separate source, behavior-check and Custom Launch review process. Generating or compiling a project does not make it launch-ready.

The chat can fill in the name, ticker, chain, pair token and initial buy. Open **Coin details** to edit those settings. Choose an image, review the checked rules and select **Launch coin**. If a name, ticker or image is missing, the next action opens the relevant editor. The final launch action confirms that exact version. Keep an interrupted launch open so its saved wallet transaction can be checked again.

## Fixed rules

These rules apply to the fixed fee builder. General contract projects follow the Custom Launch policy for their selected network.

Every coin has 1 billion tokens with no later mint, burn, transfer tax, blacklist, pause or upgrade authority. Its pre-buy value starts at $15,000, with tick rounding up to $15,091.50. The initial buy must be worth at least 0.01 ETH; network fees are separate. There is no maximum purchase or holding limit.

Initial one-sided liquidity stays locked. Buys and sells change the pool reserves and price. The platform receives 0.5% on buys and sells, and total trading fees cannot exceed 15%. Normal token transfers are free.

## Supported behavior

The current builder creates immutable fee rules and schedules, including different buy and sell fees and changes over time. For example, a coin can charge a 3% total fee for its first day, then 1%. The schedule starts when the coin launches.

Edits use the saved contract and show whether the requested change was applied. Checked fee examples show the expected buy and sell fees over time. Open **Chats**, then **New chat**, to start a separate saved design. Your other chats and their unsent messages remain saved; you can reopen, rename or archive them from the same list. Known provider outages preserve your design; a rejected provider request returns your generation allowance. A lost connection checks the saved request instead of generating it again.

Checked fee drafts, composed designs and general projects support editing individual saved rules. Select
**Edit** beside a rule and describe the change in the chat. The composer shows
which rule you selected. Press **Escape** or clear the selection to return to the
whole design without losing your unsent message. Added and updated labels refer
to changes in the saved design; they do not mean a contract has passed verification.

**Chats** lists the private conversations for the selected wallet. **New coin** or **New chat** opens a separate saved design. Search by chat name, rename a conversation, or archive it and restore it later from **Show archived**. Unsent text and selected rule edits stay with their chat. The original wallet draft remains available after this update. Switching chats keeps a running reply attached to its original request; returning reads that saved request instead of paying for another generation.

The assistant follows the language and level of detail you use. Copy an answer or a code block with its copy action. Streaming replies respect reduced motion. If you scroll back while a reply arrives, **Latest message** takes you back to the current response.

Reloading a running reply reconnects to the saved request. It does not start another generation. If the connection is unavailable, **Reconnect to saved reply** checks that same request again. Stopping waits for confirmation; if the reply finished before the stop arrived, its saved result is shown. Unsent text and earlier unapplied changes are retained.

**Requested rules** keeps the complete design, including exclusions and open choices. Unsupported parts remain visible. A partial implementation does not replace the full request. New and changed rules retain a reference to your message; a later question keeps the same design. When a change cannot be completed, the earlier contract remains available. **Keep previous rules** restores that contract's design. Saved requirements and source checks are different states, and neither proves public activation of an external capability.

The chat can look up public sources, indexed markets and basic onchain contract information on Ethereum, Robinhood, Base and HyperEVM. Contract lookup stays on the selected network, compares two configured providers at the same recent block and briefly shares duplicate reads. It includes source links; research does not establish that a contract is safe.

## Fee allocations and integrations

Describe the whole mechanism in one message, for example: “Put 30% of project fees into liquidity, use 20% for buyback and burn, and distribute 20% to top holders.” The chat keeps all three actions and checks their shares. This example leaves 30% unassigned. The remaining recipient and the intended holder group are choices to settle before building; the chat can propose a compact arrangement for you to confirm.

These percentages divide collected project fees. They do not set a 70% swap tax or redirect mandatory platform fees. A liquidity deposit, a buyback, a burn and a holder distribution each need their actual contract behavior. Balanced percentages alone do not establish execution or launch readiness.

The expandable **Product plan** records the parts needed by your design: contracts, money flows, external services and interface actions. It belongs to the saved design and remains available after reloading or restoring a version. The chat can calculate a specific allocation example without querying a price provider. The example preserves any unassigned share and rounding; it does not claim that a swap, buyback or payout has executed.

For new contract builds, the plan can link actions such as deposits, claims and balance reads to specific functions in the declared contract interface. The builder checks those links against the compiled ABI and the corresponding local examples. **Contract actions** shows the linked functions inside the product plan. These source links do not activate a service or submit a transaction.

After a newly prepared product is launched, expand **Deployed contracts** and choose **Check contracts** to inspect its contract addresses. The observation matches the original saved package, finalized launch receipt and deployed code through two configured providers. It is requested only when you click and briefly cached. This confirms those contracts at the displayed time; it does not prove current claimable balances, start an external service or sign a transaction. Older packages without a saved contract snapshot remain available through their original submission.

You can also ask for different product ideas without replacing the current coin. The chat considers execution rules, incentives, liquidity, external events and treasury mechanics. Selecting a design is separate from exploring it. A planned service is not automatically hosted or funded by adding it to the plan.

For weather or other API-driven rules, describe the trigger and result in ordinary language. Keep private keys and API credentials out of the chat. The builder identifies the required integration and preserves the rule if that integration is not connected; research results alone do not activate it.

For a public JSON source with documented fields and a timestamp, the chat can prepare a private reusable reader and check an actual observation. Its definition records units, accepted values and freshness. This does not publish data onchain or start an automated service. Authenticated sources and other API formats need their own integration; credentials belong in that integration, not in a chat message or URL.

## General contract projects

You can develop contract source for Ethereum, Robinhood, Base and HyperEVM in the same chat. The project keeps its source files, compiler settings, requirements and declared behavior checks together. An edit retains existing files unless the response explicitly replaces their contents. The builder can use the supplied OpenZeppelin and Uniswap v4 libraries without downloading packages during your request.

Declared event checks compare the logs emitted by the actual local contract calls, including the emitting contract, values, order and count. A public counter or an event in the contract's ABI does not prove that the expected event was emitted. These checks are local examples, not evidence of a live launch.

Expand **Simulation** to inspect the actual return values, events and native balance changes recorded during those calls. A failed expectation still shows the value the contract returned. The preview uses local test balances, raw units and no gas charges. It records bounded details from the existing execution, without another model call or blockchain transaction. Asking about a different scenario does not by itself execute that scenario.

General projects also follow the selected network's mandatory Custom Launch policy. Temporary buyer limits count cumulative buys, and temporary recipient limits count cumulative token inflows, including wallet-to-wallet transfers. Sending tokens out does not restore that allowance. Tax-exempt wallets remain capped during the launch window; their exemption applies to the additional opening surcharge. The chat includes these fixed rules when you ask for normal ERC20 transfers and explains any explicit conflict in your design.

A completed contract-check plan stays with its saved chat, design and network. Continuing after an interrupted source build reuses that plan; changing its rules or network requires a matching plan. The earlier source remains saved when an update fails. An independent source review can require changes before launch preparation is available.

A temporary RPC outage on Base or HyperEVM does not prevent source generation when the exact network configuration is still available. The builder preserves the pinned contracts, fees and protections. Launch preparation checks current availability separately and remains unavailable while that network is blocked. Completed build messages use the actual compiler, source-review and declared-check results.

Open **Usage** from the chat menu for remaining credits and reset times. Reconnecting reads the saved request and does not start another paid generation. A new build is a separate request.

A source project may still need constructor inputs, current network data or additional behavior evidence. Those missing parts remain visible with the saved design. When [live capabilities](https://programmable.market/api/custom-ai/capabilities) report general launch preparation enabled, use **Launch coin** or ask the chat to launch. The platform prepares and automatically checks the exact saved source on the selected network. The result and available wallet steps stay in the chat. Use **Continue launch here** to inspect those steps, or **Open submission** for the full record. Sending a transaction still requires wallet confirmation. If preparation is unavailable on the selected network, the project remains a saved source draft.

For an existing Custom Launch submission, continue through its original [API workflow](../developers/custom-launch.md). Its review decision and current wallet preparation determine the next step.

The fee builder's event rules require a connected, named data feed. Its optional funded programs support fixed distributions, proportional staking rewards and buybacks with a fixed batch cap and minimum exchange rate. These new launch paths remain unavailable until enabled on the selected network; the chat says when a design is only prepared for testing. Execution is permissionless and its timing is not guaranteed. The combined builder can prepare versioned time and event rules with locked-liquidity allocations. This path remains unavailable for public launches until its network deployment, data service and execution service have matching acceptance evidence. These program templates do not execute arbitrary reward code.

Pair tokens must be compatible ERC20 tokens on the selected chain with a supported price reference. External tokens can have their own admin rights. Robinhood WETH is upgradeable and its bridge can burn balances; these rights are shown before launch.

## After launch

The coin appears in Explore after finality and indexing. Its coin page provides swaps and creator-fee claims. Claims pay the recipients fixed in the contracts.

For a saved product with bound contract actions, open **Deployed contracts** to check its deployed code. **Contract values** can then read supported values on request, including functions with no inputs and values scoped to the launch wallet. The result shows its block and observation time. A finalized value may lag recent activity and does not guarantee a later claim. Contract units are shown exactly; the chat does not guess a token denomination. This view does not send transactions or run continuous background checks.

The [Custom AI catalog](https://programmable.market/api/custom-ai/tokens) provides finalized launch records and its indexing status. Chat, draft and wallet-operation APIs require an authenticated website account; a Custom Launch API key does not replace that session.

### Working in the chat

You can upload a coin image from the message box, paste or drop an image, or choose **Attach image → Use image** for a direct public HTTPS image link. A short message such as `Use this image: https://example.org/coin.png` updates only the image. The previous image stays in place if a replacement cannot be saved.

The chat shows the current build step while it works. You can write your next message during the build; it is kept as a draft until you send it. A finished, checked hook has a summary and **Launch coin** action in the conversation. This uses the same saved-source preparation and wallet confirmation as the coin panel.

On a phone, the chat comes first. Open the coin row to change its details. Website, X profile and an optional X post are separate public links. An X post is kept as the supplied post URL and does not replace the required project profile on graph launches.

For larger source projects, the builder saves completed files and private work in progress. If a build stops, **Continue building** uses the same saved rules and resumes from the saved section. Only complete source files can reach compilation or submission. A request to strengthen the independent behavior checks carries your requested examples into a new check plan instead of reusing the old one.

Changes to an existing project keep the rest of its source intact. The builder applies exact edits to the saved files, then runs the compiler and independent checks again. If an edit cannot be applied unambiguously, the earlier source stays saved.

The conversation and coin details share the available screen. Open **Chats** to return to a saved conversation. On mobile, expand the coin row when you need its details. A submission from another chat stays under **Earlier submission**; its launch controls do not replace the current design's next step.

If a provider interrupts a check, the complete saved steps can be reused after validation. Continuing requests only the remaining work. A saved partial check plan is never reported as a completed contract or launch approval.
