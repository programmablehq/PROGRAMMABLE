# General Custom AI projects

This source package and service handoff are local work for the general Custom Contract route. They have not been published in the product. Private studio/preview, versions, source recovery and independent declared-scenario checks are integrated locally, including the pinned v4 world described below. The private backend session consumers for all four chains and the Website signed-request producer are qualified locally, with intake disabled. Canonical graph packing and durable graph preparation are integrated locally. Modern Robinhood Plan packing is also qualified locally with the existing independent backend parser/compiler. Its journal integration, protected component evidence, UI submission, backend activation and wallet execution remain unfinished. The existing fee core and its financial restrictions remain its own route.

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

## Exact owned source selection

`store.projects.readForLaunch` reads the selected working source, current chat
intent, original blueprint, compiled artifacts and scenario report in one owned
transaction. It uses the existing conversation/studio lock order and at most two
owner-indexed jobs. Archived chats, an unfinished reply, pending edits, changed
intent, another wallet/network and missing or modified evidence stop preparation.
The last failed source proposal cannot replace the saved working source.

The returned semantic binding covers the owner, linked wallet, chat, source and
context jobs, full intent revision, settings, image and every evidence hash.
After asynchronous packing, callers can revalidate that binding while allowing
only unsent-input changes to the studio revision. No source is written, compiled
or sent to a provider by this read. The result retains `launchReady:false`;
current-profile packing and backend preparation remain required. This local
loader is not a public submission endpoint.

## Production configuration before generation

The owned chat route supplies `readLaunchProductionContext` before independent
planning. It projects the selected chain's public discovery into typed source
context. Ethereum uses the canonical CLI profile resolver and current closed
trade-fee policy. Base and HyperEVM require their exact embedded profiles and
include the opening fee, buyer/recipient protection and exemption bounds from
their chain policy. Robinhood uses the Plan manifest and atomic executor binding;
the older graph capability endpoint cannot replace it. Foreign URLs, prose,
historical releases and RPC configuration are omitted from the model context.

The complete context hash is saved in both the original independent blueprint
and generated project. Their binding rejects a different network/profile and
detects later modification. The source generator receives the complete policy
once; the nested blueprint carries its ID. User requirements remain unchanged.
A policy conflict requires a concrete clarification. Configuration discovery is
not admission, dependency runtime verification or funded launch evidence.

Discovery uses the selected chain GET plus one shared `/v1/launch-protection`
observation. A five-minute per-process cache and shared in-flight work cover the
four fixed chain keys and single policy key. Calls have a five-second deadline;
strict JSON is bounded to 1 MiB for capabilities and 16 KiB for global policy.
This loader has no direct RPCs, authentication keys, redirects or automatic
retries. Failures are cached for ten
seconds and expired successes are not returned as current configuration. One
stopped chat detaches without cancelling another chat's shared observation.
The explicit preparation action can force a current observation while
still sharing an in-flight request and respecting the short failure cache.

New discovery returns production context V2. It binds the actual global review
mode, protected component roles, custody recipient and authenticated evidence
authority. Ordinary Ethereum/Robinhood Custom Contracts follow that current
mode; Base/HyperEVM still require protected evidence when the global default is
candidate. Module Mode's separate exemption is preserved. Exact historical owner
exceptions are not general permissions and are not supplied to the generator.
The observed current global policy requires protection on all four chains.

Saved V1 contexts retain their original domain, bytes and hash for reading and
rebuilding. They are not silently upgraded or treated as current preparation.
An actual launch preparation must compare the saved context against a fresh
observation. The V2 local qualification retrieves all four chain configurations
with five public GETs, including exactly one shared policy read; it does not
establish source review approval, wallet execution or publication.

Ordinary unchanged-network builds retain two model calls. If a setup patch
changes the network in that turn, the new network gets a separate source-blind
declaration before generation. A discovery outage still permits explanations;
source generation pauses with the complete saved intent. Brief greetings skip
discovery. The local exact packers below consume the saved deployment declaration. Public
intake activation, UI integration and launch execution remain unpublished.

## Explicit deployment declaration

An independent blueprint may now include a production `deployment` alongside
its isolated scenarios. It declares every source target, constructor argument,
initializer, primary pool and hook permission mask before generation. Its hash
binds the selected production context and complete graph. Source generation
copies that original declaration into the project; generated code cannot replace
it. Missing declarations remain missing and cannot be inferred from passing tests.

This first declaration supports one primary token/hook pool, its actual source
liquidity initializer and auxiliary components within the existing 16-target
bound. Constructor references follow deployment order; initializer references
may point forward. Native funding can be consumed once. Return-delta hook bits
require their base callbacks. A declared local v4 world must identify the same
token/hook source, pool fee, tick spacing and permission mask as the deployment.

