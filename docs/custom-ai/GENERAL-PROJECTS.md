# General Custom AI projects

This source package is a foundation for the general Custom Contract route. It is not publicly connected to chat generation, submission or wallet execution yet. The existing fee core and its financial restrictions remain its own route.

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

## Qualification

The local cases cover complete intent, negative constraints, chain isolation, missing template coverage, retained open choices, stable selection after JSON storage reordering, project mutation, unsafe paths and remote dependencies. The real isolated compiler cases check repeatable artifacts, general mutable contracts, an inline dependency, missing entrypoints, inaccessible host imports and unresolved library addresses. They do not use RPCs, model calls, wallet transactions or provider funding.

Public chat wiring and provider qualification of general generation, behavior verification, backend submission and four-chain funded lifecycle acceptance remain unfinished. This foundation does not change public capabilities or deployment configuration.
