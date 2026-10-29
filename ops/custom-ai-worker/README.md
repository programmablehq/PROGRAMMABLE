# Custom AI worker

The worker processes at most eight due operations per run (hard maximum twenty). Configure only explicitly reviewed chain/target adapters and operator-approved per-transaction and daily budgets. An adapter owns its reporter credential; neither chat tools nor browser requests can access it.

Feed, historical price, fee collection, execution and index readback are distinct operation kinds. An operation id binds chain, target and source event. Leases are stored in the existing Custom AI database. Signed transaction bytes, hash and cost reservation are committed together before broadcast. A restart checks the receipt and can rebroadcast those exact bytes; it never signs a replacement for an unknown outcome.

`runDueJobs(journal, adapters)` is the service entry point. Deployment must inject adapters using the source-bound release addresses and approved signer custody. No worker starts merely by importing this module or opening the website. No production budgets or feeds are activated by this implementation.

Stop by stopping the service; recorded jobs and user claims remain. Restart against the same database. Failed receipt checks defer with a bounded backoff. Review a reverted operation before enqueueing a new semantic event. Existing completed operation ids are never executed again.

After twelve unsuccessful observations an operation enters `attention` and stops automatic attempts. Unknown signed transactions keep the signer reserved; inspect their saved hash before resuming. Never clear that reservation simply because a provider timed out.
