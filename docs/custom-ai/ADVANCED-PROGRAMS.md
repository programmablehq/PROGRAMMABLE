# Custom AI advanced programs

This extension keeps the deployed Custom AI core unchanged. New program and event launches are disabled by default. A successful local simulation is not evidence of a public deployment, a running data relay or a funded payment.

## Funded programs

`CustomAIProgramV1` is a fixed template, not model-generated custody code. Its constructor binds the factory, creator, launch salt, quote, mode, recipient, interval and buyback limits. `factory.launchOf(creator, salt)` resolves the exact launched coin and reward vault. No owner can change the configuration or withdraw principal.

The launch assigns an explicit percentage of additional fees to the program. The 0.5% platform share is excluded. The remaining additional fees belong to the creator. The wallet journal deploys and checks the program before creating the fee module and launching the coin. Template hash, settings and pair are committed in the source reviewed by the user; changing the chain or pair requires a fresh review.

Modes:

- Distribution delivers collected quote tokens to a fixed recipient.
- Staking accepts the launched coin, tracks each stake, and distributes collected quote tokens proportionally. Withdrawals use recorded accounting and the bound staking token without calling the quote provider, factory, reward vault or router. Rewards collected while nobody is staked become available to later stakers. Rounding dust remains reserved. No fixed return is promised.
- Buyback spends at most a fixed quote-token batch, accepts no less than a fixed number of new-coin tokens per quote token, and delivers those tokens to a fixed recipient. It uses the deployed core router and resets the allowance after execution. Failed price limits revert the complete action. Tokens are transferred, not burned.

Reward allocation is allowed once per fixed UTC interval window. Distribution and buyback execution additionally enforce a full interval between successful executions. Anyone may execute; this does not guarantee a keeper will run at any particular time. The token page provides the corresponding wallet actions and retains existing transaction recovery.

`CUSTOM_AI_PROGRAMS_ENABLED=true` permits public launch. Existing explicit canary wallets can prepare the path before activation. Before enabling it, capture source-bound deployment/runtime checks and a funded canary for the intended mode, including fee collection, recipient balance changes, staking withdrawal or buyback output, recovery and index readback. No canary has been sent by this change.

Rebuild the template with the `custom-ai` Foundry profile, then run `scripts/custom-ai/export-program.mjs` with the pinned compiler directory. The exporter verifies every source hash against the build artifact. It must reproduce `program-code.json` and `program-manifest.json`.

## Signed event feeds

The event template supports one integer threshold with separate below/at-or-above buy and sell rates. A stale, missing or changed feed removes all additional fees. The platform fee remains. The template has no custody or writes and cannot block selling through a failed observation. Time schedules combined with an event threshold are not supported in this version.

`CUSTOM_AI_EVENT_FEEDS` is a JSON array controlled by the operator. Each entry contains `id`, `chainId`, `address`, `runtimeHash`, `title`, `sourceUrl` and `unit`. The address must contain the exact `CustomAIDataFeedV1` runtime shape, with its immutable runtime hash pinned. Bounds and maximum age are read through agreeing RPCs. The catalog sent to the model contains no provider credentials. A web result cannot add a feed to this list.

Fee expectations independently cover threshold-1, threshold and threshold+1 in both directions, plus stale observations. The worker installs the actual feed runtime with synthetic observations and checks exact fees, both swap modes, both chain configurations and the full core lifecycle. The simulation uses the fixed feed's documented storage layout; it does not modify any network state.

`prepareFeedUpdate` fetches only the exact operator-bound HTTPS URL without redirects, limits response size, normalizes a configured value path and observation timestamp, and rejects stale, future, out-of-range or imprecise values. Optional explicit outcome mappings represent structured event states such as won/lost; unspecified states produce no update. EIP-712 signatures bind chain, contract, feed ID, sequence, value and validity. A valid signature identifies the reporter and does not prove the offchain event true.

`scripts/custom-ai/update-feed.mjs config.json journal.json` prepares a signed observation without sending it. Configuration includes the rule/feed selection, chain, RPC URL and adapter (`url`, `valuePath`, `timestampPath`, `decimals`, optional `values`). Use separate `CUSTOM_AI_DATA_SIGNER_KEY` and `CUSTOM_AI_RELAYER_KEY` environment bindings. Normal website RPC configuration is also required for independent checks. Keys must remain outside Git.

`--send` additionally requires an explicit `maximumGasCostWei`. It records the exact signed transaction before broadcasting. `--resume` only resumes that saved transaction; uncertain broadcasts must not be replaced with a fresh attempt. Successful relay output records the transaction and receipt. Scheduling, operator funding, source availability and monitoring are deployment responsibilities; this change does not start a relay.

`CUSTOM_AI_EVENTS_ENABLED=true` permits public event launches after an operator has connected and tested the intended feed. Capture fresh/stale behavior, observation provenance, signer/runtime binding, relay recovery and actual onchain fee changes before enabling it. No weather, sports or news provider is silently assumed to be active.
