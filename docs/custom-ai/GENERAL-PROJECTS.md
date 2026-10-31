# General Custom AI projects

This source package and service handoff are local work for the general Custom Contract route. They have not been published in the product. Private studio/preview, versions, source recovery and independent declared-scenario checks are integrated locally, including the pinned v4 world described below. The private backend session consumers for all four chains and the Website signed-request producer are qualified locally, with intake disabled. Owned-project submission, current-profile packing, exact launch preparation and wallet execution still need their integration. The existing fee core and its financial restrictions remain its own route.

`execution-routing.ts` selects from saved complete intent, a proposed template coverage and the chosen network. Missing template requirements select `custom-contract`; they are never silently removed. Open choices and missing feed or worker capabilities stay with the selection. The selection is hashed with its chain and intent revision and always has `launchReady: false`. A proposed coverage is interpretation data, not semantic verification.

Ethereum uses the existing V3 custom-launch API. Robinhood uses Custom Launch Plans, including its `custom-launch-plans:preflight` endpoint. Base and HyperEVM use their chain-scoped custom-launch API. The chain directory records HYPE for HyperEVM and does not invent a fixed fee-core deployment on Base or HyperEVM. The backend's live discovery, source admission and review remain the authorities for each route.

## Reproducible source package

`createContractProject` binds all inline source files, named entrypoints, the complete saved intent, chain and compiler settings to one canonical hash. The package pins solc `0.8.26+commit.8a97fa7a`, optimizer 1000, no viaIR, disabled CBOR metadata and an explicit Paris or Cancun target. Source names are relative Solidity identities; source URLs, shell commands, compiler options outside this contract and host paths are rejected. Dependencies must be supplied as inline source content.

The package supports 48 files, 384,000 source bytes in total, 96,000 bytes per file and 16 concrete entrypoints. It preserves constructors and ABI types for subsequent exact graph preparation. It does not invent constructor arguments, link external libraries or choose a wallet budget.

`compileContractProject` checks the saved hash before invoking the existing pinned toolchain in a separate Node process. That process receives no parent environment credentials, runs with filesystem permission limited to the compiler and worker, has no import callback, and has bounded time, memory, input and output. It returns bytecode, ABI, immutable references and storage layout for the selected concrete contracts. Unresolved libraries and EVM code-size violations produce no deployable artifacts.

The artifact hash binds compiler output to the project hash. Every result retains `verification: "not-run"` and `launchReady: false`. Compilation does not establish requested fee behavior, intended permissions, swap compatibility, review approval or funding. These require the existing source/economic verification and the subsequent adapter work.

## Source generation

`buildGeneralContract` is an internal step for the existing owned AI job. It makes one explicit generation call and one isolated compiler call. It has no automatic paid repair loop. The caller must durably save the complete hashed project before compilation starts, so a compiler interruption can be resumed from stored source without another inference. A failed source save stops compilation. The helper has no public endpoint yet.

The generator receives the complete intent, exact previous project and supplied inline dependencies as design data. An earlier project must match the design and network. The caller resolves the selected source through the owned studio and its existing job/CAS binding. Source may predate several clarification turns; generation still uses every requirement in the latest complete intent. Dependencies, compiler settings and unresolved material choices are checked before inference. Generated files cannot replace dependency files, and proposed requirement coverage must include every saved ID. Coverage remains `proposed`; only subsequent independent verification can establish behavior.

The model context carries all stable requirement IDs, text, kind and open choices. Provenance and change history remain in the authoritative project without being repeated in the prompt. Every previous source file remains available; an unchanged dependency is included once through the supplied dependency map. Context above 160,000 characters and messages outside the existing 24-message/24,000-character bounds are rejected before inference. This is a context bound, not a measured provider-cost or latency guarantee.

General projects use the same conversation and data-integration voice as the fee builder. The fee core's token supply, fee bounds and restricted interface stay scoped to that core. The selected general route's current source, funding and platform-fee policies must still be supplied and enforced through its existing backend.

## Owned checkpoints

