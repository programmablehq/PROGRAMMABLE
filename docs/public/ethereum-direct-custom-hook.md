# Ethereum Custom Hook: direct launch and Programmable indexing

This handoff covers an Ethereum Mainnet Custom Hook built outside the Custom Launch API. It defines the canonical launch stamp and indexing identity. The hook's economic design remains the builder's choice.

## Platform fee

The platform fee for new Custom Launches on Ethereum Mainnet and Robinhood is **1% (100 bps)** on each successful buy or sell through the launch's fee-bearing pool. Project fees and liquidity-provider fees are separate. A 1 ETH trade at this rate allocates 0.01 ETH to Programmable.

Implement and disclose the exact fee basis, asset, accounting mode, Programmable recipient, rounding, accrual and claim path in the hook's reviewed configuration. Do not derive the platform charge from `PoolKey.fee`; that field describes the pool's LP fee. Use integer arithmetic: 100 basis points is `10,000` hundredths of a bip, or `10,000 / 1,000,000`. A stamp proves launch identity, not fee enforcement or payment. Earlier contracts and exact versioned API profiles retain their original rates.

## Launch boundary

Execute a fresh CustomGraph through the canonical Ethereum `ProgrammableLaunchStampRouterV1.launchAndStampV1(permit, stampRequest, routePayload, signature)`. The Router deploys the graph through its bound Graph Factory, runs its initializers, checks the resulting contracts and newly initialized Uniswap V4 pool, then stamps the launch atomically.

The signature must be accepted by Programmable's exact EIP-1271 permit authority for that permit digest. The builder's wallet signature alone does not provide this authorization. The launch API is one permit workflow; another preparation workflow does not remove the Router's authority check. Prepare the graph and permit for Programmable's authority before executing. This bundle cannot issue authorization.

A name, logo, metadata field, copied Router, or self-emitted event does not create canonical provenance. Direct Graph Factory calls and separately deployed tokens do not qualify for a later Router stamp. CustomGraph components must be fresh graph outputs, and the pool must be uninitialized before the Router call.

## Deployment discovery

Refresh the live Ethereum manifest before preparation and again before execution:

