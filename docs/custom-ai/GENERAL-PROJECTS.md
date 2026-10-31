# General Custom AI projects

This source package and service handoff are local work for the general Custom Contract route. They have not been published in the product. The studio/preview, existing backend submission and wallet execution still need their integration. The existing fee core and its financial restrictions remain its own route.

`execution-routing.ts` selects from saved complete intent, a proposed template coverage and the chosen network. Missing template requirements select `custom-contract`; they are never silently removed. Open choices and missing feed or worker capabilities stay with the selection. The selection is hashed with its chain and intent revision and always has `launchReady: false`. A proposed coverage is interpretation data, not semantic verification.

Ethereum uses the existing V3 custom-launch API. Robinhood uses Custom Launch Plans, including its `custom-launch-plans:preflight` endpoint. Base and HyperEVM use their chain-scoped custom-launch API. The chain directory records HYPE for HyperEVM and does not invent a fixed fee-core deployment on Base or HyperEVM. The backend's live discovery, source admission and review remain the authorities for each route.

## Reproducible source package

`createContractProject` binds all inline source files, named entrypoints, the complete saved intent, chain and compiler settings to one canonical hash. The package pins solc `0.8.26+commit.8a97fa7a`, optimizer 1000, no viaIR, disabled CBOR metadata and an explicit Paris or Cancun target. Source names are relative Solidity identities; source URLs, shell commands, compiler options outside this contract and host paths are rejected. Dependencies must be supplied as inline source content.

The package supports 48 files, 384,000 source bytes in total, 96,000 bytes per file and 16 concrete entrypoints. It preserves constructors and ABI types for subsequent exact graph preparation. It does not invent constructor arguments, link external libraries or choose a wallet budget.

`compileContractProject` checks the saved hash before invoking the existing pinned toolchain in a separate Node process. That process receives no parent environment credentials, runs with filesystem permission limited to the compiler and worker, has no import callback, and has bounded time, memory, input and output. It returns bytecode, ABI, immutable references and storage layout for the selected concrete contracts. Unresolved libraries and EVM code-size violations produce no deployable artifacts.

The artifact hash binds compiler output to the project hash. Every result retains `verification: "not-run"` and `launchReady: false`. Compilation does not establish requested fee behavior, intended permissions, swap compatibility, review approval or funding. These require the existing source/economic verification and the subsequent adapter work.

## Source generation

`buildGeneralContract` is an internal step for the existing owned AI job. It makes one explicit generation call and one isolated compiler call. It has no automatic paid repair loop. The caller must durably save the complete hashed project before compilation starts, so a compiler interruption can be resumed from stored source without another inference. A failed source save stops compilation. The helper has no public endpoint yet.

The generator receives the complete intent, exact previous project and supplied inline dependencies as design data. An earlier project must match the design, network and current or parent intent revision. Dependencies, compiler settings and unresolved material choices are checked before inference. Generated files cannot replace dependency files, and proposed requirement coverage must include every saved ID. Coverage remains `proposed`; only subsequent independent verification can establish behavior.

The model context carries all stable requirement IDs, text, kind and open choices. Provenance and change history remain in the authoritative project without being repeated in the prompt. Every previous source file remains available; an unchanged dependency is included once through the supplied dependency map. Context above 160,000 characters and messages outside the existing 24-message/24,000-character bounds are rejected before inference. This is a context bound, not a measured provider-cost or latency guarantee.

General projects use the same conversation and data-integration voice as the fee builder. The fee core's token supply, fee bounds and restricted interface stay scoped to that core. The selected general route's current source, funding and platform-fee policies must still be supplied and enforced through its existing backend.

## Owned checkpoints

`store.projects` saves the complete source before compilation in the existing owned job/object storage. It binds the source to the request payload hash and admits writes only from that job's current, unexpired running lease. Cancellation, a completed job, a wrong owner or an expired worker cannot write or attach later compiler output. An identical save is idempotent; another source revision requires a new owned request.

The source remains readable by its owner after a compiler failure. Compiler output must match both the exact saved project hash and its canonical artifact hash; it cannot claim behavior verification or launch readiness. Status polling continues to omit these larger checkpoints. The dedicated server-only checkpoint method supports the bounded complete project without increasing the ordinary studio/image object limit. No schema migration, new model call, submission or wallet action is part of this storage step.

## Existing chat job handoff

The local planner selects an explicit execution route. A proposed template missing a canonical requirement selects the general route when durable project storage is connected. An open material choice still blocks generation of a partial design. The general generation call receives every canonical requirement and negative constraint. The existing account-owned job supplies lease-bound source and compilation saves; its completion uses the same durable reply transport and request metrics. The fee compiler is not called for general projects, and compiler failure does not start a paid repair loop.

New general source uses the Cancun compiler target by default, while an existing project keeps its recorded target. A caller may supply an explicit Paris target. This source-compilation choice does not prove chain compatibility or authorize a launch; the selected route must still check its current network and runtime bindings. The isolated compiler case distinguishes code requiring transient storage from a Paris build. The worker tracing rule includes the bounded worker files without needing a separate configuration entry for every new worker.

General follow-up questions use saved requirements and a compact project summary. Explicit source inspection includes the source, with the same 160,000-character planning-context bound. The complete source stays in owned storage. Historical captured planner responses retain their original bytes; the replay fixture explicitly adds the route metadata introduced after its recorded configuration version.

Before publication this new planner schema needs its versioned AI configuration, source references in the public reply/studio, complete source recovery, four-chain settings, independent behavior verification and the existing submission adapter. The current public capability announcement remains unchanged.

## Qualification

The local cases cover complete intent, negative constraints, chain isolation, missing template coverage, retained open choices, stable selection after JSON storage reordering, project mutation, unsafe paths and remote dependencies. The real isolated compiler cases check repeatable artifacts, general mutable contracts, an inline dependency, missing entrypoints, inaccessible host imports and unresolved library addresses. They do not use RPCs, model calls, wallet transactions or provider funding.

Public chat wiring and provider qualification of general generation, behavior verification, backend submission and four-chain funded lifecycle acceptance remain unfinished. This foundation does not change public capabilities or deployment configuration.
