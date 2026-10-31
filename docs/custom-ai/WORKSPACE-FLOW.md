# Custom AI workspace flow

The conversation is the primary workspace. Coin identity and launch settings have one editor in the preview. Rules are rendered from the saved draft. Versions, request metrics and allowance are under Options, outside the primary conversation.

| State | Main action | Visible context | Recovery |
| --- | --- | --- | --- |
| New coin | Describe an idea | Blank coin identity and supported examples | Restore the previous coin or a saved version |
| Discussion | Send a clarification | Current coin name and conversation | Clear messages while retaining the same coin, or explicitly start a new coin |
| Building | Stop response | Actual generation/checking phase | Reconnect to the existing request identity; never silently regenerate |
| Change proposed or blocked | Resolve the request or keep the saved rules | Unapplied request and the previous rules | Keep previous rules restores their context |
| Checked draft, missing details | Add the first missing item | Only missing name, ticker or image is requested | Reveal and focus the relevant editor |
| Preparing | Wait for current preparation | Current chain, pair and wallet binding | Retry the failed preparation, not the build |
| Ready | Launch coin | Exact checked revision | Editing invalidates old preparation |
| Wallet action | Continue in wallet | Saved transaction progress | Resume the bound operation |
| Confirmed | View coin | Confirmed token identity and indexing status | Create another coin without altering the confirmed operation |

## Context changes

- **New coin** saves the current coin, unsent message and selected rule before clearing them. It never copies rules into the new coin.
- **Clear messages** only clears the visible conversation and composer. The current coin, saved rules and unresolved change remain in context. Its label and explanation must say so before activation.
- **Restore previous coin** restores the unsent message and selected rule as well as the coin. Switching is serialized so a double click cannot overwrite the saved coin with an empty draft.
- Actions that change context are unavailable during generation, restoration, saving a context transition or a bound wallet operation.

## Layout and access

The desktop conversation keeps most of the width. A compact preview precedes a collapsible settings editor and saved rules. On narrow screens the preview follows the conversation in normal document order. No setting is duplicated in the Options panel. Controls use native buttons/disclosures, visible focus and labels. Streaming text is not repeatedly announced; phase changes and completed messages are.

This flow describes the product interface. It does not certify a new contract, chain, feed or execution service. Capability activation continues to require its own evidence.