`store.projects` saves the complete source before compilation in the existing owned job/object storage. It binds the source to the request payload hash and admits writes only from that job's current, unexpired running lease. Cancellation, a completed job, a wrong owner or an expired worker cannot write or attach later compiler output. An identical save is idempotent; another source revision requires a new owned request.

The source remains readable by its owner after a compiler failure. Compiler output must match both the exact saved project hash and its canonical artifact hash; it cannot claim behavior verification or launch readiness. Status polling continues to omit these larger checkpoints. The dedicated server-only checkpoint method supports the bounded complete project without increasing the ordinary studio/image object limit. No schema migration, new model call, submission or wallet action is part of this storage step.

## Existing chat job handoff

The local planner selects an explicit execution route. A proposed template missing a canonical requirement selects the general route when durable project storage is connected. An open material choice still blocks generation of a partial design. The general generation call receives every canonical requirement and negative constraint. The existing account-owned job supplies lease-bound source and compilation saves; its completion uses the same durable reply transport and request metrics. The fee compiler is not called for general projects, and compiler failure does not start a paid repair loop.

New general source uses the Cancun compiler target by default, while an existing project keeps its recorded target. A caller may supply an explicit Paris target. This source-compilation choice does not prove chain compatibility or authorize a launch; the selected route must still check its current network and runtime bindings. The isolated compiler case distinguishes code requiring transient storage from a Paris build. The worker tracing rule includes the bounded worker files without needing a separate configuration entry for every new worker.

General follow-up questions use saved requirements and a compact project summary. The browser reply contains hashes, compiler information, bounded diagnostics and entrypoints; it does not repeat the source or bytecode. The complete checkpoint is loaded once when source inspection or a new build needs it. Explicit source inspection has the same 160,000-character planning-context bound. A mismatched project/artifact reference stops before inference.

An existing general project and a network without a fee core use a general-only planner schema. Unavailable fixed-core program/event fields are null, fee checks are empty, and fixed-core deployment/feed instructions are omitted. This keeps route-specific context and schemas smaller without discarding the complete intent or its selected source. A general project cannot silently switch to a fee template during an edit. The local comparison measures serialized schema/context size; it is not a provider billing or latency measurement.

`GET /api/custom-ai/projects` is the explicit complete source read. It requires the authenticated owner, selected linked wallet, chat and saved request to match. It can return source kept after a compiler failure, without another inference or compile. Ordinary chat reload and polling do not use this larger endpoint. The route and its UI are not public yet.

## Compile-only recovery

The existing owned job transport accepts `intent: "compile"` with an exact `compilationOf` request ID and project hash. It accepts no replacement source, compiler command or edit target. The source must match the authenticated owner, selected wallet/chat, saved network and current or immediately preceding design. A still-running parent cannot start another build; a deterministic compiler diagnostic requires a source edit. A completed receipt is reused without running the compiler again.

Recovery skips model connection and health checks. The same job reservation, request hash, compare-and-set chat binding, stop handling and durable result transport remain in force. It uses one compute request unit within the existing account/global allowance and concurrency limits, with no inference or provider tokens. An identical replay does not reserve another unit, reload the larger source or repeat compilation. A further compiler outage remains terminal for that attempt and retains its complete source checkpoint.

The local API cases run with an unconfigured model provider, exercise real job/object transactions and a substituted compiler, and verify zero model calls, one compiler dispatch, unchanged original failed attempt, retained source and exact replay. The isolated real compiler has its separate qualification. The recovery control and source proposal handling in the browser still need their UI integration.

Historical captured planner responses retain their original bytes; the replay fixture explicitly adds the route metadata introduced after its recorded configuration version.

Before publication this new planner schema needs its versioned AI configuration, source references in the public reply/studio, complete source recovery, four-chain settings, independent behavior verification and the existing submission adapter. The current public capability announcement remains unchanged.

## Qualification

The local cases cover complete intent, negative constraints, chain isolation, missing template coverage, retained open choices, stable selection after JSON storage reordering, project mutation, unsafe paths and remote dependencies. The real isolated compiler cases check repeatable artifacts, general mutable contracts, an inline dependency, missing entrypoints, inaccessible host imports and unresolved library addresses. They do not use RPCs, model calls, wallet transactions or provider funding.

