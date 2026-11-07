# Hosted applications

The application profile supports static sites, Node API functions, and Vite frontends. Builds run in the project sandbox. A validated Vercel Build Output API package is uploaded without rebuilding project source on the hosting service. Node functions are bounded to 30 seconds and 1 GiB. This profile does not currently deploy a Next.js server application.

The saved architecture declares `application.framework`, `application.dataVersion` (initially 1), and optional `outputDirectory` and `buildCommand`. API handlers live in `api/*.js`; pin esbuild when TypeScript or external runtime packages need bundling. Full source, requirements and independent behavior checks must pass before a release can be queued.

A release moves through queued, building, ready, published, stopped, failed or reconcile. Ready means the immutable deployment answered the revision health check. Publication promotes that exact deployment. An uncertain submission is looked up by release identity; it is never blindly sent again. Changing source requires new verification. Rollback requires the same data contract and does not reverse external effects.

Publication, pause and resume use one durable control intent per application.
Only that intent can run until its outcome is confirmed. Application data access is
paused while the provider target is being confirmed; the selected data key and
the resulting release state are committed together. A restarted worker can
reconcile the same intent, and late workers cannot overwrite its result. The
operations dispatcher makes at most three automatic attempts. An exhausted
attempt remains visible with **Retry hosting action**, which repeats the saved
action rather than selecting another release.

## Application data and private connections

Only the server receives `PROGRAMMABLE_APP_TOKEN`, `PROGRAMMABLE_DATA_URL`, and `PROGRAMMABLE_CONNECTOR_URL`. Never include the token in a browser bundle. Generated app projects do not receive platform database credentials or provider identity tokens.

The data endpoint accepts POST JSON with `Authorization: Bearer <app token>`:

```json
{"op":"increment","collection":"scores","key":"player-id","delta":1,"idempotencyKey":"match-unique-id"}
```

Supported operations are get, list, put, delete and increment. Writes require a stable idempotency key. An identical retry returns its saved result; changing the body for a used key fails. `expectedVersion` provides optimistic concurrency. Deleting a record preserves a version tombstone, so a replacement cannot reuse an old version. Tombstones count toward the item allowance. Lists return at most 100 items with a cursor. Storage is isolated by project and preview namespace. Promoting a preview attaches it to the existing live data and retires the preceding live credential; it does not copy test data into production. Applications must implement their own visitor authentication and resource ownership.

Each project has a 10,000-request daily allowance, at most 4,096 data items, 32 MB of item storage, and a bounded mutation receipt history. Reaching a limit fails before the next mutation. Two hosted projects per account, 16 platform-wide, and 20 release attempts per account per day are the initial hosting limits.

Private connection calls use the same bearer token and the exact reviewed connection/action/version. Connection secrets remain in the connector service. Revocation takes effect there; generated source does not receive the third-party credential.

## Scheduled tasks

Tasks call an API endpoint on the active published app. They cannot choose an arbitrary destination. At most ten tasks per project are supported, with intervals from one minute to one week. Each invocation receives `jobId`, `runId`, and `input`; the `Idempotency-Key` header matches the stable `runId`.

Declare a handler idempotent only when repeated run IDs cannot repeat its effect. Idempotent tasks retry at most three times using the same run ID. Unknown non-idempotent results and exhausted retries enter reconcile and disable that task for review. A stopped application receives no new scheduled work. A changed release or task definition cannot reuse an old pending task as a new action.

The authenticated operations cron dispatches agent runs, pending app releases and due tasks. Public clients cannot enumerate dispatch queues. Jobs, release status and per-run receipts are visible only to the project owner.

## Verification boundary

Local tests cover data isolation, duplicate mutations, preview separation, source-bound release admission, deployment reconciliation and stopped jobs. Provider probes must additionally prove actual deployment, publication, data persistence after restart, scheduled callbacks, and pause/resume. These checks do not replace the complete normal-user product acceptance tests.
