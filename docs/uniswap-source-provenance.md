# Uniswap source provenance

This document defines the accepted upstream boundary for the Ethereum Mainnet
launch and trading paths in this repository. An upstream component is not an
active product merely because its source, package or deployment is recorded.
Product activation remains controlled by the applicable deployment and release
manifest.

The authoritative machine-readable records are:

- [`contracts/dependencies/source-pins.json`](../contracts/dependencies/source-pins.json)
  for exact Git source revisions
- [`package.json`](../package.json) and
  [`package-lock.json`](../package-lock.json) for exact npm versions and
  tarball integrity
- [`config/uniswap-liquidity-launcher-sdk.v1.json`](../config/uniswap-liquidity-launcher-sdk.v1.json)
  for the reviewed Liquidity Launcher SDK snapshot
- [`contracts/dependencies/ethereum-mainnet.json`](../contracts/dependencies/ethereum-mainnet.json)
  for official Mainnet addresses, source references and runtime code hashes
- [`contracts/deployments/`](../contracts/deployments/) for
  Programmable-specific deployment and activation evidence

Unlisted Uniswap repositories are not production dependencies.

Robinhood Any Quote's additive PositionManager engine and versioned Universal Router
2.1.1 interface dependencies are described in
[`docs/any-quote-uniswap-standard.md`](any-quote-uniswap-standard.md). Their exact
source pins are recorded in the same dependency manifest. This candidate does not
change the active Ethereum components below or activate an Any Quote revision.

## Active official components