Closed input references name the controller, coin name/symbol, quote and funding.
Closed binding references select actual published platform roots. Local fixture
routers, funded test identities, arbitrary commands and unrequested recipient
addresses are rejected. Robinhood cannot borrow graph-factory/funding-token roots
absent from its Plan context. Literal addresses require saved design provenance;
that provenance does not establish current runtime or external-service behavior.

`resolveGeneralDeploymentValues` validates the saved source and artifact binding,
current settings/network, actual constructor/initializer ABI, reference types and
payability. It retains symbolic target refs for the canonical packer. Native
amounts reject precision below one wei before conversion. An ERC20 quote amount
is never treated as native launch funding; that path needs an explicit native
funding value. The resolver has no network, model, wallet or signing access and
keeps `launchReady:false`.

New launch declarations also bind explicit applicant-selected buy/sell rates
and the intended liquidity model. The source and profile retain their own fee
rules; variable behavior is not reclassified as a constant fee. Older saved
declarations keep their original hash without invented zero rates. Preparation
must obtain a complete declaration before packing. Inventory accounting requires
the corresponding swap-return-delta permission.

The declaration and value resolver feed the local graph and Plan packers below.
Production review submission and wallet authorization remain unfinished. No new
public launch capability is claimed.

## Isolated constructor runtime materialization

`materializeGeneralRuntime` accepts exact saved artifacts, owned selected values
and canonical CREATE2 predictions. It reconstructs each creation byte sequence
from the actual ABI, verifies the salt/address and hook permission bits, and
snapshots all input before waiting for its worker. A mutated caller object cannot
change the later worker payload or receipt. The result binds source/artifacts,
production/deployment context, settings, initialization, controller, deployer and
every exact constructor input.

The worker executes the actual constructors in an in-memory EVM at those exact
addresses on the selected chain. It reads each compiler-declared immutable range
from the resulting runtime and requires all other bytes to match the compiled
template. The canonical packer's `bytes32` immutable words contain these actual
observed bytes; no model-supplied word map is used. Two synthetic contexts must
produce the same runtime, but this comparison alone is not treated as proof of
independence from arbitrary future state.

Reads of unbound block/time/randomness/gas context, transaction origin, ambient
balances and unknown dependency state remain unresolved. Delegation and unbound
child construction are also outside this fixture. Known source targets and
standard deterministic precompiles can be called; missing chain code is never
invented as a successful observation. Failure retains bounded component/code
findings for a later focused edit. No raw constructor revert data is returned.

The worker has no parent credentials, RPC or inference access. Filesystem reads
are limited to its fixed script and the existing pinned toolchain. Execution is
bounded by 16 targets, 200 million total synthetic gas, 35 seconds, a 384-MB heap
and bounded input/output. The report is scoped to
`isolated-constructor-runtime-v1`, always keeps `launchReady:false`, and does not
establish live dependency state, pool behavior, backend admission or launch
execution. The durable graph preparation below persists this receipt. Modern
Plan journal integration and complete production execution remain separate work.

## Canonical packer runtime handoff

The existing SDK's V3 `buildLaunch`/`packLaunch` can receive a trusted local
`runtimeMaterializer`. Its internal prediction snapshot is separate from the
final request. The callback cannot change source, constructors, target identities
or permission addresses through that snapshot. It must return exactly one
compiler-slot map and observed runtime hash for every target.

The SDK reuses the compiler's original zero-filled immutable ranges and checks
the supplied words with its existing normalizer. It retains each already mined
applicant salt, rebuilds the graph once without a second grind, checks every exact
prediction is unchanged and requires the resulting code hashes to match the
observed constructor code. All original final profile, source, funding and
verification-bundle checks still run. A callback failure produces no request
file and does not fall back to placeholder words.

The optional materialization receipt contains the exact words and salts needed
to persist a reproducible config outside the source bundle. The normal
`validateLaunchFile` path can then reproduce the same request without invoking
the callback or running constructors again. Existing builds without a callback
retain their original behavior. This hook is a local integration point; it is
not a public HTTP authority or a new API key. The local owned graph writer and
modern Plan packer below reuse these exact source and constructor bindings.
Complete production submission remains pending.

## Durable graph preparation and submission journal

The new `/api/custom-ai/general-launch` route is disabled unless the release
explicitly sets `CUSTOM_AI_GENERAL_LAUNCH_ENABLED=true`. The backend's separate
wallet-session intake also stays disabled. Neither flag is activated by these
source changes. The general preview does not yet expose this action. Robinhood
uses the local modern Plan packer below; its journal integration remains pending
and never falls back to a graph route.

An authenticated `prepare` action selects one owned chat, studio revision,
complete intent and exact checked source. The browser cannot supply internal
binding receipts, bytecode, nonces, request bytes or a replacement chain. The
store reserves its immutable preparation identity, permit window and idempotency
key before expensive work. Repeated clicks, including a new browser request ID
for the same active input, recover the original ticket. An expired local compute
lease can be recovered explicitly without a new identity or model call.

