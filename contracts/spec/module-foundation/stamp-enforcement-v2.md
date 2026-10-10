# Ethereum Module Mode stamp enforcement

## Boundary

`FoundationEthereumGraphLaunchV2` and `FoundationEthereumGraphProxyV2` add a contract-level condition to new Module Mode launch accounts. The existing generic Graph Factory remains permissionless. The existing canonical Stamp Router remains the only permitted creator of a V2 launch account through that factory.

The V2 proxy constructor delegates to `initializeStampedGraphWallet`. The implementation recomputes its own expected CREATE2 address from the exact proxy creation bytecode and constructor arguments. Its salt binds the current chain, immutable Graph Factory, Module Mode namespace, route nonce, engine target, zero applicant salt and immutable Stamp Router. The generic factory uses the actual authorized caller in the same salt. A direct wallet or forwarding contract therefore creates a different address and fails initialization, reverting the graph.

The implementation validates the Router's Graph Factory and PoolManager at construction, pins its runtime hash, and refuses the V1 wallet initializer. The implementation address itself is initialized and cannot become a launch account. No `tx.origin`, owner switch, registry override or offchain assertion supplies this condition.

Once the canonical Router has deployed the graph, its existing output, market and stamp verification must complete in the same transaction. A later verification failure rolls back the proxy, token, hook, pool initialization and stamp state together.

## Compatibility

Settlement, module callbacks, directional creator fees, 30 basis point platform fees, liquidity custody and the canonical stamp ABI retain their existing semantics. New launch requests use the V2 proxy creation bytes and include the route nonce in its constructor. Historical stamped V1 launches retain their original source bindings for trading and fee claims.

V1 contracts already deployed on chain cannot be disabled or patched. An arbitrary caller can still deploy V1 or copy public code, but that is not a newly authorized V2 Module Mode launch and does not acquire a Programmable stamp. Neither a website flag nor an indexer entry can retroactively supply a missing canonical stamp.

## Release evidence

The source is not itself a production activation. Activation requires the deployed V2 implementation and exact runtime, matching website/API bytecode packages and source releases, preserved historical readers, and a successful stamped lifecycle. The adversarial fork cases cover direct wallets, forwarding contracts, legacy proxy initialization, mismatched constructor nonces and a failed post-deployment result check. The latter must leave all predicted contracts undeployed and the Router token lookup empty.
