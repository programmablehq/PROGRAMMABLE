# Deep V1 deployment readiness

> **Legacy range-based prototype.** This document describes the earlier dynamic-range LiquidityGrowth design and is
> not the current Deep release candidate. The FullRange package supersedes it. See
> [`DEEP-FULL-RANGE-V1-TECHNICAL-REVIEW.md`](./DEEP-FULL-RANGE-V1-TECHNICAL-REVIEW.md) and
> [`../release/DEEP-FULL-RANGE-V1.md`](../release/DEEP-FULL-RANGE-V1.md).

## Conclusion

Deep V1 is not ready for an Ethereum mainnet deployment.

The contracts compile and the local test surface is substantial, but the release still lacks a clean candidate
commit, an exact-policy full-launch mainnet fork, a verified deployment manifest and a resolution for sustained
same-pool price manipulation. The model must remain unavailable in the application until those items are closed.

This document is a deterministic deployment inventory. It does not authorize a deployment and does not replace an
independent security review.

## Deployable components

| Component                               | Deployment                               | Constructor inputs                                                          |
| --------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| `FeeSplitVaultFactoryV1`                | One global `CREATE`                      | None                                                                        |
| `FeeSplitVaultV1`                       | Per token, `CREATE2` through its factory | Hook, pool ID, beneficiaries, shares                                        |
| `LiquidityGrowthFeeOracleHookFactoryV1` | One global `CREATE`                      | None                                                                        |
| `LiquidityGrowthFeeOracleHookV1`        | One global `CREATE2` through its factory | PoolManager, treasury, split-vault factory, maximum tick delta              |
| `LiquidityGrowthRangeSourceFactoryV1`   | One global `CREATE`                      | None                                                                        |
| `LiquidityGrowthRangeSourceV1`          | Per token, `CREATE2` through its factory | PoolManager, PoolKey, oracle hook, TWAP window, range width, spot deviation |
| `LiquidityGrowthVaultFactoryV1`         | One global `CREATE`                      | None                                                                        |
| `LiquidityGrowthVaultV1`                | Per token, `CREATE2` through its factory | Hook, split-vault factory, immutable growth configuration                   |
| `LiquidityGrowthAutomationV1`           | One global `CREATE`                      | Growth-vault factory                                                        |
| `LiquidityGrowthLaunchV1`               | One global `CREATE`                      | Nine addresses listed below                                                 |

The global deployment order is:

1. `FeeSplitVaultFactoryV1`
2. `LiquidityGrowthFeeOracleHookFactoryV1`
3. `LiquidityGrowthRangeSourceFactoryV1`
4. `LiquidityGrowthVaultFactoryV1`
5. Mine and deploy `LiquidityGrowthFeeOracleHookV1`
6. Deploy `LiquidityGrowthAutomationV1`
7. Deploy `LiquidityGrowthLaunchV1`

The launcher's constructor order is:

1. PoolManager
2. PositionManager
3. UERC20Factory
4. Deep fee-oracle hook
5. fee-split vault factory
6. range-source factory
7. growth-vault factory
8. Liquidity Growth automation coordinator
9. locked-position forwarder factory

Its constructor checks the dependency bytecode, the PositionManager-to-PoolManager relationship, the
forwarder-factory-to-PositionManager relationship, the hook's PoolManager, fee, tick spacing and 400-tick oracle cap,
the hook's split-vault factory and the automation coordinator's growth-vault factory.

## Mainnet dependencies

The historical release snapshot is
[`ethereum-mainnet-25612664.json`](../dependencies/historical/ethereum-mainnet-25612664.json). It was taken at block `25,612,664` from the official
Uniswap deployment dataset generated on `2026-07-15T22:25:40.000Z` from commit
`37936185dee7decf681360ec799c124e0e034672`.

Deep's constructor dependencies are:

| Dependency                                              | Ethereum mainnet address                     |
| ------------------------------------------------------- | -------------------------------------------- |
| Uniswap v4 PoolManager                                  | `0x000000000004444c5dc75cB358380D2e3dE08A90` |
| Uniswap v4 PositionManager                              | `0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e` |
| Uniswap UERC20Factory                                   | `0x000000e200088D55C39a11F609E5F667729ad49b` |
| Existing Programmable locked-position forwarder factory | `0x291a9ff1059d225d02B1659430804486404dB507` |