Two fixed shared lease rows bound concurrent local packs. Account and global
hourly request budgets are debited in the same short transaction. Busy leases
and hourly limits have distinct bounded errors. A worker cannot release a slot
that a later worker acquired. These CPU/admission guards do not change provider
budgets, require an API key or authorize spending. No compiler, model, network
call or signing operation runs while a database transaction is held.

The packer reads only the original owned image receipt at its fixed immutable
public blob URL. It verifies the owner-derived image ID and exact content hash;
the existing bounded reader handles the single five-second read without retries
or credentials. On successful packing the store checks the complete current
semantic source binding again. It atomically publishes the sanitized source
export and stores the final request bytes, reproducible configuration, runtime
words and their hashes in separate private objects. An edited or archived chat
cannot publish a stale package. Unsent input alone can change without replacing
the checked coin design.

Explicit `preflight` and `create` actions each make at most one signed backend
POST. Before a send, fresh selected-chain discovery, current request authority,
linked wallet, owned source and exact stored package must match. A preflight
response must identify that exact request and retain the canonical no-persistence,
no-nonce-allocation and no-broadcast facts. A hard block cannot become a supported
disposition. `needs_evidence` can proceed to the normal review intake; it is not
deployability or approval. Create responses must match the request, original
profile/intent hashes, wallet and canonical resource location.

An interrupted send, process death or mismatched successful response keeps the
original ticket, body and idempotency key. It blocks allocation of another
unconfirmed create for that wallet. Only a fresh explicit retry may resend the
same stored bytes, using a new request assertion. It cannot extend the old window
or silently change the source. The original request remains available after
expiry. A completed exchange is not repeated by polling or another click.

GET reads only the small owned journal. It never loads the complete source or
request, observes a provider, refreshes discovery or submits anything. A stored
backend status is the last accepted response, not a fresh lifecycle observation.
The UI and canonical status/handoff integration remain separate work. Every
projection keeps `launchReady:false`; HTTP success alone establishes no review,
funding, transaction, finality, indexing or public availability. No new database
role, grant, schema migration or production write was performed for this step.

## Modern Robinhood Plan packing

`packGeneralRobinhoodPlan` builds the current `programmable.custom-launch-plan.v1`
transport from the same owned source, independent declaration, exact compiler
artifacts, metadata and immutable preparation identity. It keeps the current
manifest digest, `atomic_execute_and_stamp_v2`, all declared source components,
constructor inputs, initializer calls, pool and permissions. It produces exact
canonical JSON without the V3 graph serialization's trailing newline. Its Plan
hash and raw-body hash remain separate.

The Atomic executor calls a separate deterministic deployment proxy. The packer
pins the same proxy address/runtime as the reviewed Atomic deployment tool and
declares that intended dependency in the Plan. It does not claim a fresh live
code observation. Constructor materialization requires this explicit dependency
on the Plan path; substituting the executor address or an arbitrary deployer
fails before execution. Graph callers retain their original published factory
binding and cannot supply a Plan override. The existing backend remains
responsible for current chain/runtime and complete transaction checks.

The local address search is bounded to 262,144 hook salts and 75 seconds, with
cancellation checks. Actual creation execution supplies each exact runtime word
and hash, as well as the maximum constructor execution gas across the two
isolated contexts. The Plan uses those measurements with a planning margin,
calldata/creation allowance and an outer reserve inside the existing 16-million
gas ceiling. Remaining gas is allocated to every declared initializer. These are
bounded planning limits, not a live gas estimate, gas-price authorization or
proof that the source initializes a usable pool. A sixteen-component qualification
retains all seventeen deployment/initialization actions without multiplying a
fixed three-million allowance for every component.

The inline verification bundle contains exact Standard JSON and independently
materialized artifacts. It copies no private chat, intent text or transcript.
Public Plan presentation follows the actual existing API contract: name, ticker,
image and at least one public project/social link. An X profile and public
description are optional on this route. Graph profiles retain their own metadata
requirements. No project URL or affiliation is invented.

The caller must explicitly declare its controller kind. This local packer
currently accepts an EOA declaration; contract wallets need their own current
authority snapshot and integration. The backend must independently verify the
controller at admission. A local address is not proof of an EOA.

The original backend parser accepts the exact local three-component request
without findings, and its separate bounded compiler reproduces all three actual
creation/runtime bindings. Eight Plan cases and six graph regression cases pass;
one additional case qualifies optional Plan presentation. This does not prove
protected component review, nested-child/dependency behavior, liquidity, fees,
funding, issuer acceptance, a wallet action or availability. The modern Plan pack
still needs the owned submission-journal/response integration and Chat controls.
Every local receipt retains `launchReady:false`.
