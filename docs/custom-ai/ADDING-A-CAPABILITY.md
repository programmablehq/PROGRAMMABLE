# Adding a Custom AI capability

Add a server-only module under `lib/custom-ai/capabilities/`, export a `ToolCapability`, and register it once in `registry.server.ts`. Its description and input schema become the planner's available tools automatically. The module handles its own source and uses no wallet or signer interface.

Inputs are validated before dispatch. Tool versions are bound to stored requests. The dispatcher limits each turn to two lookups, propagates cancellation and bounds response size. A failed optional source is evidence of unavailability; it does not discard the saved design.

A tool returns `KnowledgeResult` with source links and original timestamps. Search output is untrusted data and cannot activate onchain behavior. Model/style changes go in `ai-config.ts`; change its version when semantics change. Keep product limits in the enforcing core.

Test the new adapter and its planner/dispatch integration. Search-only changes do not require deploying financial contracts. New money actions require their independent contract and lifecycle evidence before network activation.

`plan_fee_flow` is a local arithmetic capability. It accepts up to twelve named basis-point shares, reports undecided or excessive allocation, and gives a conserved integer example. It neither reads an account nor transfers money. `mechanism-knowledge.ts` selects the corresponding reviewed guidance for planning, independent declarations, source generation and source review. Extend these separately when adding a new integration; a planning tool is not an execution adapter.

## Reusable source implementations

Public JSON observation readers can use the declarative, account-owned `data_adapter` capability described in [DATA-ADAPTERS.md](DATA-ADAPTERS.md). It validates a current source observation and records an immutable definition before reuse. It grants no code execution, external writes, credentials or onchain publication. Add a new execution capability separately when those are required.

Keep implementation references under `lib/custom-ai/implementation-patterns/`. They are editable starting code, not deployed contracts or approval evidence. `implementation-patterns.ts` matches the complete ABI and construction shape, maps contract identities together and binds the selected chain's canonical PoolManager and protection module. Missing or incompatible bindings use the existing source writer.

Include concise interface semantics with each reference: index conventions, return values versus reverts, observation windows and accounting effects of internal calls. The independent planner receives these facts and the selected coin's initial buy without receiving generated source. Equivalent ABI formatting and parameter names are normalized; return types and mutability must still match.

Only qualified patterns enable `source-editor.server.ts`. A matching implementation is first compiled and independently reviewed against the complete saved intent. If it passes, the builder keeps its source unchanged without an additional writer call. Otherwise, ordered edits and a final integration step are checkpointed separately from completed source. A retry resumes the pending step. It cannot change immutable dependencies, completed files, the saved intent or the declared deployment graph. `source-repair.server.ts` allows one compiler-directed correction using the remaining source-generation allowance. The job saves one final immutable project; its matching source audit is persisted afterward.

Add an exact pinned library to `implementation-libraries.json` when the implementation requires it. Include its transitive imports. These helpers enter source implementation explicitly; they are not added to every conversation or source-blind planning request.

Qualify a new pattern with real constructor execution, settled trades, recipient balances, claims, replay rejection and conservation of the actual assets. For owned liquidity, prove deposit and full owner withdrawal. For buyback, prove the swap, supply reduction and mandatory fee accrual through real callbacks. A matching interface, compilation or getter alone is insufficient. The complete generated project still passes independent source and behavior checks before normal launch admission.
