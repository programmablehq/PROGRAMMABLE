# Custom AI execution routes

The selected chain and complete saved intent determine the route. A module is selected only when it covers every requirement. Otherwise the same intent goes to general contract source generation. Open choices stay attached to their canonical requirements.

| Network | Fixed Custom AI fee core | General Custom Contract path | Current integration gap |
| --- | --- | --- | --- |
| Ethereum, 1 | Supported | V3 native hook graph | Public chat activation and exact source admission required |
| Robinhood, 4663 | Supported | V4 Custom Launch Plan | Public chat activation and exact source admission required |
| Base, 8453 | No fixed core | Chain-scoped V4 native hook graph | Public chat activation and exact source admission required |
| HyperEVM, 999 | No fixed core | Chain-scoped V4 native hook graph, HYPE funding | Public chat activation and exact source admission required |

## Read-only authorities

- Chat: `https://programmable.market/api/custom-ai/capabilities`.
- Ethereum: `https://api.programmable.market/v3/capabilities`.
- Robinhood: `https://api.programmable.market/v4/chains/4663/custom-launch-capabilities`.
- Base and HyperEVM: `https://api.programmable.market/v4/chains/{chainId}/capabilities` and `/readiness`.

These are implemented paths, not a claim that a newly generated source is launchable. The owned general preparation route requires `CUSTOM_AI_GENERAL_LAUNCH_ENABLED`, current production configuration, exact source/evidence and backend admission. On 2 November 2026 public chat discovery reported general launch preparation `not-enabled` and hosted web research disabled. Backend API availability does not enable this chat switch. Fixed fee launches retain their separate policy and preparation.

## Existing components to reuse

- `lib/custom-ai/rule-spec.ts`, `rule-compiler.server.ts`, `rule-evaluator.ts` and `rule-summary.ts` carry composed rule IDs, execution and display.
- `composable-release.server.ts` checks the exact release, supported feeds/actions and operational health before enabling a combined design. Feeds and programs cannot be enabled by adding a chain to the UI.
- `lib/custom-ai/store.server.ts` owns account-scoped jobs, results, allowance reservations, versions and operation locks. The browser caches a supplemental copy.
- `app/api/custom-ai/route.ts` keeps an existing account job running after the event stream disconnects. `GET` reads that same job. The UI reconnects to the stored request and its saved phase after reload.
- The general Custom Launch backend remains the submission, review and source-evidence authority. Ethereum uses `/v3/custom-launches`; Base and HyperEVM use `/v4/chains/{chainId}/custom-launches`. Robinhood Custom Plans use their generated contract and manifest.
- `docs/public/developers/machine-readable.md` and the chain guides expose the existing GitBook discovery contract. Extend that path rather than introducing a second documentation site.

## Routing and knowledge

`model-tasks.ts` owns planning, interface declaration, scenario declaration, bounded correction, source generation and source-audit roles. All use the configured provider; a missing Surplus connection never silently spends through another provider. Task metrics identify the actual role and token usage. The discovery response describes the routing policy without exposing credentials.

`protocol-knowledge.ts` owns small reviewed knowledge topics. The registered `protocol` tool needs no network or provider call and works on all four chains. Live web research remains an independent capability. `canonical-interfaces.json`, generated from pinned source artifacts, supplies actual protection-kit interfaces before declaration. Source hashes are checked against the inline source packages.

The production router, isolated scenario router and Uniswap Universal Router are different interfaces. Hook permissions, payer identity, hook data, quote behavior and settlement must be established for the selected path. A v4-compatible hook is not automatically included in Uniswap's app or hosted routing API.

## Recovery and remaining activation

Owned jobs keep the canonical intent, source, blueprint, compiler result and scenario report. An invalid declaration stores bounded private validator feedback; public status contains only its stage and code. On an explicit later build, an exactly matching rejected declaration can receive one correction without repeating interface/scenario generation. Different intent, chain, compiler, production configuration or interface catalog cannot reuse that rejection. No correction establishes launch readiness.

Retain each route's current source/evidence policy and verify backend activation before enabling general launch preparation. Financial acceptance, public availability and successful source generation remain separate states. See [capability boundaries](CAPABILITY-BOUNDARIES.md).
