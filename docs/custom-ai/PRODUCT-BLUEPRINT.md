# Product blueprints

`product/blueprint.ts` adds a canonical product plan alongside `LaunchIntent`. It describes components, symbolic assets, funding flows, external-service requirements and interface actions. Every actionable item references stable requirement IDs. Parsing rejects unknown references, duplicate identities and malformed allocations. The plan never grants network, credential, financial or deployment authority.

The ordinary planner produces the structure in its existing response. A malformed structure receives at most one bounded `product-repair` call within the same owned job. The repair cannot change an existing flow's share. If it fails, the completed job retains the full canonical intent and an incomplete-product diagnostic. Normal build retries can repair it without making the user restate their design. Open economic choices remain open.

The canonical hash includes the complete intent revision and chain. Question and brainstorming replies preserve it. Studio and version restore accept only matching plans from owned server jobs. Browser caches are checked for display only and cannot submit a replacement authority.

When present, `productBlueprintId` is included in the contract project, independent check blueprint and check-progress context. A changed architecture cannot reuse an earlier project's check binding or partial source work. Legacy projects without this field retain their original hashes and remain readable. Metadata-only voice updates do not change the saved request payload hash or cause it to be dispatched again.

`product/economics.ts` derives funding paths and budgets from the declared graph. A disconnected cycle is not a funding source. Missing funding means the plan has not specified it, not that a live balance has been measured. `project_allocation` uses exact integer arithmetic, preserves unassigned shares and accounts for every rounding atom. It performs no RPC, model request, contract execution or balance lookup. Its output is labelled `allocation-arithmetic`, with `contractExecution: not-run`.

`product/design-knowledge.ts` supplies versioned design guidance for execution, incentives, liquidity, external data, treasury and governance. These families are prompts for exploration, not a restriction to templates or a claim that their services are deployed. The same mechanism context reaches planning, independent contract declarations and source generation.

This release does not automatically deploy new API adapters, automation workers, indexers or interfaces. It does not establish arbitrary ERC20 or multi-pool simulation coverage. Those outcomes remain tracked in `PRODUCT-AGENT-PLAN.md` and require their own implementation and observed runtime evidence.
