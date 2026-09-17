# Uniswap deployment binding refresh, 2026-09-17

The current dependency snapshots now select the active LiquidityLauncher 3.2.0
and LBPStrategy 3.3.0 records for Ethereum Mainnet and Sepolia. The previous four
records are marked `deprecated` in the [official deployment registry](https://developers.uniswap.org/deployments.json).
The unchanged official-deployment verifier rejects those deprecated bindings.

## Reviewed runtime identities

| Chain | Contract | Active address | Runtime keccak256 |
| --- | --- | --- | --- |
| Mainnet and Sepolia | LiquidityLauncher 3.2.0 | `0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0` | `0x4a586d925c9d59ece13ce2239ebd7dea9ee725f9d33c6667e0fd16ae8d977d80` |
| Mainnet | LBPStrategy 3.3.0 | `0x2EEF0e2a9a652d755AccAD95a24541A98B5CA000` | `0x8f34f40167b7222c66fa590b1f120bf37d6ee984fcf2f6710b989b7dce0d16d8` |
| Sepolia | LBPStrategy 3.3.0 | `0x95434E898Af471945Cab33D5064d2aC1A6Ba2000` | `0x077959d7cd725a2ec1c0e73acd47b38d5227a1a22e75a83d4dbf7905d7fff02f` |

All 24 dependency runtimes were read at finalized snapshots through PublicNode
and Tenderly. Each provider agreed on code bytes and the closing block hash.
The other 20 contract addresses and runtime hashes are unchanged.

- Mainnet: block `25,996,020`, hash
  `0xb8e83f7808283408eded9fed383abbddde9dfeb58344cf5f0f7398b7320a9808`.
- Sepolia: block `11,722,565`, hash
  `0x1fe0861c9e1c435a83076ff2c84ef8e363d28307bbff21f688179c0ae4835103`.
- Registry SHA-256:
  `5a16ef209f9e2583b934ea5eddc9cd2588a6caf5d53f4797ab67d059b1b71dbc`.
  Its timestamp and source commit stayed unchanged despite the changed records;
  per-record validation remains required.

### Source reconstruction

The LiquidityLauncher [v3.2.0 tag](https://github.com/Uniswap/liquidity-launcher/tree/41442a518de9aa2a60ce5db76046dc4c983dd35a)
resolves to `41442a518de9aa2a60ce5db76046dc4c983dd35a`.
The registry links LBPStrategy 3.3.0 to
[`1c5904912aefceaceb89c24528cd5e25d0b61597`](https://github.com/Uniswap/liquidity-launcher/blob/1c5904912aefceaceb89c24528cd5e25d0b61597/src/strategies/lbp/LBPStrategy.sol).

The 25-source LiquidityLauncher closure and each 82-source LBPStrategy closure
were compared byte for byte with those Git objects and their exact dependency
gitlinks. Recompiling with Solidity `0.8.26+commit.8a97fa7a`, optimizer 200,
Cancun, no IR, `bytecodeHash: none`, and CBOR enabled reproduces the complete
creation bytecode including constructor arguments. Binding AST-identified
immutables reproduces the complete onchain runtime, including metadata bytes.

The bindings are Permit2 for LiquidityLauncher, and PositionManager,
PoolManager, initializer factory, and the false ArbSys override for
LBPStrategy. The false override follows from empty code at address `0x64` on
both chains; the three address getters were checked against both providers.
The initializer factory remains the current CCA factory, whose fee controller
is zero at both snapshots.

The [Mainnet launcher](https://eth.blockscout.com/address/0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0?tab=contract),
[Mainnet strategy](https://eth.blockscout.com/address/0x2EEF0e2a9a652d755AccAD95a24541A98B5CA000?tab=contract),
and [Sepolia strategy](https://eth-sepolia.blockscout.com/address/0x95434E898Af471945Cab33D5064d2aC1A6Ba2000?tab=contract)
publish partial verification matches. The byte-for-byte reconstruction above
is independent evidence; it does not change those explorer statuses.

## Compatibility and retained boundaries

LiquidityLauncher retains the existing create, deposit, distribution, Permit2,
graffiti and multicall selectors. The entrypoints become payable and add
`distributeWithNative`; native distribution is not enabled by this refresh.
The existing token `Distribution` structure and pull/allowance-consumption
behavior remain unchanged.

LBPStrategy retains its migrator and position parameter encoding and the three
constructor dependencies. Relative to the previous deployed source, it rejects
migration while PoolManager is already unlocked and attempts a fee-controller
update after pool initialization. A failed fee update does not prevent
migration. No existing launch route is switched to this upstream strategy.

`source-pins.json` and `bootstrap-deps.sh` continue to pin the library revision
used to compile existing Programmable contracts. Newer upstream releases
remove `PositionFeesForwarder`, which existing immutable contracts and source
verification still require. Current deployed singleton identities and local
contract compilation dependencies serve different purposes.

The installed `@uniswap/liquidity-launcher-sdk@1.0.1`, its integrity lock, and
`config/uniswap-liquidity-launcher-sdk.v1.json` remain an exact package
compatibility boundary. The exported `getOfficialLauncherDependencies`
helper reports that pinned package's historical addresses. Its only callers
are the SDK verification module and its tests; that module has no application
or transaction-preparation caller. The SDK fixture is not a current-address
registry. Future callers must use the reviewed current network bindings.

## Fork and preflight coverage

The original Mainnet and Sepolia snapshot test classes retain their historical
block numbers, addresses, runtime hashes and configuration assertions.
Additional current classes in the same CI-selected files check every entry in
the refreshed JSON snapshots and the launcher's and strategy's dependencies.
The fork runner and official-deployment verifier are unchanged.

`DeploySepoliaInfrastructureV1.validateDependencies()` now checks the two
current Sepolia addresses and hashes. Its simulation uses block `11,722,565`
and the actual account nonce `53`. The expected future CREATE addresses were
derived from that nonce and independently checked vacant by both RPCs. The
direct launcher's expected runtime was rebuilt with its exact constructor
bindings. These addresses are simulation expectations, not new deployments.

The retained deployed Sepolia infrastructure remains covered at its original
block by `EthereumSepoliaDeploymentSnapshotTest`. Existing historical release
manifests and receipts are unchanged; operations requiring those exact release
files must continue to use their reviewed historical checkout.

The focused fork run passes 13 tests with no failures or skips, including
mutation checks proving that altered current launcher or strategy code is
rejected by the preflight. The complete unchanged fork runner passes 157 tests
across six Mainnet and Sepolia groups, with no failures or skips; the focused
13 tests are included in that total. Both networks pass the first configured
public provider. The unchanged official-deployment verifier passes
24 active registry entries, six canonical live Mainnet hashes and five clean
reviewed dependency checkouts. Its upstream-source drift warnings remain
visible and do not silently update any dependency.

This is a tested dependency snapshot refresh. It does not deploy contracts,
activate a product release or establish the GMGN status of a Modulecoin.
