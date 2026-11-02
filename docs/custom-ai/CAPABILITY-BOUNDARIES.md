# Creative hook capability audit

Audited 2 November 2026. The design language is open-ended; the executable environment has explicit boundaries. Never turn a request outside the current environment into a simpler fee rule without the user's agreement.

| Requested mechanic | Implementation path | Evidence still required |
| --- | --- | --- |
| Countdown, ramp, different buy/sell fees | Fixed fee module when its full restrictions fit, otherwise general source | Actual fee boundaries and buy/sell behavior |
| Stateful counters, games, auctions, epoch logic | General source, possibly auxiliary contracts | State transitions, adversarial ordering, actual callback/event checks |
| Token/recipient restrictions | General source under the selected launch policy | Transfer and swap paths, cumulative inflows, time boundaries and exact authority |
| Custom accounting, curves, rebates | General source | Signed deltas, settlement, liabilities, funding, supported router/quote path |
| Liquidity allocation or reinvestment | Funded program or general source plus executor | Collected assets, balanced liquidity action, keeper liveness if autonomous |
| Weather, sports, external news | Design plus a verified feed adapter | Observation authority, freshness, units, replay handling, fallback, running updater |
| Perpetual-related rules, lending/vault integrations | General source plus exact external contract interface | Deployment/runtime identity, external state transitions, funding and failure behavior |
| Cross-chain conditions | General source plus verified messaging | Authentic source/destination, finality, replay rules, executor and funding |
| Arbitrary ERC20 pairs or custom router hook data | General source | Suitable fixture and current production preparation; native/token examples alone do not prove these |

## Findings addressed in this release

- Local knowledge covers callbacks, routing, accounting, external data, creative composition and verification limits without repeated external searches.
- Independent declarations receive the actual pinned protection interfaces before generation instead of guessing constructors and ABIs.
- The source-blind contract graph and public ABI are declared separately with bounded per-stage output budgets. Pinned interfaces use lossless references. An explicit build of the unchanged saved design cannot be replaced by a status reply; it still passes the same intent, policy, compilation and behavior checks.
- Graph planning receives exact constructor facts. Public-interface planning receives the fixed graph and pinned ABI catalog and declares the production values without repeating contract identities. Detailed scenario instructions are kept in the scenario stage. Truncated declarations keep a bounded private diagnostic excerpt; they never become source, reusable complete declarations or public chat output.
- Graph and public-interface responses use typed objects. Scenario pages use compact typed tuples with exact contract/function references instead of one large JSON-encoded plan string. Only individual constructor/return values and the separate deployment object use JSON value text. Numeric world fields stay numeric. The stage objects expand to the same complete validated declaration; the wire format grants no source or launch evidence.
- The local graph has a 6,000-output-token ceiling. Its public methods and compact production declaration share a separate 4,000-token ceiling. Interface coverage can name only actual constraint IDs; behavioral claims still require scenario observations.
- Scenario calls name a contract and function from the actual resolved interface. Declarations check call and return arity before source generation. Source constructors, initialization guards and callback permissions come from the pinned dependency sources.
- A correction returns bounded JSON-pointer replacements addressed by stable step and contract IDs rather than numeric row positions or the whole plan. Model tasks use JSON-object transport with Surplus because large strict provider grammars were rejected. The original schema and complete semantic checks still run locally; invalid output cannot proceed to source generation.
- Fixed-pool Swap event fees are checked separately from hook platform/opening fees. Typed call validation rejects a quoted boolean or an address input passed to a numeric parameter.
- Model tasks have one routing manifest and per-task metrics. No provider fallback or spending-limit change was added.
- Rejected plans retain private, owned, context-bound diagnostics. An explicit correction reuses the plan rather than repeating all preceding inference.
- Long scenario declarations use at most three pages of 4,000 output tokens under the existing combined 12,000-token ceiling. The pages share one fixture and are validated as one complete plan. After an interruption, an explicit request can reuse the completed graph or scenario pages only for the same intent, chain, compiler, interface catalog and production context. A partial plan cannot start source generation or grant launch readiness.
- Validator feedback identifies a row, requirement or deployment mismatch while retaining the same enforcing checks.

## Limits that remain

The GQA live generation failure needs a successful instrumented reproduction and repair before it counts as solved. Passing unit tests is insufficient. General source launch preparation is behind its existing activation flag and depends on backend readiness; this audit does not switch it on. The current trusted local worlds cover native/token v4 pools and their protected variant. Additional external protocols, cross-chain relays, arbitrary router/quote paths and real offchain services require actual integration work and matching evidence. The contract metadata tool remains limited to Ethereum/Robinhood and does not inspect arbitrary verified source. Hosted web research is a separately configured service.

## Maintaining the builder

Add a knowledge topic in `protocol-knowledge.ts`, a validated read capability through `capabilities/registry.server.ts`, and an execution adapter only when its runtime and evidence exist. Regenerate the interface catalog with `node scripts/custom-ai/build-interface-catalog.mjs` after a pinned package update. Its check mode verifies the catalog against the original artifacts. Updating knowledge must not silently update deployed contract policy, signing authority, provider selection or spending limits.

References: [Uniswap v4 hooks](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks), [Uniswap integration and routing](https://developers.uniswap.org/docs/trading/overview).
