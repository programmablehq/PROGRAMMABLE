# Custom AI in a browser

Open https://programmable.market/launch/custom-ai. This guide covers the website chat for a human or a browser agent using the user's existing wallet session. It is separate from the API-key Custom Launch workflow.

Read https://programmable.market/api/custom-ai/capabilities for the current chains, buildable behavior and launch-preparation availability. Source generation, compilation, checked examples and a completed wallet launch are separate states. A checked draft is not a launched coin.

## Build or edit a coin

1. Wait for the wallet session and saved chat to load. If the session takes longer, use **Reconnect wallet**. Keep any sign-in prompts with the user.
2. Check the current coin name above the conversation. Its **Chat menu** disclosure contains **New coin**, versions and request details. **Chats** opens the saved conversation library. Search and select by name. The current item is marked **Current chat**.
3. Find the textbox labelled **Describe your coin or ask a question**. A selected rule changes its label to **Describe your change to this rule**. State the intended behavior, network and any constraints. **Enter** or **Send message** submits once; **Shift + Enter** inserts a newline. The limit is 8,000 characters. An oversized paste is rejected with an explanation, not silently shortened.
4. Read the status near the composer. While building or checking, wait rather than sending again. **Stop response** requests a stop and waits for acknowledgement. The section **Build your coin** also exposes `data-chat-state`; its value is `ready`, a progress phase, `restoring`, `switching`, `reconnecting`, `stopping`, `launching`, `conflict`, `save-error` or `offline`.
5. Read the assistant's reply and the coin preview. If a change was not applied, the previous checked draft remains. Answer open questions or edit the relevant rule. Verify the network and fee examples before proceeding.
6. **Coin details** contains the name, ticker, network, pair and initial buy. **Coin rules** expands the saved requirements. **Launch coin** explains any missing image or required setting. A direct chat request such as “okay, launch it” can start preparation for the exact checked source. Check the capabilities endpoint for current availability; a visible disabled button does not mean preparation is enabled. Follow the saved wallet flow and report a launch only after its transaction and resulting coin are confirmed.

## Interruptions and recovery

- **Reconnect to saved reply** reads the existing request. A reload also resumes that request; neither should create another paid generation. Do not submit the original prompt again while its outcome is unknown.
- A slow or broken connection returns an actionable error. The browser bounds ordinary requests to 30 seconds and stream inactivity to 45 seconds, then checks the saved request. Wallet preparation and chain reads have longer bounded waits.
- **Offline** keeps the composer available for writing and disables sending. Reconnect before retrying. Optional usage reads pause while the tab is hidden or offline.
- **Retry saving** retries the saved draft. If two windows edited the same chat, choose **Keep this device’s draft** or **Use online draft** deliberately before sending.
- **Chat menu** contains versions, request details and usage. **Escape** closes the panel. **Clear messages** clears the conversation view and retains this coin's rules; it does not start another coin.
- `data-build-issue` on **Build your coin**, when present, names the failed declaration stage and a bounded diagnostic code. It is not a request to retry automatically; inspect the issue before spending another generation.

## Credentials and automation

Use the existing signed-in browser; never paste a wallet key, provider secret or API key into the chat. Session-protected `/api/custom-ai` resources are for the website session. An API key alone does not grant access to private chats or wallet signing. For programmatic Custom Launch submissions, start at https://programmable.market/developers/api-keys and the separate https://programmable.market/llms.txt discovery index.
