# Any Quote integration with official Uniswap components

The PositionManager engine is an additive implementation for new reviewed revisions of the pair-fee Any Quote host. It does not replace an existing immutable engine, move an existing position or activate a catalog entry.

## Route discovery and execution

Production readiness defaults to keyless Uniswap V4 pool discovery. The existing bounded PoolManager `Initialize` data adapter verifies candidate records across independent providers. The official Smart Order Router 4.31.10 `computeAllV4Routes` helper enumerates paths through those pools, and the application qualifies them with the official Quoter at a common canonical checkpoint. Fees, minimum output, expiry, infrastructure runtime and complete transaction simulation remain required.

Before an atomic launch, the new token and primary pool do not yet exist. The application appends the exact planned module PoolKey to the qualified external path through the official RoutePlanner and V4Planner SDKs, then simulates the complete host call. Native ETH remains address zero and execution remains Universal Router 2.1.1 at the reviewed deployment address.

Automatic discovery retains its existing direct-pool and one-intermediate search limits, including the WETH-intermediate exclusion. It prefers a qualified direct route before searching an intermediate. Pool data and request budgets limit coverage; missing or incomplete data never establishes token incompatibility. The executable subset remains one unsplit V4 path with a native ETH boundary. Existing explicit candidate routes retain their compiler limit of four external hops; this change does not establish automatic three- or four-hop discovery, support for mixed protocols, wrapping, or arbitrary future hooks.

The server can explicitly select the optional hosted provider with `routeDiscovery: "uniswap-trading-api"` and a server-only `apiKey` dependency. Default preparation uses `routeDiscovery: "pool-index"` and does not read a Trading API key from the environment. Public request bodies cannot select providers. A configured provider's failure never selects the other provider. Hosted responses still require independent pool/quote validation; custom candidate envelopes are accepted only from the explicitly injected server adapter. Never include a hosted key in a browser bundle, source packet, quote response or diagnostic artifact.

Only SOR's standalone V4 path helper is used, not `AlphaRouter`. Its published helper and formatter consult an internal ETH/WETH placeholder map that omits chain 4663. A documented 4663 entry supplies that internal metadata; it is never added to candidate pools. Every returned pool must belong to the verified input set and have positive tick spacing. The dependency override and explicit CommonJS SDK imports keep the helper and adapter on the same `Pool` class. SDK pool objects model topology only: onchain Quoter results supply amounts, including hook behavior. Provider outages remain inconclusive; only independently agreed execution reverts and measured non-executable pools may be discarded.

## Permanent PositionManager custody

`AnyQuotePositionManagerLPModuleV1` keeps the existing host constructor and eight-word configuration ABI. The module initializes its registered pool directly in the official PoolManager, because the existing hook authorizes the engine as initializer. It then uses official PositionManager `MINT_POSITION` and `SETTLE_PAIR` actions to create one LP NFT in the engine's custody.

The pool starts with the launch's primary inventory and exactly zero pair tokens. Official liquidity and square-root-price math bound the mint to its exact primary debt. The engine checks the resulting NFT owner, PoolKey, ticks, liquidity, token settlement and protected rounding dust. It exposes no NFT transfer, NFT approval, withdrawal, generic-call, signature-validation, administrator or upgrade operation.

The optional host-prefunded buy/sell adapter also executes through the official Universal Router. Its calldata uses the official 2.1.1 `IV4Router` parameter types and `Commands`/`Actions`. A nonzero legacy `sqrtPriceLimitX96` is rejected rather than interpreted as Uniswap's different per-hop minimum-price field. Direct external router trades still use the shared hook without a privileged sender requirement.

Canonical UERC20 has a built-in infinite token allowance to Permit2. The engine preserves that token behavior and grants only the exact Permit2 spender amount for the current transaction timestamp, then revokes it. For an ordinary ERC20, a token allowance created by this operation is also revoked. Existing singleton balances and engine donations cannot count as this operation's funding or minimum output.

The fee hook and ledger retain fixed 30bps platform fees and independently selected whole-percent creator fees from 0 through 10%, paid in the chosen pair ERC20. This change introduces no fee conversion swap, replacement AMM or LP exit.

## Versioned source and proof

The existing periphery dependency stays at `ad04c9f24a170accf5ea1b2836bbafd514537ca6`. The additional Universal Router 2.1.1 source is pinned at `999d561c3ad58fb5cab91b602911f3c75591a9c7`; its version-specific periphery interfaces are pinned separately at `3231810e39b8c4d569b9d66907fa4ef8cd2cec22`. These are interface/source dependencies; deployed singleton authority remains the exact chain-4663 runtime pins.

The new resource commitment includes custody schema, official PositionManager address, NFT ID, pool ID, tick range, locked liquidity, dust and quote decimals. The source verifier selects this adapter from the authenticated reviewed artifact, after complete compiler-input, runtime, constructor and launch binding. It independently checks canonical PositionManager and Permit2 code, NFT ownership, pool/ticks/liquidity, zero scoped allowance, and the NFT mint and core ModifyLiquidity events in the launch receipt. Existing engines retain their original resource commitment.

Prepare the engine through the existing generic source-submission flow with source path `src/module-engine/any-quote/AnyQuotePositionManagerLPModuleV1.sol`, entrypoint `AnyQuotePositionManagerLPModuleV1`, a new package version and its complete hashed source closure. The existing foundation preparation builds the host infrastructure and retains its historical engine hint; it does not compile or choose this per-launch engine. Admission of the new reviewed revision can use the existing family without replacing a previous revision.

Local tests and fork execution are not protected review approval, deployment, finality or public availability. Promotion requires a reviewed source artifact and revision, supported review/execution environment, source publication, lifecycle evidence and functioning configured route discovery. Contract review and publication do not depend on a hosted Trading API credential. The previous LP position cannot be converted by changing these files.

The separate backend implements the additive `robinhood-any-quote.position-manager.v1` environment, bound here to owned-source digest `0xc09fe0a0f5c9d816f9cbb7104ab5f9f3d76edaa9e5bf66cd36bc3b5234f0839d`. It installs canonical PositionManager, Permit2 and Universal Router code in fresh isolated state and executes a pinned PM constructor witness to establish all persistent constructor slots. Its result must contain both the original quote checks and the new custody/periphery checks; source reconstruction adds the new import aliases only for this environment. Existing environment identities and host infrastructure remain unchanged. The backend must complete its protected real-Docker lane and release process before the new revision can be reviewed in production.

Uniswap Labs hook-routing eligibility and GMGN's missing atomic-launch trade are separate integration questions. A PositionManager NFT or a successful fork test does not establish either outcome.

Primary references: [PositionManager](https://developers.uniswap.org/docs/protocols/v4/guides/position-manager), [supported chains](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains), [quote API](https://developers.uniswap.org/docs/api-reference/aggregator_quote), [official deployments](https://developers.uniswap.org/deployments.json).