The forwarder factory is reused from
[`mainnet-classic-v2.json`](../deployments/mainnet-classic-v2.json). Its pinned runtime hash is
`0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2`.

The owner-supplied treasury candidate is `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. The final deployment
manifest must record the approved treasury exactly. A different address changes the hook's initcode, CREATE2 address
and source-verification arguments.

StateView, V4Quoter, Permit2 and Universal Router are application dependencies, not Deep constructor inputs. The
official deployment page and unified deployment dataset currently identify different active Universal Router
records. The application must select and pin one supported router version before Deep is enabled.

Immediately before deployment, refresh the
[official deployment dataset](https://developers.uniswap.org/deployments.json), compare the live runtime bytecode
through at least two independent Ethereum RPCs and record the observed block and hashes. A historical snapshot is not
mainnet approval.

## Compiler and dependency pins

Every component currently uses:

- Solidity `0.8.26+commit.8a97fa7a`
- optimizer enabled with 1,000 runs
- Cancun EVM
- `viaIR` disabled
- metadata bytecode hash disabled
- CBOR metadata disabled
- no linked libraries

Pinned dependency commits:

| Dependency                 | Commit                                     |
| -------------------------- | ------------------------------------------ |
| v4-core                    | `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc` |
| v4-periphery               | `ad04c9f24a170accf5ea1b2836bbafd514537ca6` |
| OpenZeppelin Contracts     | `21c8312b022f495ebe3621d5daeed20552b43ff9` |
| OpenZeppelin Uniswap Hooks | `26dc8e53f812a1ca390d470342adb6cd8c3286ad` |
| Uniswap Liquidity Launcher | `e4660afe4f820f4a39181c7ea1f9bce6c423499f` |
| Uniswap UERC20 Factory     | `6f18f1cdf80dc173d33d3cd6bbe91ee52c314f68` |

## Current bytecode margins

These values come from the current local Foundry artifacts. They must be regenerated from a clean release commit.

| Component                               | Initcode bytes | Runtime bytes | EIP-3860 margin | EIP-170 margin |
| --------------------------------------- | -------------: | ------------: | --------------: | -------------: |
| `FeeSplitVaultFactoryV1`                |          7,022 |         6,994 |          42,130 |         17,582 |
| `FeeSplitVaultV1`                       |          4,979 |         3,186 |          44,173 |         21,390 |
| `LiquidityGrowthFeeOracleHookFactoryV1` |         21,124 |        21,096 |          28,028 |          3,480 |
| `LiquidityGrowthFeeOracleHookV1`        |         19,291 |        18,085 |          29,861 |          6,491 |
| `LiquidityGrowthRangeSourceFactoryV1`   |          9,340 |         9,312 |          39,812 |         15,264 |
| `LiquidityGrowthRangeSourceV1`          |          5,886 |         4,203 |          43,266 |         20,373 |
| `LiquidityGrowthVaultFactoryV1`         |         24,066 |        24,038 |          25,086 |        **538** |
| `LiquidityGrowthVaultV1`                |         21,752 |        14,288 |          27,400 |         10,288 |
| `LiquidityGrowthAutomationV1`           |          9,714 |         9,508 |          39,438 |         15,068 |
| `LiquidityGrowthLaunchV1`               |         25,188 |        22,921 |          23,964 |      **1,655** |

`LiquidityGrowthVaultFactoryV1` is deployable under EIP-170 but has only 538 bytes of runtime headroom. The launcher
also has less than 2 KiB of headroom. Any source, compiler or optimizer change requires a new size review.

Run the read-only validator after the final build:

```sh
node contracts/scripts/verify-deep-v1-readiness.mjs
```

It checks compiler settings, constructor ABIs, all artifact source hashes, link references, code-size limits, vendored
dependency commits, the official dependency snapshot, reused forwarder provenance and clean Git state. It does not
connect to an RPC, deploy, sign or broadcast.

## Immutable release policy in the current source

- token supply: 1,000,000,000 tokens with 18 decimals
- minimum creator first buy: 0.0006 ETH
- buy and sell swap fees: independently 1% to 10% in one-percentage-point steps
- Programmable share: fixed 0.10 percentage points of native swap volume
- transfer tax: zero
- v4 LP fee: zero
- tick spacing: 200
- initial tick: 204,200
- oracle window: 30 minutes
- observation cardinality at launch: 2
- permissionless observation growth step: at most 16 slots
- observation cardinality target: 192
- maximum recorded tick movement per observation: 400 ticks
- maximum spot-to-TWAP deviation for compounding: 600 ticks
- active range half-width: 20,000 ticks
- compound cooldown: 5 minutes
- maximum native amount per compound: the smaller of 2.5% of the target and 0.25 ETH
- completion tolerance: the smaller of one basis point of the target and 0.000001 ETH

The current launch contract only enforces a native target large enough to produce a nonzero `target / 40` result and a
token reserve greater than zero and below the total supply. It does not enforce economically meaningful minimum or
maximum targets or reserve ratios. Frontend limits are not sufficient because callers can invoke the launcher
directly.

## Deterministic provenance

### Shared hook

The hook factory must mine a salt for:

```text
keccak256(
  LiquidityGrowthFeeOracleHookV1.creationCode
  ++ abi.encode(PoolManager, treasury, FeeSplitVaultFactoryV1, 400)
)
```

The predicted address must satisfy:

```text
uint160(hook) & 0x3fff == 0x30cc
```

The enabled flags are `beforeInitialize`, `afterInitialize`, `beforeSwap`, `afterSwap`,
`beforeSwapReturnDelta` and `afterSwapReturnDelta`. The manifest must record the factory, salt, initcode hash,
predicted address, deployed address, flag mask and factory `configurationHashOf` value.

### Token

For a user `deployer` and submitted `creatorSalt`:

```text
effectiveGraffiti = keccak256(abi.encode(deployer, creatorSalt))
tokenSalt = keccak256(abi.encode(name, symbol, 18, LiquidityGrowthLaunchV1, effectiveGraffiti))
```

The official UERC20Factory is the CREATE2 deployer. The token's recorded `creator()` is the launcher contract, which
is required because the launcher registers the pool. The user deployer remains committed through
`effectiveGraffiti`, the launch record and every per-token salt.

### Range source

```text
salt = keccak256(
  abi.encode("programmable.liquidity-growth.range-source.v1", token, deployer)
)
```

Its initcode fixes PoolManager, the exact PoolKey, the shared hook, 30 minutes, 20,000 ticks and 600 ticks. Record the
factory address, salt, initcode hash, predicted address, deployed address and both factory and instance configuration
hashes.

### Growth vault and upstream reward vault

```text
growthVaultSalt = keccak256(
  abi.encode("programmable.liquidity-growth.vault.v1", token, deployer)
)
```

The growth-vault initcode fixes the hook, split-vault factory, PoolKey, range source, target, compound limit, reserve,
range width, cooldown and reward split.

Inside the growth-vault constructor:

```text
upstreamSalt = keccak256(
  abi.encode("programmable.liquidity-growth.upstream.v1", growthVault, poolId)
)
```

The upstream `FeeSplitVaultV1` has the growth vault as its sole 100% beneficiary. Record both CREATE2 chains and all
configuration hashes.

### Initial PositionManager recipient

```text
salt = keccak256(
  abi.encode("programmable.liquidity-growth.launch-position.v1", token, deployer)
)
```

The reused factory deploys Uniswap's `PositionFeesForwarder` with the official PositionManager, zero operator,
`type(uint256).max` timelock and the user deployer as fee recipient. Record the predicted and deployed recipient,
factory provenance and PositionManager NFT ID.

The later add-only core positions are not contract deployments. They are keyed by the vault, range and
`keccak256("programmable.liquidity-growth.position.v1")` inside PoolManager. Record each range, salt and resulting
liquidity.

## Source-verification inputs

For every global deployment, preserve:

- fully qualified contract name
- exact standard JSON compiler input and every source file
- compiler version and all settings above
- constructor ABI, decoded arguments and ABI-encoded constructor suffix
- linked libraries, which must remain empty
- creation bytecode hash
- deployed runtime hash after immutable substitution
- deployment transaction hash, sender, nonce, block, receipt status and gas
- Sourcify result and Etherscan verification result

Use these fully qualified names:

```text
src/FeeSplitVaultFactoryV1.sol:FeeSplitVaultFactoryV1
src/FeeSplitVaultV1.sol:FeeSplitVaultV1
src/LiquidityGrowthFeeOracleHookFactoryV1.sol:LiquidityGrowthFeeOracleHookFactoryV1
src/LiquidityGrowthFeeOracleHookV1.sol:LiquidityGrowthFeeOracleHookV1
src/LiquidityGrowthRangeSourceFactoryV1.sol:LiquidityGrowthRangeSourceFactoryV1
src/LiquidityGrowthRangeSourceV1.sol:LiquidityGrowthRangeSourceV1
src/LiquidityGrowthVaultFactoryV1.sol:LiquidityGrowthVaultFactoryV1
src/LiquidityGrowthVaultV1.sol:LiquidityGrowthVaultV1
src/LiquidityGrowthAutomationV1.sol:LiquidityGrowthAutomationV1
src/LiquidityGrowthLaunchV1.sol:LiquidityGrowthLaunchV1
```

Factory verification must include the embedded creation code for the contracts it deploys. The first mainnet canary
must also verify the per-token token, range source, growth vault, upstream split vault and forwarder.

## Required manifest fields

The mainnet manifest must contain:

- schema version, chain ID, model, internal release name and status
- clean release commit and source commitment
- compiler settings and dependency commits
- official dataset URL, generation time and source commit
- observed block plus addresses and live runtime hashes for every official dependency
- deployer, approved treasury, starting nonce and transaction count
- predicted and deployed addresses for all seven global components
- all constructor arguments in decoded and encoded form
- hook factory, salt, initcode hash, required mask and configuration hash
- deployment transaction hashes, blocks, receipts, gas used and total cost
- runtime code hash and EIP-170/EIP-3860 margin for every new component
- Sourcify and Etherscan verification status for every global component
- exact immutable policy values and enforceable economic bounds
- formulas for the token, range source, growth vault, upstream vault and forwarder
- test commands, counts, fork block, dependency hashes, static-analysis output and known limitations
- one canary lifecycle covering launch, buy, sell, oracle maturity, fee processing, compounding and beneficiary claim
- canary token, pool ID, per-token component addresses, position IDs, transaction hashes and accounting deltas
- application allowlist state, with availability disabled until every required field verifies

Deployment status must remain `not-deployed` until receipts and live runtime hashes exist. It must remain
`deployed-not-release-eligible` until source verification and the full canary lifecycle pass.

## Open release blockers

1. **Sustained same-pool manipulation remains unresolved.** A distortion held for the full 30-minute window becomes
   the truncated TWAP and is accepted for compounding. Because the new position is permanent, this can lock growth
   liquidity into a manipulated range. The release needs an independent anchor or another enforceable mitigation, or
   a documented risk acceptance that does not describe the model as manipulation-safe.
2. **The full atomic launcher has not passed a mainnet fork against all official dependencies.** The existing
   `LiquidityGrowthVaultMainnetFork.t.sol` uses the official PoolManager but a local token and test routers, does not
   call `LiquidityGrowthLaunchV1`, and uses 5-minute, 5-tick and 400-tick test values instead of the complete release
   policy.
3. **No Deep mainnet deployment plan or verified manifest exists.** Global CREATE addresses, the hook salt and final
   constructor encodings cannot be fixed until the deployer nonce, treasury and exact release commit are fixed.
4. **Economic bounds are not enforced onchain.** Native target and reserve inputs can be technically valid but
   economically meaningless. Define and enforce the accepted target range and reserve ratio.
5. **Gas evidence is not yet release evidence.** Reproducible local measurements now cover the atomic two-slot launch
   prime, bounded 16-slot growth, direct 192-slot reference and processing paths, but the exact release commit still
   needs the same measurements on the pinned mainnet fork and must fit the chosen block-gas safety budget.
6. **Bytecode headroom is thin.** The growth-vault factory has 538 bytes and the launcher 1,655 bytes below EIP-170.
7. **The release candidate is not clean.** Rebuild after all parallel work is merged, run the static validator, full
   deterministic suite, exact mainnet forks and static analysis, then bind every result to the final commit.
8. **The application integration version is not pinned.** Select the intended Universal Router path, refresh official
   addresses and runtime hashes, and keep Deep fail closed until the verified manifest is registered.

The current local Slither run reported no findings, but tool success is not exhaustive analysis. In particular,
functions for which Slither could not generate IR remain outside that claim.
