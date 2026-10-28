# Production health checks

Run the read-only check with Node.js 24:

```sh
node scripts/ops/production-health.mjs --state-dir /absolute/private/state-directory
```

Each run makes six public GET requests, at most two at once. Market probes read
only the individual Ethereum and Robinhood reference tokens; they do not fetch
an entire Explore catalog and trigger its market enrichment. The checker does
not call provider APIs directly, trigger an index scan, create a submission,
use a wallet or consume a paid launch. Requests and response sizes are bounded.

The check validates the three chain indexes, current market observations,
reference-token identities and the active Custom API. Base may have no public launches.
Fresh cached values are valid; an old `ready` response is not. Index observations
older than 20 minutes and market observations older than 35 minutes are reported.

Keep the same state directory between runs. Two consecutive failures open an
incident. An unchanged incident is not announced again. Two healthy observations
close it. The JSON result separates `issues` from `opened` and `recovered`; notify
the operator only when `notify` is true. A stale monitor lock is reported instead
of deleted: confirm no check is running before removing that lock.

Run every 15 minutes from the existing operations scheduler. Use a reviewed copy
of the script and verify its hash before execution. A local Codex heartbeat needs
its host available; it is not evidence of a hosted 24-hour uptime service.

Keep provider billing controls separate. Codex auto-scale and per-key limits
cap overage but can stop market data when the quota is exhausted. Check usage
trends before that happens. Keep dRPC balance warnings enabled and top-ups manual.
Do not raise a spending cap or purchase a plan automatically to clear an alarm.

Complete token artwork and social metadata share a six-hour cache across server
instances. Missing metadata retains a 15-minute retry window. These display
metadata caches do not extend the price or chart freshness limits.

On an incident, inspect the current deployment and saved evidence, then repair
the cause through the existing release route. Do not repeatedly restart workers,
run full rescans, rotate keys, relax verification, or repeat a wallet transaction.
After a deployment, verify the actual live endpoint and response contents.
