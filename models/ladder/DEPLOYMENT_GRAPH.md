# Ladder deployment graph

This binds the full deployment, initialization, pool, liquidity and custody sequence for one Ladder launch to
concrete inputs and postconditions. Every step and value here is exercised, in this exact order, by
`test/EthLadderFeeHookV1MainnetFork.t.sol`, run against the real, currently-deployed Ethereum Mainnet `PoolManager`
at `0x000000000004444c5dc75cB358380D2e3dE08A90` (`test_fullLifecycleAgainstTheRealPoolManager`). The bytecode hash of
that address is asserted at the start of every fork-test run, so the graph below is verified against the actual
deployed contract, not a local copy.

## 1. Hook deployment

**Actor:** anyone (deployment is permissionless; only one canonical instance should exist per builder revision).

**Call:** `EthLadderFeeHookFactoryV1.deploy(salt, poolManager, launcherFeeRecipient, builderFeeRecipient, feeSplitVaultFactory)`

**Inputs in the fork test:**
- `poolManager`: the real Mainnet `PoolManager` above.
- `launcherFeeRecipient`: the Programmable treasury.
- `builderFeeRecipient`: the accepted builder's beneficiary address.
- `feeSplitVaultFactory`: a freshly deployed `FeeSplitVaultFactoryV1` (this factory has no canonical Mainnet
  address yet; it is deployed fresh in the same way `ClassicRewardVaultFactoryV1` is in Classic's own fork test).
- `salt`: mined via `HookMiner.find` against `REQUIRED_HOOK_FLAGS`.

**Postcondition:** a contract exists at the CREATE2-predicted address whose lowest 14 bits equal
`REQUIRED_HOOK_FLAGS` (`beforeInitialize | beforeSwap | afterSwap | beforeSwapReturnDelta | afterSwapReturnDelta`).
`configurationHashOf[deployed]` is set to `keccak256(abi.encode(chainid, factory, deployed, poolManager,
launcherFeeRecipient, builderFeeRecipient, feeSplitVaultFactory))`. A second `deploy` call with the same salt
reverts with `HookAlreadyDeployed`.

## 2. Reward vault deployment

**Call:** `FeeSplitVaultFactoryV1.deploy(salt, hook, poolId, beneficiaries[], sharesBps[])`

**Inputs in the fork test:** two beneficiaries at 6000/4000 bps, `poolId` computed from the `PoolKey` before the pool
is initialized (the vault is bound to a `poolId`, not to an initialized pool).

**Postcondition:** `FeeSplitVaultV1.configurationHash()` is set and recorded in
`FeeSplitVaultFactoryV1.configurationHashOf`; `registerPool` (step 3) checks both match before accepting the vault.

## 3. Pool registration

**Call:** `EthLadderFeeHookV1.registerPool(key, rewardVault, buySwapFeeBps, sellSwapFeeBps, unlockTicks[], dwellBlocks)`

**Inputs in the fork test:** `buySwapFeeBps = 200`, `sellSwapFeeBps = 700`, three descending ticks `[-200, -600,
-1200]`, `dwellBlocks = 7200` (the protocol floor).

**Caller constraint:** must equal `token.creator()`.

**Postconditions:** `poolFeeConfig[poolId].registered == true`; `PoolRegistered`, `PoolFeeDisclosure` and
`LadderDisclosure` are emitted; the ladder's ticks and dwell are stored and cannot be changed by any later call.

## 4. Pool initialization

**Call:** `PoolManager.initialize(key, sqrtPriceX96)` — the real `PoolManager`, not a router.

**Inputs in the fork test:** `sqrtPriceX96 = 79228162514264337593543950336` (price 1:1).

**Postcondition:** `EthLadderFeeHookV1.beforeInitialize` fires, asserts the caller equals the recorded registrar,
and writes the ladder's anchor block via `LadderAnchored`. The anchor equals `block.number` at this exact call and
cannot be written again — `PoolManager` reverts `initialize` on an already-initialized pool.

## 5. Liquidity provisioning

**Call:** `PoolModifyLiquidityTest.modifyLiquidity(key, params, hookData)` against the real `PoolManager`.

**Inputs in the fork test:** `tickLower = -12000`, `tickUpper = 12000`, `liquidityDelta = 20 ether`, funded with
`500 ether` (the excess over what this liquidity actually costs is refunded by `PoolManager`; the test contract
implements `receive()` to accept it).

**Postcondition:** the pool has tradable depth across the full ladder's tick range.

## 6. Custody wallet deployment

**Call:** `ClassicPerformanceUnlockWalletFactoryV1.deployOrGet(salt, token, beneficiary, hook, poolId, launchTimestamp, sharesBps[], expiryDays)`

**Inputs in the fork test:** three shares `[3000, 3000, 4000]` matching the three-tranche ladder, `expiryDays = 180`.

**Postconditions:** the wallet's own bounds check (§ enforced independently of the hook, per the earlier review
item) accepts each share at or above `MIN_TRANCHE_SHARES_BPS` and the expiry inside `[MIN_EXPIRY_DAYS,
MAX_EXPIRY_DAYS]`; `configurationHash` is read back from the deployed wallet, not recomputed, so the factory's
record can never drift from what the wallet itself committed to.

## 7. Trading, breach observation and unlock

Exercised in the fork test via `PoolSwapTest.swap` against the real `PoolManager`: a buy that clears all three
rungs, confirmed by `isTrancheUnlocked` flipping to `true` exactly at `anchorBlock + dwellBlocks` and not one block
before; a sell that pushes the price back under a rung, confirmed by `isTrancheUnlocked` reporting `false` again
even though the rung was held long enough earlier.

## 8. Release and forfeiture

`ClassicPerformanceUnlockWalletV1.release(index)` pays exactly the tranche's share of the custodied balance to the
immutable beneficiary and reverts `TrancheAlreadyReleased` on a repeat call. After `block.timestamp` passes
`launchTimestamp + expiryDays`, `forfeit()` — callable by anyone, proven in the fork test by a call from an address
with no relationship to the launch — sweeps the remaining balance to the fixed burn address
`0x000000000000000000000000000000000000dEaD` and nowhere else.

## What this graph does not yet cover

No step above has a live Ethereum Mainnet deployment; every address, runtime hash and creation hash in
`spec/ladder.json`'s `contracts` array is `null` for that reason, not by omission. Recording them, and pinning the
dependency revisions the same file also currently lists as `null`, are the release gates in `models/ladder/model.json`.
