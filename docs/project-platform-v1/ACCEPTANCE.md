# Project Platform V1 acceptance map

The fixtures in `tests/fixtures/custom-ai-platform/reference-projects.json` describe independent user outcomes. They are evaluated using observations of the exact current revision. They do not grant authority to the model or replace existing release checks.

| Requirement | Owned work | Required evidence |
| --- | --- | --- |
| R01 Tenant isolation | P02, P05, P07, P12 | Foreign project/artifact/secret/run access denied. |
| R02 Natural conversation | P01, P04, P11 | Colloquial instructions, corrections and discussion-only cases retain meaning. |
| R03 Complete requirements | P02, P03, P06 | No lost requirement; explicit removal and implementation mapping. |
| R04 Coherent revisions | P02, P03 | Concurrent conflicts, immutable history and idempotent edits. |
| R05 Durable work | P04, P08 | Restart, cancellation and uncertain-side-effect reconciliation. |
| R06 Isolated execution | P05 | Real provider lifecycle and filesystem/network/resource-boundary checks. |
| R07 Editing/export | P03, P10, P11 | Complete files, differences, revision restore and export. |
| R08 Tool authority | P04, P07 | Validated grants, schemas, budgets and unauthorized calls denied. |
| R09 Authenticated connections | P07 | Real controlled HTTP/OAuth calls and webhook replay tests. |
| R10 Secret custody | P05, P07, P08 | Scoped delivery, revocation, redacted outputs and no source/export leakage. |
| R11 Plugins | P07 | Versioned connection, scoped invocation and revocation. |
| R12 Complete applications | P06, P08 | Working frontend/backend/data/job after restart. |
| R13 External events | P09 | Signed event origin, wallet binding, stale/replayed event rejection. |
| R14 Requirement evidence | P01, P06, P12 | Independent expectations and current artifact-bound checks. |
| R15 Release binding | P08, P09, P13 | Exact tested artifacts, target, authority and live observations. |
| R16 Existing projects | P02, P10 | Legacy import preserves history; external source remains unchanged. |
| R17 Accessible interface | P11 | Desktop/mobile/keyboard and session-recovery checks. |
| R18 Resource budgets | P04, P05, P07, P08 | Finite reservations, reconciliation, cancellation and quota behavior. |
| R19 Accurate status | P04, P06, P11 | Build/preview/real operation clearly distinguished. |
| R20 Complete delivery | P12, P13, P14 | All requirements and six reference cases covered by observed release evidence. |

Cases A1–A6 cover a coin, composed hook edits, authenticated APIs, a persistent web application, game events and repository import/export. A1/A2 baseline capabilities do not imply A3–A6 are delivered. All cases require the same project architecture and at least two independent test users.