Public chat wiring and provider qualification of general generation, behavior verification, backend submission and four-chain funded lifecycle acceptance remain unfinished. This foundation does not change public capabilities or deployment configuration.
### Saved source in the chat

The studio keeps the current working job separately from `sourceId`, a proposed source package from a failed build. Ordinary restoration uses compact project metadata. Complete files and compiler artifacts are available only through an explicit, owner-, wallet- and conversation-bound `/api/custom-ai/projects` read. Source download does not run the compiler or a model.

An explicit compile retry binds `compilationOf.id` and `projectHash` to a new leased job. It uses no model, provider-health dependency, RPC or wallet. Its request can have an empty message list. The UI keeps the transcript, unsent input and pending change while recovering or reloading that job. Source diagnostics require an edit; deterministic compiler failures are not retried automatically.

The shared coin editor accepts Ethereum, Robinhood, Base and HyperEVM. Native pairs are ETH on the first three and HYPE on HyperEVM. Changing native currency clears an amount expressed in the previous currency. Changing networks clears an old custom pair unless the user explicitly supplies the new pair and amount. General routes resolve their own currency/profile during preparation; `setupQuoteAddress` remains a strict fixed-core helper for Ethereum and Robinhood.

This implementation state does not establish a public general-contract launch. Independent behavior checks, existing Custom Launch submission/review and exact preparation remain required. The fixed fee core has not been activated on Base or HyperEVM. Contract metadata RPC reads remain available only on their existing Ethereum/Robinhood connector; the tool registry does not advertise that connector on other networks. Catalog and hook searches use the shared indexed data.

## Declared scenario checks

`check-blueprint.ts` defines interfaces and observable scenarios against the complete canonical design before source exists. Its hash includes the full intent, revision, chain, compiler target and declared role of every entrypoint. The generated source cannot change that blueprint. Binding later creates a separate source-specific plan, so the same expected behavior can reject a different implementation. Durable JSON object key reordering does not change the binding.

The project store can save the complete intent and blueprint under the current owned job lease before source exists. The receipt is immutable, tied to the request payload, and cannot be added after source has already been saved. Source roles, network and compiler target must match it. Scenario reports require that original receipt and the exact saved compiled artifacts; repeating the same report is idempotent. Cancellation and expired leases reject late writes. These operations use the existing object and job tables.

The owned chat route now supplies the blueprint and report callbacks. The interpreter declares examples in its first response; the job saves them before the generator runs. Ordinary builds still use two model calls. If an explicit source inspection exposed old implementation code to the interpreter, one separate source-blind declaration is required before generation. Missing or invalid examples preserve a blocked complete design and do not spend generation work.

Compiled projects run the actual isolated checks and save their exact reports. Compact owner projections carry only the report summary. Failed declared cases stay a separate source proposal and preserve the working draft. A worker outage keeps source, artifacts and the original blueprint. Explicit recovery copies those bindings into a new owned job, reuses existing compilation, and runs only the unfinished checks. It uses no inference, provider-health dependency, RPC or wallet action. A deterministic failed example requires a source edit.

Passing primitive scenarios remains separate from trusted v4/world fixtures, submission, review and launch preparation. This integration is local and unpublished. It does not activate general public launches or change the existing fixed fee route.

`behavior-checks.ts` binds a bounded, declared oracle to the exact project and intent revision. It covers every saved requirement ID, requires observable expectations for behavior requirements, and keeps explicit contract interfaces, constructor arguments, allowed call targets and ordered cases. Contract references follow deployment order. Fixture accounts are local test identities. A literal allowed call address must occur in the saved design; the model cannot add an unrelated payment target to make a check pass.

`checkGeneralScenarios` verifies the exact source/artifact/plan binding and uses the existing pinned EthereumJS toolchain in a separate worker. Only the compiler/toolchain and worker files are readable, the parent environment is not inherited, and the runner exposes no RPC, model call, shell command or user-selected URL. The declared Solidity bytecode runs in memory. Execution has per-call and total gas bounds, a 30-second worker limit and a 384-MB heap limit.

