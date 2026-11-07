# Signed game events

A game integration consists of a project revision, an issuer, a receiver contract, a signed player-to-wallet agreement, and signed results. The issuer is owned by the game service. The platform does not create a shared signing key for user games.

The optional `ProjectGameEventsV1` receiver and `ProjectGameFeeModuleV1` reference module are exported as a source-verified package by `scripts/custom-ai/export-game-events.mjs`. The source catalog is available through `event.library`. These contracts are inputs to the existing build and launch review; their presence in the catalog does not approve a launch or publish a contract.

## Trust and identity

The game service authenticates its own player accounts. A `WalletLink` message binds its player ID hash to a wallet, a one-use nonce and a short submission deadline. Both the player and the configured game issuer sign that exact message. The receiver rejects changes to an already bound player's wallet. A new receiver/configuration is needed to change that immutable trust relationship.

Each `GameEvent` includes the binding ID, event ID, player ID hash, player wallet, increasing sequence, score, observation time and expiry. The EIP-712 domain includes chain ID and receiver address. The receiver enforces the issuer signature, existing wallet agreement, exact next sequence, score bounds, freshness and one use of each event ID. The current implementation supports EOA signatures; smart-contract wallet signature validation is not part of this version.

The reference fee module uses the verified cumulative community score. It does not treat a swap router as an individual player's identity. It proposes an additional fee through the existing narrow interface; the existing hook retains its fee, custody and settlement rules. Expired game observations produce no extra fee. The receiver and module hold no funds.

For an individual-player bonus, the source catalog also provides
the paired `ProjectPlayerGameEventsV1` and `ProjectPlayerGameFeeModuleV1`.
The individual receiver enforces one game account per wallet as well as one
wallet per game account, so scores from different accounts cannot be pooled
into one bonus. The original community receiver remains available for its
existing multi-account policy. The individual module rejects that older
receiver. It reads the signed cumulative score for the
active initiator reported by one explicitly configured, code-pinned router.
The hook must supply its actual PoolManager callback sender. Unknown routers,
changed runtime code, absent actors and failed or malformed lookups retain the
configured regular fee; they never borrow another player's bonus. The router
lookup has bounded gas and return data. The bonus only lowers the configured
additional fee, so core platform fees and caps remain in force.

This individual reference uses persistent earned eligibility. Stale incoming
results remain invalid, but an already earned bonus does not expire merely
because another round has not arrived. A three-win fixture sets each result's
maximum score to one and the threshold to three. Other economics must be
declared explicitly in the user's project and verified independently. The
community and individual variants are different policies, not interchangeable
implementations of the same requirement.

## Project flow

1. Plan the game policy and include its source in the project. `POST /api/custom-ai/platform/events` with action `plan` returns the project-derived binding ID for the current revision.
2. Build, check and deploy the receiver through the existing authorized contract workflow. Action `bind` verifies actual runtime bytecode and immutable receiver parameters against the reviewed package before saving the binding.
3. Record the player/issuer signatures with `link-wallet`. `prepare-wallet` creates a normal wallet request for the receiver's binding call. It does not broadcast it.
4. The authenticated project owner, a connected game API, or the public signed intake endpoint `/api/custom-ai/platform/events/ingest/{bindingId}` submits the signed result. Intake only records it; no onchain action is sent.
5. Action `prepare` checks current project revision, receiver bytecode, wallet mapping, sequence, event identity and expiry. The existing dual-provider nonce, gas and checkpoint logic creates an exact wallet request.
6. After the user sends the request, `submitted` records its hash. `reconcile` reuses the existing exact-transaction receipt verifier and independently checks receiver consumption. Unknown outcomes remain submitted. A changed project revision does not prevent reconciliation of an already submitted request.

Identical intake retries return the same receipt; changed bodies for a used event ID are rejected. New preparation is disabled after submission. A missing receipt after previous confirmation returns the record to submitted rather than presenting stale confirmation as current proof. Failed or ambiguous transactions are not automatically resent.

Project revocation stops this platform's intake and preparation. It does not revoke an immutable onchain issuer or undo an already accepted result. Never put signing keys in chat, files or public webhook payloads; configure the game service or a private connection.

## Verification boundaries

The focused Solidity suite checks signed score-to-fee behavior, duplicate events, issuer/wallet checks, sequence, expiry and domain separation. TypeScript tests check signed inputs, owner isolation, conflict receipts, HTTP authority, revision changes and uncertain transaction recovery. The RPC reference runs on an explicitly local deterministic chain; this is distinct from a funded public-chain deployment. Public-provider checkpoint verification is read-only. Complete normal-user and multi-project acceptance remains part of the platform release gate.