| Component and accepted revision | Purpose | License | Deployment or runtime authority | Audit and review scope | Local verification | Upgrade rule |
| --- | --- | --- | --- | --- | --- | --- |
| [`Uniswap/v4-core`](https://github.com/Uniswap/v4-core) `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc` | v4 interfaces, types and libraries compiled into the launch contracts; canonical pool state and settlement | BUSL-1.1 or MIT, selected by each source file's SPDX header | Mainnet `PoolManager` `0x000000000004444c5dc75cB358380D2e3dE08A90`; official source reference `v4-core@1.0.0`; address and runtime hash are pinned in the Mainnet dependency snapshot | The pinned checkout contains final OpenZeppelin and Trail of Bits reports and PDFs explicitly named as drafts from ABDK, Certora and Spearbit in [`docs/security/audits`](../contracts/lib/v4-core/docs/security/audits/). Their scope is upstream v4 core only, not Programmable hooks, parameters or composition. | `npm run contracts:bootstrap`; `npm run contracts:official-deployments`; `npm run contracts:verify:ci` | Change the build pin and runtime reference independently. Review the complete upstream diff, per-file license and report scope; refresh runtime evidence; rerun deterministic, fork and lifecycle checks. |
| [`Uniswap/v4-periphery`](https://github.com/Uniswap/v4-periphery) `ad04c9f24a170accf5ea1b2836bbafd514537ca6` | `IPositionManager`, position actions, `HookMiner`, `StateView` and `V4Quoter` integration | The pinned root `LICENSE` and imported SPDX headers are MIT. The pinned README contains a conflicting GPL-2.0 sentence; redistribution requires resolving that upstream inconsistency rather than relying on this table. | Mainnet `PositionManager` `0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e`, `StateView` `0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227` and `V4Quoter` `0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203`; official deployed source reference `2656054`; runtime hashes are pinned in the Mainnet dependency snapshot | [`audits`](../contracts/lib/v4-periphery/audits/) contains an OpenZeppelin periphery/Universal Router report and ABDK and Spearbit PDFs explicitly named as drafts. This does not cover Programmable contracts or establish that every post-report change in the build pin was reviewed. | `npm run contracts:bootstrap`; `npm run contracts:official-deployments`; `npm run contracts:verify:ci` | Keep the local build pin distinct from the deployed source reference. Any change requires an import-level diff, license resolution, audit-scope mapping, runtime refresh and all position, quote, router and fork tests. |
| [`Uniswap/liquidity-launcher`](https://github.com/Uniswap/liquidity-launcher) `e4660afe4f820f4a39181c7ea1f9bce6c423499f` | `PositionPlanner`, position types and `PositionFeesForwarder` source compiled into Programmable launch contracts | MIT | These primitives are compiled into Programmable deployments. Classic does not call the canonical high-level `LiquidityLauncher` deployment; the official auction stack is recorded separately below. | The checkout is five commits after tag `v3.0.0`. The bundled reports in [`docs/audit`](../contracts/lib/liquidity-launcher/docs/audit/) identify v1 and v2 scopes; they do not establish review coverage for this v3-era pin or the Programmable composition. | `npm run contracts:bootstrap`; `npm run contracts:verify:ci`; `cd contracts && forge test --match-path test/OfficialLaunchPathIntegration.t.sol` | Upgrade only as a source change with bytecode and behavior diffs for planner, custody, timelock, collection and recipient paths. Do not infer v3 coverage from the v1/v2 reports. |
| [`Uniswap/uerc20-factory`](https://github.com/Uniswap/uerc20-factory) `6f18f1cdf80dc173d33d3cd6bbe91ee52c314f68` (`v2.0.0`) | Deterministic fixed-supply token creation and UERC20 metadata encoding | MIT | Mainnet `UERC20Factory` `0x000000e200088D55C39a11F609E5F667729ad49b`, version `2.0`; address and runtime hash are pinned in the Mainnet dependency snapshot | Two OpenZeppelin PDFs are present in [`docs`](../contracts/lib/uerc20-factory/docs/), but the pinned README does not bind those files to `v2.0.0`. They are evidence only for the code and diff stated inside each report, not for the complete launch composition. | `npm run contracts:bootstrap`; `npm run contracts:official-deployments`; `npm run contracts:verify:ci`; the applicable Mainnet lifecycle verifier | Change the tag, source pin, factory address and runtime hash only as one reviewed release. Revalidate deterministic addresses, metadata ABI, supply invariants and the complete launch lifecycle. |
| [`Uniswap/permit2`](https://github.com/Uniswap/permit2) `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219` | Token allowance and router authorization for sells | MIT | Mainnet Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`; runtime hash is pinned in the Mainnet dependency snapshot | The pinned checkout includes ABDK and ChainSecurity reports in [`audits`](../contracts/lib/permit2/audits/). They cover upstream Permit2 within their stated revisions and exclude Programmable approval UX, router calldata and token behavior. | `npm run contracts:bootstrap`; `npm run contracts:official-deployments`; `npx vitest run tests/trade-classic.test.ts` | A source or address change requires allowance-state, expiration, nonce, spender, calldata and end-to-end sell-path review; never substitute an address because it is deployed on another chain. |
| [`Uniswap/universal-router`](https://github.com/Uniswap/universal-router) direct route source reference `d2d9c4a` | Executes Classic v4 swaps and payment commands | GPL-3.0 | The active direct Classic path uses Mainnet router `0xd92A36B0000531EF3063dEd4De20A0783308446C` from the central deployment dataset and pins its runtime hash. | No router audit is claimed for this runtime from the local source pin set. Upstream reports do not replace validation of the exact command stream produced by this application. | `npm run contracts:official-deployments`; `npx vitest run tests/trade-classic.test.ts` | Treat every router address and command version as a separate integration. A change requires an official source/deployment reference, fresh runtime hash, command-parser review, buy/sell tests and fork or lifecycle proof before activation. |
| [`Uniswap/sdks`](https://github.com/Uniswap/sdks) source `57f126ee4ae5d435938569ad22c489e4a0262ca2`: `@uniswap/sdk-core@7.19.0`, `@uniswap/v4-sdk@2.3.1`, `@uniswap/universal-router-sdk@5.11.1`, `@uniswap/liquidity-launcher-sdk@1.0.1` | Currency primitives, v4 action encoding, Universal Router commands, official launcher addresses, canonical pool IDs and lock-recipient creation bytecode | MIT for all four packages | npm tarball integrity is locked in `package-lock.json`. The Launcher SDK's Mainnet addresses, upstream commit, bytecode hashes and pool-ID fixture are additionally pinned in its reviewed config. Packages do not independently establish that a deployed contract is accepted. | No external audit is claimed for these package releases. Tests cover the exact package outputs consumed here; they are integration evidence, not a smart-contract audit. | `npm run verify:uniswap-launcher-sdk`; `npx vitest run tests/trade-classic.test.ts tests/uniswap-liquidity-launcher-sdk.test.ts`; `npm run verify` | Update exact versions, lockfile and reviewed snapshots together. Confirm npm source lineage, inspect generated calldata and bytecode changes, rerun all trade and launch tests, and reject any floating or ranged production dependency. |
| [`Uniswap/blocknumberish`](https://github.com/Uniswap/blocknumberish) `38fe20bc0341d5bc2780d41f90dadb70e10f8cea` (`v1.1.0`) | Block-number abstraction inherited by the Launcher `TimelockedPositionRecipient` used by `PositionFeesForwarder` | MIT | Compiled into the accepted Launcher source path; no independent runtime address | No external audit is claimed for this pin. Its relevant scope is the timelock's block source and chain-specific behavior. | `npm run contracts:bootstrap`; `npm run contracts:verify:ci` | Upgrade only with the Launcher custody path. Recheck permanent-lock behavior and every supported chain's block-number semantics. |

## Official operational interfaces

These interfaces provide bounded analytics, validation or release inputs. A
row explicitly states when an integration is present but not connected to a
production endpoint. None can create a canonical Programmable launch record or
override a release manifest.

| Interface and accepted reference | Purpose | License or terms boundary | Runtime authority and failure mode | Review scope | Local verification | Upgrade rule |
| --- | --- | --- | --- | --- | --- | --- |
| [`Uniswap/v4-subgraph`](https://github.com/Uniswap/v4-subgraph) source `cc055c5ed134d3767d56d520a19a946a97f93179`, Mainnet deployment `QmZsgJLiLQKpb8hxTmQ5LWyrFVvfWzVaL4WK8dfFBn7EeK` | Optional Explore pool analytics for already verified launches | GPL-3.0 for the upstream subgraph source; no upstream source is copied into the application | The Graph gateway endpoint is configurable, but the response must report the accepted deployment, a compatible block and a PoolKey that recomputes to the canonical PoolId. Failure or lag removes analytics without replacing canonical RPC data. | No audit is claimed. The adapter validates a bounded response and treats subgraph data as non-authoritative analytics. The public deployment and corresponding Git source revision are both pinned to the values currently linked by the Uniswap developer documentation and Graph Explorer. | `npx vitest run tests/uniswap-v4-subgraph.test.ts tests/token-detail-api.test.ts` | Change the source, endpoint or deployment identifier only after schema and indexed-entity diff review. Self-hosting requires an exact Git pin and GPL compliance review. |
| [Uniswap Trading API](https://developers.uniswap.org/docs/trading/swapping-api/integration-guide) | Tested server-side quote and buy transaction adapter; not connected to the production trade endpoint | Hosted service terms apply; it is not the source code in `Uniswap/routing-api` | The adapter targets the official repository's v2 router `0x66a9893cc07d91d95644aedd05d03f95e1dba8af`, which is not the central dataset's current generic router record. It requires a server-only API key and revalidates the route, hook, amounts, recipients, commands, value, deadline and calldata. The active endpoint continues to use the direct route. | No service or contract audit is claimed. The local adapter proves only its allowlist, parsing and calldata constraints. | `npx vitest run tests/uniswap-api.test.ts tests/trade-classic.test.ts` | Do not connect it until the provider contract, API version, headers, schemas and selected router have a separate production review. Keep provider routing review separate from Hooklist registration and direct-route runtime evidence. |
| [`Uniswap/token-lists`](https://github.com/Uniswap/token-lists) schema `01705f94a307270b6c0fe5f55c7e66f7b92373cc` | Validates the exported token-list envelope while retaining namespaced Programmable extensions | MIT | Validation-time schema fetched from the exact commit; it has no contract authority | Schema compatibility only; it does not verify, endorse or route a token. | `npm run contracts:token-list:schema` | Pin a new commit only after schema and consumer compatibility review; never fetch `main` in a release gate. |
| [`Uniswap/hooklist`](https://github.com/Uniswap/hooklist) `9ca1f518c02c5057b0ec96195864e40a675320ca` | Shapes local Hooklist and routing-review packets | No license is declared in the repository metadata; no source is embedded in production runtime | Packet preparation only. It does not submit, list, approve or allowlist a hook. See the [hook release workflow](./uniswap-hook-release-workflow.md). | Schema and issue-template compatibility only; not a security review. | `npm run release:uniswap-hook:test` | Refresh the commit and intake schema before a human submission. Hooklist registration and routing approval remain separate external decisions. |

## Third-party source dependencies

| Component and accepted revision | Purpose | License | Runtime boundary | Audit and review scope | Local verification | Upgrade rule |
| --- | --- | --- | --- | --- | --- | --- |
| **Third-party experimental:** [`OpenZeppelin/uniswap-hooks`](https://github.com/OpenZeppelin/uniswap-hooks) `26dc8e53f812a1ca390d470342adb6cd8c3286ad` | `BaseHook`, fee bases, hook events and currency settlement utilities compiled into Programmable hooks | MIT | Source is compiled into Programmable contracts; there is no external OpenZeppelin runtime to trust | The pinned upstream README explicitly labels the library experimental and the current code unaudited. Historical release-candidate PDFs in [`audits`](../contracts/lib/openzeppelin-uniswap-hooks/audits/) do not establish audit coverage for this pin or for Programmable hooks. | `npm run contracts:bootstrap`; `npm run contracts:verify:ci`; `npm run contracts:slither` | Keep the exact pin. Every change requires an import-level diff, independent security review and full hook invariants; an upstream version label alone is not an approval. |
| [`OpenZeppelin/openzeppelin-contracts`](https://github.com/OpenZeppelin/openzeppelin-contracts) `21c8312b022f495ebe3621d5daeed20552b43ff9` | ERC interfaces, safe transfer/cast utilities, CREATE2, clones and transient reentrancy guards | MIT | Selected source is compiled into Programmable contracts | General upstream audits do not cover the selected composition or the Programmable contracts. | `npm run contracts:bootstrap`; `npm run contracts:verify:ci`; `npm run contracts:slither` | Review every imported primitive and storage or bytecode change; update only by exact commit. |
| [`Vectorized/solady`](https://github.com/Vectorized/solady) `33b4b98e350bbcba6aa85642957c313e98b5f911` | Transitive math, token and transient reentrancy utilities used by the accepted Launcher and UERC20 source | MIT | Compiled transitively where imported by accepted upstream source | No blanket audit claim is made for this pin or its use through Launcher/UERC20. | `npm run contracts:bootstrap`; `npm run contracts:verify:ci` | Upgrade only with the direct upstream dependency that imports it and review the resolved import graph. |

`foundry-rs/forge-std` at
`3b20d60d14b343ee4f908cb8079495c07f5e8981` (MIT or Apache-2.0) and
`transmissions11/solmate` at
`4b47a19038b798b4a33d9749d25e570443520647` (AGPL-3.0) are pinned build and
test support. Direct Programmable imports of Solmate are test mocks; neither
repository is a production service or deployment authority.

## Deferred components

| Component | Recorded state | Why it is not active | Review boundary before adoption |
| --- | --- | --- | --- |
| Continuous Clearing Auction and the canonical Liquidity Launcher auction route | [`Uniswap/continuous-clearing-auction`](https://github.com/Uniswap/continuous-clearing-auction) `6c9e559e63a7a141a4fe4bd5aa0f47fee1354b58`; canonical CCA Factory, LiquidityLauncher, LBPStrategy and TokenSplitter addresses and runtime hashes are recorded in the Mainnet dependency snapshot | Classic and Deep do not invoke the canonical auction route. The address records and Launcher SDK adapter are reproducibility and integration inputs, not activation. | CCA reports identify v2.0 scope while the pin is two commits after `v2.1.0`; Launcher reports identify v1/v2 scope while its pin is after `v3.0.0`. Adoption requires exact parameter, fee-controller, failure-recipient, migration, custody, refund, source/runtime and lifecycle review. Focused local evidence: `cd contracts && forge test --match-path test/ContinuousClearingAuctionIntegration.t.sol`. |
| Permissioned Pools | No source pin, package or active route. The separate permissioned Universal Router v2.2 deployment is not the Classic router. | Requires an issuer asset, permissions adapter, checker, permissioned hook/position manager and separate routing approval; it is not a launch toggle. | Add as a separate product only after issuer authority, upgrade/pause rights, asset restrictions, exact `v4-hooks-public` source, deployed runtime and routing-approval review. |
| UniswapX | No dependency, address or transaction path in this repository | It is an intent/order execution system and is unnecessary for the direct v4 launch and trade path. | Adoption requires a separate order, filler, witness, Permit2, settlement, cancellation, fee, chain and failure-mode review. It must not be introduced as a Universal Router upgrade. |

## Upgrade policy

1. Never track `main`, a default branch, `latest` or a semver range for an
   accepted production dependency.
2. Record the exact source revision or npm version and lockfile integrity before
   reviewing behavior.
3. Review the complete upstream diff, license changes, audit-report scope,
   ownership or upgrade controls, deployment status and deprecations.
4. Refresh official addresses from
   `https://developers.uniswap.org/deployments.json`, then capture and verify
   runtime code at an explicit block. A deployment listing is not a runtime
   match.
5. Run the component-specific commands above, the full application and contract
   gates, the relevant Mainnet fork checks and the release-specific lifecycle
   verifier.
6. Update this document and the applicable release manifest in the same change.
   No upstream upgrade activates a product by itself.

Upstream reports, bug bounties and local tests are separate forms of evidence.
None of them is an audit of Programmable's contracts, parameters, deployment or
operational controls.
