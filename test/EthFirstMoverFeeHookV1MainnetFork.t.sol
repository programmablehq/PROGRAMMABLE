// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";
import { Test } from "forge-std/Test.sol";

import { EthFirstMoverFeeHookFactoryV1 } from "../src/EthFirstMoverFeeHookFactoryV1.sol";
import { EthFirstMoverFeeHookV1 } from "../src/EthFirstMoverFeeHookV1.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../src/FeeSplitVaultV1.sol";
import { ClaimState } from "../src/libraries/TickerClaimV1.sol";
import { IClassicFeeHookV3 } from "../src/interfaces/IClassicFeeHookV3.sol";

contract FirstMoverForkToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_, string memory symbol_) MockERC20(symbol_, symbol_, 18) {
        creator = creator_;
    }
}

/// @notice Runs First Mover's full registry lifecycle against the real, currently-deployed Ethereum mainnet
///         `PoolManager`.
/// @dev Same scoping rationale as Ladder's fork test: First Mover is not wired into MemeLaunchV2's atomic launcher,
///      so this proves the hook, the factory and the ticker registry behave correctly against the real
///      `PoolManager` bytecode -- registration, confirmation by earned volume, and tribute routed to the vault of
///      whichever pool currently and validly holds the claim -- not that First Mover is integrated into infrastructure
///      it does not use. Liquidity and swaps use the same `PoolSwapTest`/`PoolModifyLiquidityTest` routers the rest
///      of the suite uses, deployed fresh against the real, pinned `PoolManager` address.
contract EthFirstMoverFeeHookV1MainnetForkTest is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_639_000;
    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 internal constant POOL_MANAGER_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;

    uint16 internal constant FEE_BPS = 1000;

    IPoolManager internal poolManager;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal modifyLiquidityRouter;

    FeeSplitVaultFactoryV1 internal vaultFactory;
    EthFirstMoverFeeHookFactoryV1 internal hookFactory;
    EthFirstMoverFeeHookV1 internal hook;

    address internal builder;
    address internal alice;
    address internal bob;
    address internal trader;

    uint256 internal saltCounter;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    struct Launch {
        FirstMoverForkToken token;
        PoolKey key;
        bytes32 poolId;
        FeeSplitVaultV1 vault;
    }

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);

        assertEq(POOL_MANAGER.codehash, POOL_MANAGER_CODE_HASH, "pinned PoolManager bytecode has changed");
        poolManager = IPoolManager(POOL_MANAGER);
        swapRouter = new PoolSwapTest(poolManager);
        modifyLiquidityRouter = new PoolModifyLiquidityTest(poolManager);

        builder = makeAddr("forkBuilder");
        alice = makeAddr("forkAlice");
        bob = makeAddr("forkBob");
        trader = makeAddr("forkTrader");
        vm.deal(address(this), 1000 ether);
        vm.deal(trader, 200 ether);
        vm.roll(1_000_000);

        vaultFactory = new FeeSplitVaultFactoryV1();
        hookFactory = new EthFirstMoverFeeHookFactoryV1();

        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            flags,
            type(EthFirstMoverFeeHookV1).creationCode,
            abi.encode(poolManager, builder, vaultFactory)
        );
        hook = hookFactory.deploy(hookSalt, poolManager, builder, vaultFactory);

        // receive() so PoolManager's excess-ETH refund on liquidity provisioning does not revert.
    }

    receive() external payable { }

    /// @dev Registration, provisional claiming, confirmation by earned volume, and a derivative's tribute routed to
    ///      the confirmed original's vault, all against the real mainnet PoolManager.
    function test_fullLifecycleAgainstTheRealPoolManager() public {
        Launch memory original = _launch("PEPE");

        (bytes32 holder,, bool confirmed, ClaimState state) = hook.tickerDisclosure(hook.symbolHashOf("PEPE"));
        assertEq(holder, original.poolId);
        assertFalse(confirmed);
        assertTrue(state == ClaimState.Provisional);

        _buy(original, 5 ether);
        assertTrue(hook.isOriginal(original.poolId), "enough volume against the real PoolManager confirms the claim");

        Launch memory copycat = _launch("PEPE");
        (bytes32 originalPoolId, bool tributeActive) = hook.derivativeOf(copycat.poolId);
        assertEq(originalPoolId, original.poolId);
        assertTrue(tributeActive);

        uint256 originalCreatorFeesBefore = _creatorAccrued(original.poolId);
        _buy(copycat, 2 ether);
        assertGt(
            _creatorAccrued(original.poolId), originalCreatorFeesBefore, "tribute reached the original's own vault"
        );

        (,,, ClaimState confirmedState) = hook.tickerDisclosure(hook.symbolHashOf("PEPE"));
        assertTrue(confirmedState == ClaimState.Confirmed);

        vm.prank(builder);
        hook.claimBuilderFees();
        assertGt(builder.balance, 0);

        assertEq(
            poolManager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()),
            hook.totalNativeFeesAccrued(),
            "claim tokens match the accounting"
        );
    }

    function _launch(string memory symbol) private returns (Launch memory launch) {
        FirstMoverForkToken token = new FirstMoverForkToken(address(this), symbol);
        token.mint(address(this), 10_000_000 ether);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);

        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        bytes32 poolId = PoolId.unwrap(key.toId());

        address[] memory beneficiaries = new address[](2);
        beneficiaries[0] = alice;
        beneficiaries[1] = bob;
        uint16[] memory shares = new uint16[](2);
        shares[0] = 6000;
        shares[1] = 4000;
        FeeSplitVaultV1 vault = vaultFactory.deploy(
            bytes32(++saltCounter), IClassicFeeHookV3(address(hook)), poolId, beneficiaries, shares
        );

        hook.registerPool(key, address(vault), FEE_BPS, FEE_BPS);
        poolManager.initialize(key, 79_228_162_514_264_337_593_543_950_336);

        modifyLiquidityRouter.modifyLiquidity{ value: 500 ether }(
            key, ModifyLiquidityParams({ tickLower: -60_000, tickUpper: 60_000, liquidityDelta: 20 ether, salt: 0 }), ""
        );

        launch = Launch({ token: token, key: key, poolId: poolId, vault: vault });
    }

    function _buy(Launch memory launch, uint256 ethIn) private {
        vm.prank(trader);
        swapRouter.swap{ value: ethIn }(
            launch.key,
            SwapParams({ zeroForOne: true, amountSpecified: -int256(ethIn), sqrtPriceLimitX96: 4_295_128_740 }),
            settings,
            ""
        );
    }

    function _creatorAccrued(bytes32 poolId) private view returns (uint256 accrued) {
        (,,,,,, accrued,) = hook.poolFeeConfig(poolId);
    }
}
