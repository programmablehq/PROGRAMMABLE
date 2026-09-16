# Factory V2 local security handoff

## Scope and result

Two new production source files implement permanent DEAD custody of both factory-created LP NFTs and the base-token rounding inventory. There is no new vault, approval/transfer/withdrawal path, custody choice or mutable setting. The official pool keeps positive position liquidity. V1 production source is unchanged.

`FoundationFactoryV2` imports the existing token, hook, deployer, ledger and module ABI. Its launch result and event are versioned separately. The exact generated ABI is `spec/module-foundation/factory-v2.abi.json`; the integration contract is `spec/module-foundation/v2-interface.md`.

The final local EVM run passed **38 tests, zero failures and zero skips**:

- 18 V2 integration tests and one V2 invariant campaign.
- The existing 12 V1 integration tests and one V1 invariant campaign.
- Six existing fee-math tests, including two 1,000-case fuzz campaigns.
- Each invariant campaign executes 32 runs at depth 24: 768 actions, zero reverts.

These checks are local evidence. No public provider, wallet, transaction, deployment, registry, source-verification submission or release action was used.

## Meaningful checks

The tests use canonical official Core, PositionManager, Universal Router 2.1.1 and Permit2 runtime bytecode with all four expected runtime hashes asserted in setup. Quote funding is a standard test ERC20; token, hook, ledger and module instances are created through the real factory/deployer paths. No mock replaces the periphery or settlement path.

V2 checks cover:

- Both token sort orders, optional quote LP absent/present and initial buy absent/present. The eight launches bind exact principal, dust, refunds, registry fields, positive liquidity and owner rights.
- Direct `Transfer(0,DEAD,id)` mint events for both launch NFTs. A separate external control position proves that transferring an NFT to DEAD retains liquidity, while official `BURN_POSITION` deletes that NFT and removes its liquidity.
- Creator, stranger, factory, deployer, hook, ledger and module cannot transfer, approve, permit, increase, decrease, burn or collect zero-delta fees from either launch NFT. The test never impersonates DEAD.
- Same-gross 30-bps platform and 0/1/10% creator fees for all four buy/sell exactness directions, with actual quote payouts and ERC6909 backing.
- Donation-created LP fee growth is inaccessible through the DEAD NFT even though ordinary LP swap fee is fixed at zero. Separate platform/creator hook claims still pay.
- Extra quote liquidity is funded independently of initial buy. Its real construction refund includes any actual voluntary module-factory donation and preserves prior factory quote balances.
- A shared-tick overflow case rejects the sum of two individually valid liquidity amounts before any launch persists.
- Taxed funding, expiry, full-fill failure, malformed module acknowledgments, callback recursion and initial-buy slippage revert. The slippage case rolls back both NFT mints, dust, token/hook creation, funds and registry.
- Stateful modules remain isolated across instances and launches. Their own-budget action-to-UR cycle pays fees; failure rolls its claim back. External permissionless LP remains transferable by its owner.
- One unchanged HookDeployerV1 serves V1 and V2 while binding each hook's actual initializer and CREATE2 prediction independently. V1 retains its vault-owned base NFT.

## Runtime and source binding

Base product commit: `7032036df80a8bc61f45b1629dc351e6ca974e07`. V1 protocol source commit: `df3aa64b49e73924d01b7af59c48196a8c3d6f6a`.

The local compiler is Solidity `0.8.26+commit.8a97fa7a`, with the unchanged committed `module-foundation` profile: optimizer 200, via IR, Cancun, no CBOR metadata and no bytecode metadata hash. Forge is 1.7.1, commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`. Nine dependency pins and clean tracked dependency files are checked before and after replay.

Factory V2 runtime template: **21,968 bytes**. Creation bytecode: **23,292 bytes** before constructor arguments. Both satisfy the EVM size limits; the runtime margin is 2,608 bytes. Runtime-template hashes are not deployed-instance hashes because the factory has bound immutables.

The rebuilt V1 Factory/HookDeployer creation bytecode and runtime templates exactly match the protected original V1 artifact. Token/Hook/Ledger creation bytecode and runtime templates exactly match the source-bound FTST child artifacts. These comparisons establish compatibility for reusing the existing HookDeployer; a genuine V2 review and release binding are still required.

`forge fmt --check src/module-foundation test/module-foundation` and the new-source lint exit successfully. Lint reports four reviewed warnings: deadline comparison with block timestamp, and the bounded dust/debt/Permit2 amount casts. Dust equals `1e27 - base.debt`; position debt is explicitly bounded to `int128.max`; approval amounts are bounded debts or a prevalidated `uint128` initial buy. No warning was suppressed and no common profile was changed.

## Reproduce the exact local replay

From `contracts/`, supply installed binaries and the original, separately retained exported genesis:

```sh
python3 security/module-foundation-v2/run-local-replay.py \
  --genesis "$FOUNDATION_RECORDED_GENESIS" \
  --genesis-sha256 2145d4286df10b9c7086092c8c30e77f39066200514b3f64d5d0860a10135253 \
  --forge "$FOUNDATION_FORGE" \
  --anvil "$FOUNDATION_ANVIL" \
  --solc "$FOUNDATION_SOLC" \
  --output out/module-foundation-v2/new-replay
```

The referenced input is the original `foundation-sdk-evm-proof/input-genesis.json` from the source-bound earlier EVM proof. The helper requires its exact SHA256, refuses an occupied port or an existing output directory, starts a private no-mining Anvil with no accounts and terminates it. The default port is 18549. There is no public fork overlay or target code/storage override. Foundry uses a fresh, explicitly labeled local test executor to avoid CREATE collisions with the original exported test executor.

The original setup failures are retained separately as `out/module-foundation-v2/replay-1`, `replay-2-trace` and `setup-diagnostic`. The last contains the actual `CreateCollision` trace. The corrected first successful snapshot is `replay-3`; `replay-final` adds the stronger two-NFT slippage rollback assertion. The original genesis is unchanged. The before/after local block headers are identical at genesis, with zero persistent transactions. A partial exported genesis is an execution fixture, not a current full production-state or finality proof.

`local-checks.json` binds the final source, ABI, compiler, dependency and bytecode hashes to the exact final log and original genesis. Output logs stay under ignored `contracts/out`; the script never overwrites them.

## Remaining integration and release gates

1. Independent review of the new factory, ABI and actual tests. These local results are not an external audit or source acceptance.
2. Additive SDK/backend V2 admission, event/readback dispatch, source verification and explicit permanent-capital/LP-fee consent. Keep the V1 reader for historical pools.
3. Root's standard protected CI must explicitly include the V2 size target. The current runner's test wildcard already includes the new tests, but its size command names FactoryV1 only; this workstream made no common runner/config change.
4. Genuine new source/artifact acceptance and a FactoryV2 deployment bound to the already verified HookDeployerV1's original receipt/runtime. The V2 scan start is the actual new factory deployment block. No second deployer is technically needed.
5. Fresh actual provider receipt/runtime checks, real future-launch canary, buy/sell and fee-payout evidence, then the authorized default switch.
6. Source visibility and GMGN's actual filter recognition for that real token/pool are separate gates. Direct DEAD custody does not establish a GMGN badge. Later external LP can remain independently withdrawable.
