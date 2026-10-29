# Custom AI worker

The worker processes at most eight due operations per run (hard maximum twenty). Configure only explicitly reviewed chain/target adapters and operator-approved per-transaction and daily budgets. An adapter owns its reporter credential; neither chat tools nor browser requests can access it.

Feed, historical price, fee collection, execution and index readback are distinct operation kinds. An operation id binds chain, target and source event. Leases are stored in the existing Custom AI database. Signed transaction bytes, hash and cost reservation are committed together before broadcast. A restart checks the receipt and can rebroadcast those exact bytes; it never signs a replacement for an unknown outcome.

`runDueJobs(journal, adapters)` is the service entry point. Deployment must inject adapters using the source-bound release addresses and approved signer custody. No worker starts merely by importing this module or opening the website. No production budgets or feeds are activated by this implementation.

Stop by stopping the service; recorded jobs and user claims remain. Restart against the same database. Failed receipt checks defer with a bounded backoff. Review a reverted operation before enqueueing a new semantic event. Existing completed operation ids are never executed again.

After twelve unsuccessful observations an operation enters `attention` and stops automatic attempts. Unknown signed transactions keep the signer reserved; inspect their saved hash before resuming. Never clear that reservation simply because a provider timed out.

## Run the service

Build from a clean reviewed checkout with `node scripts/build-custom-ai-worker.mjs`. Validate the private operator configuration with `node out/custom-ai-worker.mjs --check /path/to/worker.json`. This performs no network requests or transactions. Start one bounded iteration with `--once`, or a persistent service with `--run`. A normal process manager may restart the service; it always resumes the same database journal.

Configuration version 1 binds the exact composable bundle hash and one or two networks. Each network supplies `chainId`, the verified `programFactory`, `signerKeyEnv`, `priceKeyEnv`, two `rpcEnvs`, `transactionLimitWei`, `dailyLimitWei`, and its `feeds`. Credential fields are environment-variable names beginning with `CUSTOM_AI_`, never keys or endpoints. Each feed supplies its source-bound `binding`, `definition`, and `signerKeyEnv`. Use explicit owner-approved budgets. `CUSTOM_AI_WORKER_ACTIVE=true` is also required to execute.

Feed definitions are weather model data or cached website market observations. Production weather requires the commercial Open-Meteo endpoint. Market definitions bind a token, network, metric, six-decimal USD scaling and freshness window. They do not turn a market estimate into a price guarantee. The same source is shared across network feeds, and repeated data is not another event. The worker never obtains a provider key from a chat message.

Confirmed launch journals register their programs through a bounded database cursor. Pool observations retain bounded history. The service verifies canonical program bindings, derives the permitted event, and prepares the full fee collection and liquidity operation atomically. A sent transaction is polled with backoff; identical bytes are rebroadcast only while initial delivery is unknown.

One worker watches at most eight programs per iteration, with at most four concurrent read tasks. Source polling has persisted deadlines and is shared across networks. This initial worker advertises capacity for eight active programs; if more are registered, readiness blocks further public program launches while existing jobs continue to be observed. Increase capacity only with measured polling latency and current price-history coverage. A restarted worker collects fresh history before it can execute a liquidity rule.

Before enabling public combined launches, deploy the pinned contract bundle, record source/runtime hashes, install the source credentials, and run the approved funded acceptance. Check each supported network independently. A successful container build or `--check` does not meet this acceptance.
