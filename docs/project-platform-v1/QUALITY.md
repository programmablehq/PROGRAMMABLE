# Verification status

The new platform is a candidate implementation. Passing local or isolated
provider checks does not establish a production release or complete A1–A6
acceptance for ordinary authenticated users.

| Boundary | Existing verification | Remaining release evidence |
| --- | --- | --- |
| Ownership and storage | Native PostgreSQL, two owners and two projects each; forced RLS; immutable history; repeated and rolled-back migration | Exact deployed database role/grants and normal product sessions |
| Project changes | Revision conflicts, provenance, idempotent writes, binary import/export, legacy source preservation | Full reference projects through the deployed UI |
| Model and contract builder | Real provider probes plus compiler/EVM checks; invalid plans retain the saved project | A1/A2 end-to-end success remains required; a failed real model probe is not a pass |
| Sandbox | Real provider lifecycle, denied egress, no inherited host secrets and cleanup | Exact production configuration and restart verification |
| Connections | Real controlled HTTP, OAuth PKCE/refresh, MCP and signed webhook tests | Ordinary-user OAuth return and revocation through staging |
| Hosting and data | Real isolated deployment/data/job probes; control race, unknown response, expired worker and bounded retry regressions | New control path against the exact deployed provider/runtime pair |
| Game events | Signatures, consent, replay and local RPC tests; independent public chain readback | A5 UI acceptance; no local-chain result substitutes for public deployment |
| Repository delivery | Public/private pinned import and a real private draft PR | Complete A6 through the deployed product |
| Interface | Desktop, narrow layout, keyboard navigation and saved-state browser cases | Ordinary-account full-flow acceptance and final exact-candidate run |

Run the focused platform Vitest tests with the pinned compiler directory and
exclude temporary private provider probes from ordinary regressions. The
platform browser suite is selected by `playwright.custom-ai-platform.config.ts`.
Run TypeScript, ESLint, schema generation verification and the repository's
required interface/release checks for the actual candidate tree.

Security review of the new platform and direct launch bridge identified an
unsigned webhook-event-identity replay issue; the versioned signature now binds
the route, event ID, timestamp and exact body. Tests exercise that rejection.
Recognizable credential patterns are blocked/redacted, but arbitrary strings
cannot reliably be identified as secrets. Private connection fields remain the
supported credential path.

Every final acceptance record must identify its source revision, environment,
authentication method, observed result and cleanup status. Deterministic model
fixtures, local RPC execution, source compilation and real public behavior are
different forms of evidence and must remain distinguishable.

## Current release blockers

- A basic canonical coin now passes real model planning, compilation, 32 EVM
  cases, independent source review and source-checkpoint creation. Earlier runs
  exposed provider-format, copied-context and incomplete-interface failures.
  The full A1 reference additionally requires staged fees and the deployed user
  flow; those remain necessary.
- A real two-release provider probe confirmed that a new preview preserves the
  previous production target, an uncertain promotion closes data access, and an
  exact retry retires the previous live key while preserving data. After fixing
  redundant unpause calls and requiring actual HTTP confirmation, pause and
  resume also passed against that live provider. These isolated checks still
  need to be joined to the deployed product and ordinary-user acceptance.
- Production migration/grants, worker authentication, the dedicated hosting
  credential and ordinary-user A1–A6 staging acceptance remain outstanding.
