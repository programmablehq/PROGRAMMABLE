# Product contract observations

The owner can request `GET /api/custom-ai/product-runtime?id=<preparationId>` with the current wallet session and cache scope. The response is private and is not a transaction authorization.

The reader loads the immutable submitted package, original source, compiled artifacts, independent declaration and product bindings. A later studio edit or expired signing window does not change the historical package or require another build. New graph packages retain the constructor materialization that was already computed, including graphs without constructor children. Old packages remain readable at their original hashes; missing snapshots do not become guessed addresses.

The private backend resource must match the saved controller, request hash and graph profile/intent or Robinhood raw request hash. The observation independently checks its transaction receipt, the pinned executor runtime, exact stamped launch identity, component events and each materialized runtime code hash. Constructor children retain their original parent and nonce; two instances of one source contract cannot be confused. Robinhood also binds component occurrence IDs, plan and manifest digests. Ethereum, Base and HyperEVM use the graph executor stamp.

Both configured providers must agree at a common finalized block. Reads use EIP-1898 canonical block references; the common block is checked again after reading. Receipt status alone, a compact backend status or HTTP 200 does not establish a contract observation. Failures do not produce a healthy response.

There are at most 16 contract addresses and 32 reads per provider. Reads are paced inside the existing provider allowance. There are no log-range scans, background polling, model calls or transactions. Concurrent requests for the same owned preparation share one read; completed observations are cached for 60 seconds and failures back off for 15 seconds. Current wallet ownership is checked on every request, including cache hits.

The collapsed UI exposes the observed addresses and time. Claims, deposits and other wallet actions are not enabled by this snapshot; their typed inputs, current state, transaction preview and user confirmation are separate work. External service deployment and health are also separate from contract presence.
