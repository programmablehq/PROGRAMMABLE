# Resource accounting

The current profile enforces resource allowances rather than estimating a
currency cost. Provider charges still depend on the account's actual plan and
usage. None of the values below is a general spending cap.

| Resource | Enforced initial allowance |
| --- | --- |
| AI work | 25 units per account per hour, 100 per day, one concurrent run |
| Global AI work | Explicit `CUSTOM_AI_GLOBAL_DAILY_UNITS`, validated at startup |
| Active background workers | Two across the platform |
| Workspace reads | 120 per account per hour |
| Single-run and single-release progress | 120 per account per minute, shared progress bucket |
| Workspace writes | 30 per account per hour |
| Model planning step | 1 unit, bounded input observations and output budget |
| Contract compile/check/audit | 2 units each |
| Sandbox concurrency | One per account, two across the platform |
| Sandbox execution | At most 240 seconds per sandbox, 1 vCPU and 2 GiB profile |
| Daily sandbox reservation | 3,600,000 ms per account, 7,200,000 ms platform-wide |
| Hosted projects | Two per account, 16 platform-wide |
| App release attempts | 20 per account per day |
| Application data | 10,000 requests/day, 4,096 items and 32 MB per project |
| Mutation receipts | At most 25,000 and a bounded 32 MB history per project |
| Scheduled tasks | Ten per project, intervals from one minute to one week |
| Hosting control recovery | At most three automatic attempts for one saved intent |

Work reserves its allowance before execution. Unused AI reservations are
refunded on settlement. Sandbox reservations are reconciled against observed
duration only after cleanup is confirmed. Unknown side effects keep their
receipts; creating a new request identifier is not a refund mechanism.

Progress polling fetches only the active run or release. It does not repeatedly
download project files, check evidence or job history. File changes trigger a
separate revision read; failure to reload those files does not hide the run's
terminal status. Hosting controls stop polling after automatic recovery is
exhausted and wait for an explicit retry of the saved action.

Applications have an independent lifetime from development sandboxes. Pausing
an application stops its data access and provider service, and stops dispatch of
new scheduled work. It does not promise the provider has deleted every billable
resource. Resource deletion and provider billing readback are operator actions
with their own evidence.
