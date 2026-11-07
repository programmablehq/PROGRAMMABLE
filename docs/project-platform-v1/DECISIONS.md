# Project Platform V1 implementation decisions

## Shared project state

Keep the existing contract and launch pipelines. Introduce owner-scoped immutable project revisions and attach contract results, files, runs and release observations to those revisions. The chat is an interface to the project; it is not the only persistent state.

Use an additive `programmable_projects_v1` PostgreSQL schema. Runtime operations set a transaction-local owner scope; row-level policies and explicit query predicates enforce isolation. Generated code never receives the platform's database administration credentials.

Maintain existing chats and source records. Import them through an explicit adapter, preserving requirements and source provenance. No bulk replacement or destructive migration is part of this change.

## Execution and providers

Use the existing Vercel account for isolated development execution and web delivery, and the existing backend environment for durable orchestration. Keep provider-specific code behind narrow interfaces. Do not execute untrusted project code inside the website or launch API process.

Initial sandbox profile: one vCPU, 2 GiB provider memory, a maximum 600-second work unit, one active sandbox per owner, two platform-wide during pilot, network denied unless a declared dependency or connection grants it. The provider's filesystem limit must be reported truthfully; application source and returned artifacts have separate enforced byte limits.

Keep current model-provider configuration and existing per-owner/global AI budgets. Meter sandbox reservations and external operations before dispatch, release unused reservations, and do not silently increase an account's established billing authority. No new recurring vendor subscription is selected by this decision.

Persist source revisions and outcomes outside ephemeral sandboxes. A stopped sandbox is not application hosting. Application releases have their own artifacts, configuration, health observations and recovery path.

## Verification and operation

The product can report a required feature as complete only when its current revision has the appropriate evidence. Preserve distinctions among source generated, compiled, behavior checked, prepared, deployed and observed.

Task retries use idempotency keys and worker fencing. An uncertain external side effect is reconciled before it is repeated. Passing a mock does not prove a live provider integration.

Keep development changes on isolated branches. Merge and publish through the existing reviewed production process. Optional new ideas go into a later backlog instead of changing the completion criteria of this release.
