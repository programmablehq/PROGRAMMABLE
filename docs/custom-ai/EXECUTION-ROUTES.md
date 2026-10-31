# Custom AI execution routes

Source and discovery inventory, 31 October 2026. These are distinct execution paths. A successful discovery response is evidence of advertised availability, not proof of a new funded launch.

| Network | Fixed Custom AI fee core | General Custom Contract path | Current integration gap |
| --- | --- | --- | --- |
| Ethereum, 1 | Active release recorded in `deployments.json`; chat supports this network | V3 direct native hook graph, profile 3.6.0; public discovery authorizes production launches | The chat has no V3 project/submission adapter |
| Robinhood, 4663 | Active release recorded in `deployments.json`; chat supports this network | V4 Custom Launch Plans; discovery reports create, preflight, proofs, read and replan active | The chat has no plan/submission adapter |
| Base, 8453 | No fixed Custom AI core release or chat selection | Chain-scoped V4 custom launches; discovery and readiness report active, ready and publicly authorized | The general path needs its own adapter, wallet currency and chain-bound preparation |
| HyperEVM, 999 | No fixed Custom AI core release or chat selection | Chain-scoped V4 custom launches; discovery and readiness report active, ready and publicly authorized | The general path needs its own adapter, HYPE funding and chain-bound preparation |

## Read-only authorities

- Chat: `https://programmable.market/api/custom-ai/capabilities`.
- Ethereum: `https://api.programmable.market/v3/capabilities`.
- Robinhood: `https://api.programmable.market/v4/chains/4663/custom-launch-capabilities`.
- Base and HyperEVM: `https://api.programmable.market/v4/chains/{chainId}/capabilities` and `/readiness`.

The observed chat version is 2.2.1 using Surplus. It advertises fee schedules as buildable, hook search as research, and external events, fee programs and arbitrary hooks as design-only. Live web research is disabled. This inventory does not activate those capabilities.

## Existing components to reuse

- `lib/custom-ai/rule-spec.ts`, `rule-compiler.server.ts`, `rule-evaluator.ts` and `rule-summary.ts` carry composed rule IDs, execution and display.
- `composable-release.server.ts` checks the exact release, supported feeds/actions and operational health before enabling a combined design. Feeds and programs cannot be enabled by adding a chain to the UI.
- `lib/custom-ai/store.server.ts` owns account-scoped jobs, results, allowance reservations, versions and operation locks. The browser caches a supplemental copy.
- `app/api/custom-ai/route.ts` keeps an existing account job running after the event stream disconnects. `GET` reads that same job. The UI still needs automatic reconnection to this stored job after reload, with phase persistence.
- The general Custom Launch backend remains the submission, review and source-evidence authority. Ethereum uses `/v3/custom-launches`; Base and HyperEVM use `/v4/chains/{chainId}/custom-launches`. Robinhood Custom Plans use their generated contract and manifest.
- `docs/public/developers/machine-readable.md` and the chain guides expose the existing GitBook discovery contract. Extend that path rather than introducing a second documentation site.

## Required next work

Persist the complete user intent and revision before selecting an execution path. Build an adapter for each existing general path and retain its current review/evidence policy. Do not reuse the fixed fee-core restrictions as the general contract policy. Every chosen path must produce a common revision-bound preparation result and recover through its original job/submission identity.

No fresh wallet transaction, provider budget increase, chain lifecycle acceptance or full index scan was performed for this inventory. Financial acceptance and public chat integration remain separate work items.
