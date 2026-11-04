# Product agent implementation

The goal is a chat that develops and operates complete onchain products from a user's idea. A hook may be one component alongside a token, vault, external adapter, automation, index and interface. The existing canonical design, ownership checks, source bindings, provider budget and wallet confirmation remain authoritative.

## Required outcomes

| ID | Outcome | Acceptance evidence | State |
| --- | --- | --- | --- |
| P1 | One executable product blueprint ties the user's rules to components, assets, money flows, integrations and interface actions. | A saved multi-component design survives questions, edits, reload and build; every rule and output links to the same revision. | In progress |
| P2 | The agent discovers and builds missing capabilities in isolation and registers only qualified, versioned implementations with bounded permissions. | A missing adapter is researched, implemented, checked and reused; unqualified code cannot execute or acquire privileges. | Pending |
| P3 | Economic reasoning explains funding, recipients, competing claims, timing and manipulation risks. | Real user designs detect missing allocations, double spending, unsupported benefits and snapshot gaming without inventing choices. | Pending |
| P4 | Creative exploration produces distinct feasible designs while preserving the current accepted design. | Alternative concepts differ in mechanism and tradeoffs; only an explicit selection updates the saved product. | Pending |
| P5 | The complete product can include contracts, data publishers, automation, indexing, claim interfaces and metrics. | One blueprint produces a functioning integrated product package and its hosted interface on supported deployment routes. | In progress: source components and actions are bound; hosting and runtime activation remain |
| P6 | Users can explore how a design behaves under specific scenarios. | Scenario requests use the saved product, display actual changes in balances/state, and distinguish simulations from live observations. | In progress: inspect actual saved execution; new scenario construction remains |
| P7 | After launch the agent observes operation, identifies failures and performs permitted service recovery. | Live deployment identity, data freshness and automation health are checked; repairs preserve approved powers and budgets. | Pending |
| P8 | Reviewed capabilities are reusable across products; private drafts remain private. | Shared published packages are versioned, attributable and reproducible; another owner cannot access private source or credentials. | Pending |
| P9 | Ordinary users keep a short conversational flow with visible progress and automatic bounded recovery. | Describe, settle real choices, inspect preview and launch; interruptions resume saved work without repeated user instructions or duplicate charges. | Pending |
| P10 | New skills and voice updates do not unnecessarily invalidate ongoing work. | Unchanged execution dependencies retain resumability; changed contract/economic authority still requires fresh bound evidence. | Pending |
| P11 | Verification covers real routing, non-native quote assets, multi-component and multi-pool behavior. | Representative real swaps/claims through the declared route, including failure and recovery paths; no invented coverage for unsupported worlds. | Pending |

## Delivery order

1. Extend the current intent and job flow with a validated product blueprint and economic analysis. Expose the actual saved structure to the planner and source stages.
2. Add qualified capability packages, integration implementation and typed execution requirements. Keep credential resolution and spending authority outside generated code.
3. Materialize product components, simulation scenarios and interface actions from the same blueprint.
4. Attach deployment-bound operations, health and recovery. Add reusable private and explicitly published packages.
5. Verify complete representative products and publish through the existing release process. Local construction, successful checks, deployment, live execution and operational readiness are separate evidence states.

Do not mark this goal complete after only the blueprint layer. Do not describe proposed services or adapters as running. Reuse valid checks and compiled source; run targeted new regressions for changed behavior. New spending, credential grants or financial transactions are not inferred from a design request.
