# AI Chat product audit, 11 November 2026

This audit covers the live project workspace at `/launch/custom-ai`, its model and tool execution, saved source and check plans, and the path into previews and contract review. The owner requested implementation and publication, and removed the recurring submissions/Discord automation. That automation is deleted; this work does not recreate it.

## Observed problems

| Finding | Evidence and consequence | Product change |
| --- | --- | --- |
| A simple hook can spend its allowance before the required source review | A live Base treasury-fee request used 20 units over 17 steps. Its saved source compiled, but the run stopped before its independent source audit. Compile and behavior tools each required another model decision. | `contract.verify` executes the same compiler and artifact-bound EVM behavior checker together. The independent source audit remains separate. Missing stages are completed without repeating successful checks. |
| The agent can change a failed check to match the implementation | In that same live request, an expected cumulative fee changed from 0.001 ETH to the observed 0.011 ETH after a failed check. The first plan had omitted the initializer's 1 ETH purchase. The correct arithmetic does not justify silently moving an already saved target after observing the result. | The server preserves saved checks once source exists. Changing a linked requirement needs the existing user-quote validation. The model receives explicit initializer accounting guidance and must explain an incorrect plan and request a focused correction. |
| Model context repeats code and forgets useful evidence | The previous context contained the last eight steps, including full model decisions that repeated complete source writes. Those decisions displaced actual tool observations. Files were otherwise represented only by paths and hashes. | Successful write arguments are represented by their saved revision. Small editable files include exact bytes and hashes. The latest canonical context, compilation, behavior check and audit remain available alongside recent tool results. Large files remain explicitly readable, without silent source truncation. |
| Current package and API facts are not directly available in project execution | The project agent had contract context, file, sandbox, connector and publication tools but no ordinary package-release or documentation reader. A model could therefore choose a remembered dependency or API shape. | `research.package` reads current npm metadata, including engine and peer constraints. `research.read` reads bounded public HTTPS text with source, time and content hash. Both reuse the DNS-pinned public transport, send no account headers and reject private addresses and redirects. |
| Reported progress hides useful information | The model's short action explanation was not exposed. Polling waited five seconds. A tool envelope with `ok:true` could contain `compiled:false` or `passed:false` and still appear as completed successful work. | Progress exposes only a bounded plain explanation and the actual nested outcome. Visible active work polls every 1.5 seconds; background work keeps the slower interval. Terminal status is shown immediately while final source synchronization completes independently. |
| A large part of the interface is navigation rather than work | Desktop history was permanently visible despite a collapsed state. The page repeated project selection and generic statuses. A short discussion answer appeared as “Plan saved”; new projects inherited the old discussion mode. | History now opens on demand. Hook, app and connected-project starters fill the composer with the selected network. New projects reset to Build. The overview links saved requirements, source and the next action. Discussion replies say Ready and do not force an empty result view. |
| Project replies are repetitive and mechanical | The recorded hook run repeatedly restated the same fee, recipients, remaining stages and no-launch disclaimer. The project agent's instructions did not carry the concise, inventive conversation style of the earlier coin chat. | Action explanations focus on the current step or a new obstacle. Results describe the actual outcome briefly. Brainstorming offers three different concrete mechanisms or experiences with real integration needs, without saving suggestions as requirements. |
| Contract files and results are difficult to inspect | Copied libraries fill a flat file list. Compilation appeared as “Passed · 0 requirements”; interrupted work provided no direct continuation. | Declared source entry points lead the file view; other files stay accessible and all paths are searchable. Results name compilation, contract behavior and source review. Interrupted work can prepare a continuation in the same project. |
| Native-currency defaults are inconsistent | New platform launch drafts used `{...EMPTY_COIN_SETUP, chainId}`. This changed the network but retained ETH and its amount for HyperEVM and Elysium. | The shared coin-setup transition selects HYPE and clears the inherited ETH amount. Initial browser state also uses the saved contract's network. Existing saved drafts remain preserved. |

## Code freshness and supported projects

A versioned contract source is not automatically obsolete. Contract context comes from the selected chain's verified deployment/profile and source-checked interfaces. Replacing those libraries with an arbitrary newer npm release would break that binding. The freshness problem for ordinary app dependencies is addressed through live package and documentation reads; the chain context remains authoritative for contracts.

The workspace supports contracts on Ethereum, Robinhood, Base, HyperEVM and Elysium. Existing application capabilities include static sites, Node API handlers, Vite, persistent project data, reviewed private connections, game events, repository import/export and scheduled callbacks. Each still needs its own actual checks and provider receipts. The hosting profile does not run a Next.js application server. The builder must select a working supported architecture or explain a real unsupported requirement before implementation.

## Interface direction

- Product: build custom hooks and complete connected projects from an ordinary description.
- Character: practical, direct, calm.
- World: retain Programmable's Night Garden and established warm action color; use quiet working surfaces inside it.
- Moments: the actual source, project requirements, checked behavior and working app preview.
- Signature: a continuous, honest account of saved work and the next useful action.

Craft guidance used: [unslop by Damir Sokolovsky](https://heydamir.design/unslop), CC BY 4.0.

## Verification and release boundary

Focused verification covers source-context preservation, current registry/document reads, private destination rejection, nested failed checks, immutable behavior targets, exact compilation-artifact feedback, native-currency defaults and durable run ownership/recovery. Browser coverage exercises prompt-to-project creation, network starters, fresh Build mode, uncertain-submit recovery, progress, checked previews, unchecked preview blocking and preview opt-out. Existing keyboard, file and launch-review scenarios remain applicable.

The initial live request above is a failed baseline, not release acceptance. A passing local check or CI result does not establish a live product, completed wallet launch or public app behavior. Publication evidence and subsequent live hook/app observations must be recorded separately for the exact deployed commit. This change does not broadcast a customer launch or claim that an untested project works.
