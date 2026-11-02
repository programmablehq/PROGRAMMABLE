# Custom AI workspace flow

The conversation is the primary workspace. Coin identity and launch settings have one editor in the preview. The coin name opens the workspace menu for new coins, versions, request details and usage. Chats opens the saved conversation library. Rules remain available in a collapsed disclosure; open decisions remain visible when needed. Assistant replies have a quiet copy icon that appears on hover or keyboard focus.

Rule details start collapsed even when the design has open choices. The conversation asks for the next material choice; opening the rule disclosure shows the complete saved design and remaining implementation work. This keeps the chat compact without dropping requirements or treating unfinished work as launch-ready.

A direct request such as “okay, launch this coin” can produce a source-bound preparation action. Questions about launching and requests not to launch do not. The action is consumed once for that exact source; a reload or another chat cannot replay it. Missing details open their editor. A successful automatic review can prepare the wallet step, while sending the transaction remains an explicit wallet confirmation.

On the fee-module route, the chat command prepares the saved launch and shows Continue in wallet. It waits for restoration of any existing launch before creating a request. It never opens a transaction confirmation automatically; the wallet button continues the prepared operation.

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

The planner declares `intentMode: preserve` for an unchanged saved design and leaves its rule/edit arrays empty. The server supplies the complete saved revision. New rules, edits and answers to open choices use `revise` and the complete existing validation path; a preserve response cannot smuggle in additions or removals.

Before source generation, a completed but invalid independent check declaration gets at most one correction with the validator's feedback. The same saved intent and production context remain binding, and the corrected declaration must pass the same complete validator. Provider failures, cancellation and a rejected correction stop the attempt instead of starting a paid retry loop.

- **New coin** saves the current coin, unsent message and selected rule before clearing them. It never copies rules into the new coin.
- **Clear messages** only clears the visible conversation and composer. The current coin, saved rules and unresolved change remain in context. Its label and explanation must say so before activation.
- **Restore previous coin** restores the unsent message and selected rule as well as the coin. Switching is serialized so a double click cannot overwrite the saved coin with an empty draft.
- Actions that change context are unavailable during generation, restoration, saving a context transition or a bound wallet operation.

## Layout and access

The desktop conversation keeps most of the width. A compact preview precedes a collapsible settings editor and saved rules. On narrow screens the preview follows the conversation in normal document order. No setting is duplicated in the Options panel. Controls use native buttons/disclosures, visible focus and labels. Streaming text is not repeatedly announced; phase changes and completed messages are.

This flow describes the product interface. It does not certify a new contract, chain, feed or execution service. Capability activation continues to require its own evidence.

Canonical protected-token names and tickers bind to the current coin details, not the isolated test fixtures. Rebuilding an older declaration repairs only those metadata inputs. When the intent, source, compiler and remaining deployment values are unchanged, keep the source bytes and rerun compilation, the independent source review and the declared behavior checks for the new project identity. Previously saved proof records retain their original identity.

Exact-address contract lookup uses the selected network on Ethereum, Robinhood, Base and HyperEVM. It compares two existing providers at one recent canonical block, caps each metadata call at 100,000 gas, and shares a short cache across duplicate reads. It neither scans holders nor verifies a custom integration. Configured router and price-feed addresses are platform inputs that preparation verifies; users are not asked to supply them.

Scenario pages accept compact tuples or the equivalent complete named fields. Both formats retain the same admitted calls, types and expected observations. A saved complete page that previously failed only transport validation can be resumed under the unchanged design and interface; the full independent declaration validator still decides whether the combined examples are sufficient. Reusing a page does not certify its expectations or skip source compilation.