The worker checks the complete declared public interface, constructors, callers, success/revert expectations and exact ABI return values. Calls outside declared targets, delegated execution and unbound child deployments fail the supported fixture. The actual-source mutation cases include wrong fees, an extra admin function, an admin-only condition hidden inside an otherwise matching interface, and a payment sent to a hidden recipient while its getter reports the expected recipient.

The report is scoped to `isolated-declared-scenarios-v1`. It always keeps `launchReady: false`. Declared scenario coverage is not proof of every branch, live pool behavior, a fresh external feed, chain compatibility, review approval or a funded launch. The local owned-job integration is described above. Trusted v4/graph fixtures and the existing backend admission/preparation remain integration work.

## Trusted v4 fixture foundation

`GeneralV4Fixture.sol` is an adapter only for local execution. It uses the actual pinned PoolManager from the existing core bundle, settles native/token currency deltas, refunds unused native funds and rejects callbacks from any other caller or manager runtime. It supports bounded CREATE2 deployment so a general hook can use a real permission-matched address. Its bytecode is compiled from the saved source closure, without fetching packages or executing candidate code on the host. `build-general-v4-fixture.mjs --check` reproduces the exact fixture without writing it.

The actual EVM qualification provides liquidity, buys, sells and transfers tokens. A separate timed hook is deployed at its correct permission address. The PoolManager's actual Swap event records 3000 ppm at second 599 and 500 ppm at second 600. Direct calls to the hook callback are rejected. These are synthetic fixture rates, assets and accounts, not any user's live token or current chain profile.

The local scenario declaration now supports the closed `v4-native-token-v1` world. It binds the token and hook roles, hook permission bits, pool fee, tick spacing and initialization price before generation. Constructors can refer only to the fixed local manager/router fixtures, and `{pool:true}` resolves the declared native/token PoolKey. The exact supported router methods initialize, provide liquidity and swap; arbitrary fixture methods, live addresses and URLs are not accepted. Passing primitive fixed-core fee limits is not a policy for these general projects.

The isolated worker deploys the actual pinned manager and trusted adapter, deploys the complete generated token/hook source graph, mines a bounded CREATE2 salt for the declared hook permissions, and runs the original ordered examples. Nested deployment is allowed only for the exact declared hook creation bytes from that adapter. The original call-target and delegation guards remain. An expected swap fee is read from the actual manager's Swap event. It is not inferred from a hook getter or its claimed requirement IDs. Only the additional fixed helper and fixture files are readable in this worker; the parent environment and network remain unavailable.

The actual generated-source qualification checks a hook whose initialization starts the ten-minute timer. Both buys and sells settle against real pool state. A 2700-ppm implementation fails the independently declared 3000-ppm expectation; the correct source passes its 3000/500 boundary, transfer and unauthorized-callback cases. The complete local plan binds these expectations to source/artifact hashes and still returns `launchReady:false`. This path is unpublished and does not establish a live chain, provider listing or public launch. External feed worlds, nonstandard settlement/quote fixtures and the existing backend submission/preparation remain distinct work.


## Current request session producer

`authorizeCustomAI` keeps an immutable request-local receipt after the existing
access-token and current linked-wallet check. A saved AI-job owner ID, copied
receipt, another Request, expired receipt or stopped request cannot authorize
`backend-launch.server.ts`. Reusing that receipt within the same request avoids
a second Privy user lookup. New requests check current ownership again; no user
permission cache or persistent key is introduced.

The producer derives fixed private mutation targets from the existing four-chain
route registry. Assertion version 3 has a separate domain and binds the exact
body, selected wallet, chain path, operation, idempotency key and Robinhood
response negotiation. V2 assertion consumers retain their original framing.
Bodies retain the canonical 8 MiB graph and 16 MiB Plan limits. The bridge uses
one explicit POST, a request-bound deadline, no redirects or automatic retries,
and bounded private JSON replies. An HTTP reply is untrusted transport data until
the preparation workflow checks its source/identity and canonical launch state.
It does not establish approval, a wallet permit, execution or public availability.

This producer is server-only and not connected to a public general-project
submission action yet. The owned exact revision, deployment recipe, actual chain
profile and metadata pack must be integrated before it is enabled and released.
