# Verification status

The new platform is a candidate implementation. Passing local or isolated
provider checks does not establish a production release or complete A1–A6
acceptance for ordinary authenticated users.

| Boundary | Existing verification | Remaining release evidence |
| --- | --- | --- |
| Ownership and storage | Native PostgreSQL, two owners and two projects each; forced RLS; immutable history; repeated and rolled-back migration; ordinary staging sessions deny foreign access | Production database role/grants and the controlled production pilot |
| Project changes | Revision conflicts, provenance, idempotent writes, real browser edit/compare/restore, binary import/export and legacy source preservation | Remaining reference projects through the deployed UI and production pilot |
| Model and contract builder | Both ordinary staging users completed A1 planning, source, compiler/EVM checks, audit, immutable checkpoint and private unsigned preparation | A2 baseline/build/targeted edit for both users; a failed real model probe is not a pass |
| Sandbox | Real provider lifecycle for both staging users, denied egress, no inherited host secrets and confirmed cleanup; separate live-provider test of billed-minute reservations | Exact production configuration and restart verification |
| Connections | Both ordinary staging users passed real public/private HTTP, OAuth callback/refresh, MCP discovery/calls, key rotation/revocation and signed webhook checks | Production callback origin, credentials and ordinary access |
| Hosting and data | One ordinary staging user's app passed preview/live separation, visitor calls, real scheduled work, pause/resume, credential retirement and a second deployment with retained data | First user's full operation; accessible final versions; controlled production pilot |
| Game events | Individual-player signatures, one-to-one wallet binding, replay/staleness checks, 93 Solidity tests and local RPC cases; fixed external result service prepared | Both complete A5 flows with the actual receiver and observed fee effect; local RPC is not public deployment |
| Repository delivery | Both ordinary staging users imported, edited and exported two pinned projects each, preserving binary bytes, executable modes and the original branch | Production pilot |
| Interface | Desktop/mobile/keyboard regressions, real browser file persistence and hosted-app interaction; pilot fallback preserves legacy drafts and account isolation | Remaining A2/A4/A5 UI flows and production pilot; two generated form inputs still need explicit labels |

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

The application backup was restored into an isolated local PostgreSQL instance.
All 1,425 rows in the three existing chat tables retained their content hashes,
schema and access controls. The same 39-table additive migration passed dry-run,
apply, verify and repeat against that restored copy without changing legacy
data. This is an application-scoped recovery rehearsal, not a production
migration or a backup of provider storage and authentication data. Take a fresh
verified snapshot immediately before the actual production migration.

Renamed or extended canonical contracts can declare their inherited interface
through `architecture.canonicalInterfaces` in the initial plan. Each reference
binds an entry ID to a pinned canonical source and contract. The server adds
missing methods without replacing existing declarations or changing behavior
steps, expected results, source files or deployment arguments. Conflicting
signatures fail closed. A saved reference cannot be swapped while the user's
requirements remain unchanged. Interface completion is planning evidence;
compilation, behavior checks and source review still have to pass separately.

## Current release blockers

- Both ordinary users passed the A1 scope through checked private unsigned
  launch packages. A recorded preparation does not imply a still-valid package
  or an onchain launch. A2 planning/build/edit and both A5 flows remain open;
  their normal-account allowances must not be bypassed for acceptance.
- A4 operation passed through the deployed product for the second user,
  including real visitor data, scheduling, pause/resume and redeployment. The
  first user's app still needs its final verification and operational checks.
  Correct and verify the generated form labels before accepting the final UI.
- The deployed worker accepts an owner/project/run-bound grant and rejects
  duplicate admission. Two authenticated staging accounts pass ownership,
  HTTP/MCP connections, OAuth callback/refresh and signed-webhook checks.
  The staging browser origin is configured and browser sign-in has been checked.
  This does not substitute for the remaining complete product workflows.
- The corrected sandbox transport passes real hosted VM execution for both
  ordinary staging accounts: private files remain isolated, outbound access
  is denied by policy, host credentials are absent, and cleanup is confirmed.
  These staging results do not establish the production environment.
- The dedicated hosting credential is configured and has supported actual app
  publication. The separate production worker's source, health and protocol
  match are verified; a positive production work grant remains untested.
- Complete the remaining A2/A4/A5 staging acceptance, final candidate CI,
  production migration/grants, production pilot and general release. The
  platform has not been enabled for production users.
