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
| Daily sandbox reservation | 3,600,000 ms per account, 7,200,000 ms platform-wide; usage rounded up to minutes |
| Hosted projects | Two per account, 16 platform-wide |
| App release attempts | 20 per account per day |
| Application data | 10,000 requests/day, 4,096 items and 32 MB per project |
| Mutation receipts | At most 25,000 and a bounded 32 MB history per project |
| Scheduled tasks | Ten per project, intervals from one minute to one week |
| Hosting control recovery | At most three automatic attempts for one saved intent |

The chat requests up to 20 AI units per work unit, bounded by the account's
remaining hourly and daily allowance. It keeps an unsent message when no units
remain and preserves the exact reservation when retrying a request whose
response was lost. The server remains authoritative for global limits,
concurrency and reservations.

Work reserves its allowance before execution. Unused AI reservations are
refunded on settlement. Sandbox reservations are reconciled against observed
duration for new runs, rounded up to the provider's one-minute memory billing interval, only
after cleanup is confirmed. A sub-minute run consumes one minute of capacity;
61 seconds consumes two minutes. The job record keeps the actual duration
separately. Unconfirmed cleanup retains the complete four-minute reservation.
Unknown side effects keep their
receipts; creating a new request identifier is not a refund mechanism.

At the published Frankfurt (`fra1`) rates checked on 2026-11-07, Active CPU is
$0.184 per vCPU-hour and memory is $0.0304 per GB-hour. The fixed 1-vCPU/2-GB
profile and a fresh two-hour platform reservation budget therefore correspond
to at most $0.4896 of sandbox CPU plus memory at 100% CPU utilization. At most 120 charged
minute units also bound creation fees to $0.000072 at $0.60 per million
creations. These are conservative estimates for those sandbox meters, before
tax, credits or future price changes. Model calls, hosted applications, build
work and other provider meters have separate limits and costs; this is not a
team spending cap. Rates and billing increments come from
[Vercel Sandbox pricing](https://vercel.com/docs/sandbox/pricing#regional-pricing).

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