- [Manifest](https://developers.programmable.family/api/v2/manifest)
- [Ethereum Router ABI](https://developers.programmable.family/abis/ethereum/programmable-launch-stamp-router-v1.json)
- [Canonical stamp reference](https://github.com/programmablehq/Developers/blob/main/docs/reference/launch-stamp.md)
- [Terminal integration](https://github.com/programmablehq/Developers/blob/main/docs/guides/terminals-and-scanners.md)

The bundled snapshot is a reference, not a substitute for live discovery. At bundle creation, chain ID is `1`, the Router is `0x8622DD5bAb44185f2A458ac90384Ac99248f8d56`, the Graph Factory is `0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887`, and PoolManager is `0x000000000004444c5dc75cB358380D2e3dE08A90`. Require the manifest runtime hashes, ABI SHA-256, immutable getters and finality boundary to match. The Robinhood tuple is separate.

## Exact inputs the bot must prepare

The bundled Solidity interfaces define the complete tuples. The JSON template lists every input with nulls for values the builder must supply. Amounts and times are decimal strings; hashes and calldata are hex strings.

`StampRequestV1` contains:

- `launchId`: a unique, nonzero bytes32 onchain launch ID.
- `token` and `tokenRuntimeCodeHash`: predicted token address and exact post-initialization runtime keccak256.
- `poolKey`: `currency0`, `currency1`, `fee`, `tickSpacing`, `hooks`. Sort the currencies and bind the hook to the graph output.
- `hookRuntimeCodeHash`: exact post-initialization hook runtime keccak256.
- `components`: every graph output, each with `resultIndex`, `account`, `runtimeCodeHash`, `kind`, `scope`. Sort components by increasing address. CustomGraph uses exclusive scope `1`. Kind `1` is the token, `2` the hook, `0` another component. Token and hook must be distinct.

`CustomGraphRouteV1` contains `routeNamespace`, `routeNonce`, `topologyHash`, `graphCommitment`, `targets`, `expectedOutputs`, `expectedGraphDeploymentHash`.

Each target contains `targetIdHash`, `applicantSalt`, `deploymentValue`, `initializerValue`, `initCode`, `initializerCalldata`. Each expected output contains `targetIndex`, `targetIdHash`, `account`, `runtimeCodeHash`, following target order. `resultIndex` connects address-sorted components back to these targets. The Router allows at most 16 targets and requires the token and hook among them. Every target needs one matching output and exclusive component.

Graph authorization commits to chain `1`, the bound factory, namespace, nonce, topology, targets, total value, and `authorizedLauncher = canonical Router`. Compute CREATE2 addresses with that factory's effective salt formula. Order constructors by dependency; resolve cycles in initializers. Predict post-initialization runtimes in a fork simulation before binding hashes. The Router source in this bundle is pinned to the manifest artifact commit. These sources are tuple and validation references, not a standalone compilable project.

`LaunchPermitV1` contains `chainId`, `router`, `launchWallet`, `kind`, `routePayloadHash`, `expectedResultHash`, `stampRequestHash`, `nonce`, `validAfter`, `deadline`, `value`.

Use CustomGraph `kind = 1`. Set `routeNonce = permit.nonce`. Send exactly `permit.value` from exactly `permit.launchWallet`. The nonce must be nonzero and unused. The execution validity window cannot exceed one hour. `routePayload` is canonical ABI encoding of the complete route, not JSON or packed encoding. Compute its keccak256, the expected graph-result hash and stamp-request hash from the exact pinned source and ABI hash helpers. Check `permitDigest` on the canonical Router. EIP-712 domain: name `ProgrammableLaunchStampRouter`, version `1`, chain `1`, verifying contract equal to that Router.

Obtain the authority signature for this exact digest. Do not substitute the launch wallet's signature. Fork-simulate the fully authorized transaction before real execution. This bundle contains no signing or broadcasting code.

## Evidence after execution

Preserve chain ID, Router, launch ID, creator wallet, token, hook, PoolManager, PoolId, stamp hash, every component and runtime hash, transaction hash, block number, block hash, transaction index and event log indexes. Launch identity is `(chainId, Router address, launchId)`; token identity is `(chainId, token address)`.

The canonical Router emits:

- `ProgrammableLaunchStampedV1`: indexed launch ID, token, hook; data PoolManager, PoolId, stamp hash.
- `ProgrammableLaunchRouteStampedV1`: indexed launch ID, kind, route payload hash; data expected result hash, permit digest.
- `ProgrammableComponentStampedV1`: indexed launch ID, component, kind; data runtime code hash.

Use the exact topic0 values from the manifest and derive them again from the pinned ABI. Only the canonical Router emitter qualifies. Token/component lookups must agree with `stampProof`; pool lookup and `launchStamp` must agree at the same finalized canonical block. Preserve block hashes and handle reorganizations as the official verifier describes. Ethereum's published policy requires 64 confirmations for explicit block heights; the verifier also supports the finalized checkpoint.

Programmable's Ethereum Custom source scans the canonical Router independently of API submissions. Explore combines those verified identities with the Robinhood catalog. Missing metadata, market data or API registration does not exclude a verified launch. An unusual hook can therefore be indexed once its valid stamp is finalized even when its trading adapter or market enrichment is unavailable.

The website automatically derives a standard ETH/token swap route from a finalized CustomGraph stamp whose pool pairs native ETH with its primary token. No per-coin registration is needed for that route. It supports exact-input swaps with empty hook data and standard token transfers. Each preparation checks the canonical launch, current runtime code, actual wallet balances, approvals and complete swap execution through two independent private RPC providers. Proxy implementation changes are checked again before the wallet opens. Required approvals are limited to the requested token amount; the Permit2 approval also has a bounded expiry.

Hooks that require signed hook data, another quote asset or a different settlement flow need a compatible trading adapter. Their verified launches can still be indexed. A launch stamp establishes origin; it does not establish an economic audit or guarantee that an arbitrary hook can trade through the standard route.

A terminal already following this exact Ethereum stamp contract can recognize the same event and getter evidence. External providers control their own ingestion, labels and timing. Ordinary token/pool discovery alone does not establish that a provider implements the Programmable stamp contract.

## Bundle files

- `programmable-launch-stamp-router-v1.json`: exact Ethereum ABI, SHA-256 checked against the live manifest.
- `ethereum-stamp-manifest.snapshot.json`: Ethereum binding, topics, getters and finality reference.
- `IProgrammableLaunchStampRouterV1.sol`, `IProgrammableCreate2GraphDeployerV1.sol`: exact tuple definitions.
- `ProgrammableLaunchStampRouterV1.sol`: manifest-pinned source with envelope and component checks.
- `direct-launch-request.template.json`: intentionally incomplete preparation template, not executable calldata.
- `examples/verify-launch-stamp.mjs`, `examples/verify-launch-stamp-viem.ts`: official read-only verifiers. Read their exported API; supply a private HTTPS RPC via `PROGRAMMABLE_RPC_URL`, never in a public file.
- `server/keccak.js` and `package.json`: the JSON-RPC verifier dependency and ESM runtime declaration. The JSON-RPC verifier needs Node 22 or newer; the viem example also needs the declared viem package.
- `SHA256SUMS.json`: bundle file hashes.

Give the other chat this directory or ZIP and ask it to prepare the direct CustomGraph route, predicted runtimes and permit envelope before deploying. Obtain valid Programmable authority authorization for that envelope before executing the Router launch.
