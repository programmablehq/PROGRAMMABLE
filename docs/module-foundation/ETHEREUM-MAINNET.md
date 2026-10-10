# Ethereum Module Mode

Ethereum Module Mode is available at `/launch/modules/foundation?chainId=1`. Read the active implementation and release from [Ethereum discovery](https://programmable.market/api/module-foundation?chainId=1). The shared catalog publishes the same module source package on Ethereum and Robinhood. Deployment, source matching, lifecycle verification and activation are recorded separately in the versioned evidence below.

## Existing identity and indexing

The Ethereum adapter uses the existing canonical Stamp Router at `0x8622DD5bAb44185f2A458ac90384Ac99248f8d56` and Graph Factory at `0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887`. Their observed runtime hashes, together with the Ethereum Uniswap infrastructure, are pinned in `contracts/spec/module-foundation/chain-1.v1.json` at block 26125239. That file is an infrastructure observation, not a host deployment or release approval.

Launch identity remains `(chainId, router, launchId)` and token identity remains `(chainId, token)`. The canonical `ProgrammableLaunchStampedV1`, `ProgrammableLaunchRouteStampedV1`, `ProgrammableComponentStampedV1`, `launchStamp`, `launchIdByToken`, `launchIdByPool`, `launchIdByComponent`, `componentRuntimeCodeHash` and `stampProof` interfaces retain their existing meaning.

The new execution route is `CustomGraph` in the canonical ABI. It creates a Module Mode coin, but it does not emit a counterfeit Classic launch or claim Classic vault custody. Integrators following the canonical stamp can observe it with the existing ABI. An integrator restricted to the Classic launcher or its events must add this launch source. External indexing is not established by an internal fork test.

## Contracts and UI

`FoundationEthereumGraphLaunchV2` contains the shared settlement implementation. Each new launch creates a fresh `FoundationEthereumGraphProxyV2`, the unchanged Foundation token and the Foundation V2 hook through the Graph Factory. The proxy binds an immutable implementation address and runtime hash. It has no upgrade entrypoint. Its constructor binds the launch wallet and route nonce, and verifies that its exact CREATE2 address belongs to a graph called by the canonical Stamp Router. A direct wallet or forwarding contract cannot initialize the V2 launch account.

The Router deploys the graph and writes the canonical stamp in one transaction. If deployment, market verification or stamping fails, the entire transaction reverts. The implementation cannot be used as a launch account itself. Historical V1 coins retain their original source for trading and fee claims. The immutable V1 contracts remain callable, but a direct V1 factory deployment does not acquire a Programmable stamp.

The launch wallet receives the initial buy and any native refund. Base liquidity and rounding inventory retain the existing irreversible DEAD custody. Platform fees remain 30 basis points. Directional creator fees and module callbacks retain their existing semantics. The Ethereum wallet-cap factory binds the Ethereum Universal Router; the module's implementation and configuration remain shared.

The Studio uses one UI on both networks. Chain profiles select infrastructure, WETH, quote discovery, RPC clients and finality. Prepared actions, pending transactions, results and caches include chain identity. Changing networks remounts the launch session. Ethereum Any Quote discovery uses Ethereum V4 pools and the Ethereum price feed; it does not borrow Robinhood routes or stock feeds.

The Ethereum graph readback adapter reuses the canonical stamp reader and verifies the launch account's implementation, wallet, initialization, parameter hash, launch result and position custody. Its public fixture contains call bytes from the fork test and an explicit note that the permit signature was stubbed. The adapter consumes the existing finalized canonical stamp inventory for per-token source verification.

The graph-plan codec computes CREATE2 addresses, graph commitments, expected deployment results, component sets and stamp requests locally using the canonical contracts' exact encoding. It reproduces the complete fork-tested Router call byte for byte. The codec does not issue permits or establish source admission. Studio composition and wallet preparation use this graph codec and the authenticated same-origin authorization route.

The graph builder now materializes the exact proxy, token and hook creation bytes from a reproducible compiler export. Wallet, release and token salt separate CREATE2 namespaces. Hook mining runs locally, yields between batches and supports cancellation. Metadata is checked before mining. A shared package, `@programmable/module-foundation-ethereum`, gives the API the same implementation as the website without importing trading SDKs.

The two-provider simulator executes the full graph on Ethereum state, checks dependencies and compiler runtime templates, and reproduces the canonical deployment commitment. Its only state override funds the simulated Router. It does not sign or broadcast. A launch with the deployed wallet-cap factory and an initial buy succeeded on both providers at block 26125608. The [read-only evidence](../../contracts/deployments/ethereum-module-readonly-simulation-v1.json) explicitly distinguishes simulated outputs from deployed coins.

## Ethereum deployments

The V2 deployment and lifecycle evidence is saved in [`contracts/deployments/ethereum-module-foundation-v2.json`](../../contracts/deployments/ethereum-module-foundation-v2.json), with its [release descriptor](../../contracts/deployments/ethereum-module-release-v2.json). The V2 contract source is commit `ca4e0f38bd977cdd84e2cf988c456deecdc62b5e`, compiled with Solidity 0.8.26, IR compilation and 200 optimizer runs.

The [V1 deployment evidence](../../contracts/deployments/ethereum-module-foundation-v1.json) remains available for historical coins. V1 and the unchanged wallet-cap factory use source commit `92ff1f513c47fe94ddc1022babffdf95ad47d76b`.

| Contract | Ethereum address | Creation transaction |
| --- | --- | --- |
| V2 launch implementation | `0xEf972d7A9e7e064Ba0842c4537d7cc697c5d2eF4` | [Transaction](https://etherscan.io/tx/0xcef6a5dc94f1133785fd675c1a7667093cff79e0d5c8478d07b9b737332d641d) |
| Historical V1 implementation | `0x487E8A196812fEC534f2D2514bfdc7c609EBAe35` | [Transaction](https://etherscan.io/tx/0x7cdd27a31d16179f9fb19573d20751baece76f38f499c06b610f12774f0eed61) |
| Wallet-cap factory | `0x2960751d51a6559D630F9Fa9D94CD0011816d5D2` | [Transaction](https://etherscan.io/tx/0x228134c7d610c6a952c2cd12b99710b1dabff4a6d2be0ca06db21503b3ed3ed5) |

The V2 receipt records block 26163972 and runtime hash `0x8bbf4dba5090996e29fafa6292c731ce13f580eb54877e689f66820c2b0981df`. Sourcify reports matching creation and runtime code. V2 deployment gas cost 0.000343731713310495 ETH. Deployment, lifecycle verification and production activation are separate observations recorded in the deployment evidence.

## Validation and publication

The V2 Ethereum fork tests cover atomic stamping, direct-factory rejection, native funding, directional fees, initialization, missing permits and wallet-cap behavior including expiry.

The production V2 canary `0xBB73F3Bb5CfAe5629F0a6a58bb10ab1e35e4c11a` launched in [transaction `0xb2d9fc1b…64cc56b3`](https://etherscan.io/tx/0xb2d9fc1b8a311b195d461184a8a50dac62c5557a983351797f534e8564cc56b3). Two independent providers confirmed the successful receipt, canonical token/engine/hook stamp, proxy runtime, initial buy of 0.003 ETH and DEAD liquidity custody. The deployment evidence records the exact block, pool, output and activation.

Historical V1 lifecycle evidence uses canary token `0x1A6A3948B0c54670b634dd2A54598793EE192895`. Its launch, buy, sell and fee claim are in the V1 deployment evidence. The existing canonical stamp reader hydrated its identity after the required confirmations. The website receipt reader independently restored the pool, modules, fee records and liquidity positions. The canary is excluded from public Explore discovery.

The V1 website SDK preparation obtained a real permit through the protected production signer, reconstructed the exact graph and simulated the signed transaction and position custody. That initial preparation was not broadcast. A second canary, `0xE2F175AF5eDf2BA4793ecdad94888FcDC5E1aB5F`, subsequently completed the full SDK wallet revalidation and onchain launch with the shared package metadata. Receipt recovery, module restoration, buy simulation and sell simulation passed for that coin. Wallet-private keys and signer credentials remain outside the repository.

The backend endpoint `/v1/wallet-admin/module-launches/ethereum/authorization` requires an authenticated, body-bound wallet assertion and a selected wallet linked to that user. It accepts the installed source release, verifies module runtime bindings and simulates through two providers before requesting a signature. The website forwards through `/api/module-foundation/authorize`. `PROGRAMMABLE_ETHEREUM_MODULE_MODE=enabled` activates each installed deployment; deployment alone does not enable the feature.

Shared module publication stages one source package on both chains and activates both records in one conditional catalog write. See [the publication workflow](MULTICHAIN-PUBLICATION.md). Existing coins retain their original immutable package and factory bindings.

Some large compositions exceed Ethereum's transaction gas cap. Preparation checks actual execution and gas; an eight-slot interface does not guarantee that every eight-module composition is deployable. External indexers limited to Classic launcher events must consume canonical stamp events to discover these launches.
