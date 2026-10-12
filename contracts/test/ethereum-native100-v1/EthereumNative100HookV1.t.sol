// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { BeforeSwapDelta, toBeforeSwapDelta } from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { EthereumNative100HookV1 } from "../../src/ethereum-native100-v1/EthereumNative100HookV1.sol";
import { EthereumNativeFeeVaultV1 } from "../../src/ethereum-native100-v1/EthereumNativeFeeVaultV1.sol";

interface FeeVaultTestView {
    function claimPlatform() external returns (uint256);
    function claimCreator() external returns (uint256);
    function platformAccrued() external view returns (uint256);
    function creatorAccrued() external view returns (uint256);
}

contract NativeFeeTestModule {
    uint256 public immutable mode;
    uint256 public calls;

    constructor(uint256 mode_) {
        mode = mode_;
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (mode == 3) {
            IPoolManager(0x000000000004444c5dc75cB358380D2e3dE08A90).swap(key, params, "");
        }
        if (mode == 7) calls++;
        uint24 fee = mode == 5 ? uint24(0x400000 | 5000) : mode == 6 ? uint24(0x400000 | 5001) : 0;
        return (this.beforeSwap.selector, mode == 1 ? toBeforeSwapDelta(1, 0) : BeforeSwapDelta.wrap(0), fee);
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        view
        returns (bytes4, int128)
    {
        return (this.afterSwap.selector, mode == 2 ? int128(1) : int128(0));
    }
}

contract MaliciousCreatorRecipient {
    IPoolManager public immutable manager;
    EthereumNativeFeeVaultV1 public vault;
    uint256 public callbacks;
    uint256 public successfulAttacks;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function bind(EthereumNativeFeeVaultV1 vault_) external {
        require(address(vault) == address(0));
        vault = vault_;
    }

    receive() external payable {
        callbacks++;
        (bool platform,) = address(vault).call(abi.encodeCall(vault.claimPlatform, ()));
        (bool creator,) = address(vault).call(abi.encodeCall(vault.claimCreator, ()));
        (bool burn,) = address(manager).call(abi.encodeCall(manager.burn, (address(vault), 0, 1)));
        (bool transfer,) =
            address(manager).call(abi.encodeCall(manager.transferFrom, (address(vault), address(this), 0, 1)));
        successfulAttacks = (platform ? 1 : 0) + (creator ? 1 : 0) + (burn ? 1 : 0) + (transfer ? 1 : 0);
    }
}

/// @dev A local real-core harness: deployCodeTo executes the PoolManager constructor at
/// the required address, including its NoDelegateCall immutable. This is not a live-chain fork.
contract EthereumNative100HookV1Test is Test, IUnlockCallback {
    address internal constant MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant TREASURY = 0xD88539d3c4C460136a733A3Fd60cf6BF269079da;
    uint160 internal constant REQUIRED_FLAGS = 0x20cc;
    uint160 internal constant SQRT_PRICE_ONE = 1 << 96;
    uint256 internal constant DENOMINATOR = 10_000;

    IPoolManager internal manager;
    PoolSwapTest internal alternateRouter;
    PoolModifyLiquidityTest internal liquidityRouter;
    EthereumNative100HookV1 internal hook;
    MockERC20 internal token;
    PoolKey internal market;
    address internal creator;

    function setUp() public {
        vm.chainId(1);
        vm.deal(address(this), 1000 ether);
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), MANAGER);
        manager = IPoolManager(MANAGER);
        alternateRouter = new PoolSwapTest(manager);
        liquidityRouter = new PoolModifyLiquidityTest(manager);
        creator = makeAddr("immutableCreatorRecipient");
        _deployMarket(0, 0, address(0));
    }

    function test_buyExactInputPaysOnePercentWithZeroCreatorFee() public {
        uint256 gross = 0.1 ether;
        BalanceDelta result = _directSwap(true, -int256(gross));
        assertEq(-int256(result.amount0()), int256(gross));
        assertGt(result.amount1(), 0);
        _assertClaimed(_ceil(gross * 100, DENOMINATOR), 0);
    }

    function test_buyExactOutputPaysOnePercentWithZeroCreatorFee() public {
        uint256 tokenOut = 0.01 ether;
        BalanceDelta result = _directSwap(true, int256(tokenOut));
        uint256 gross = uint256(-int256(result.amount0()));
        assertEq(int256(result.amount1()), int256(tokenOut));
        _assertClaimed(_ceil(gross * 100, DENOMINATOR), 0);
    }

    function test_sellExactInputPaysOnePercentWithZeroCreatorFee() public {
        uint256 tokenIn = 0.01 ether;
        BalanceDelta result = _directSwap(false, -int256(tokenIn));
        assertEq(-int256(result.amount1()), int256(tokenIn));
        uint256 accrued = manager.balanceOf(address(hook.feeVault()), 0);
        uint256 gross = uint256(int256(result.amount0())) + accrued;
        _assertClaimed(_ceil(gross * 100, DENOMINATOR), 0);
    }

    function test_sellExactOutputPaysOnePercentAndReturnsExactNetEther() public {
        uint256 net = 0.01 ether;
        BalanceDelta result = _directSwap(false, int256(net));
        uint256 gross = _ceil(net * DENOMINATOR, DENOMINATOR - 100);
        assertEq(int256(result.amount0()), int256(net));
        _assertClaimed(_ceil(gross * 100, DENOMINATOR), 0);
    }

    function test_feeVaultClaimsCannotBeRedirectedOrApprovedByCaller() public {
        _deployMarket(300, 700, address(0));
        _directSwap(true, -int256(0.1 ether));
        address attacker = makeAddr("claimCaller");
        uint256 attackerBefore = attacker.balance;
        vm.startPrank(attacker);
        _assertClaimed(0.001 ether, 0.003 ether);
        vm.stopPrank();
        assertEq(attacker.balance, attackerBefore);
        assertFalse(manager.isOperator(address(hook.feeVault()), attacker));
        assertEq(manager.allowance(address(hook.feeVault()), attacker, 0), 0);
    }

    function test_exactRuntimePermissionsAndFixedBindings() public view {
        assertEq(uint160(address(hook)) & ((1 << 14) - 1), REQUIRED_FLAGS);
        assertEq(hook.CHAIN_ID(), 1);
        assertEq(address(hook.poolManager()), MANAGER);
        assertEq(hook.PLATFORM_FEE_BPS(), 100);
        assertEq(hook.PLATFORM_RECIPIENT(), TREASURY);
        assertEq(hook.feeVault().PLATFORM_RECIPIENT(), TREASURY);
        assertEq(hook.feeVault().kernel(), address(hook));
        assertEq(hook.feeVault().creatorRecipient(), creator);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "only manager");
        (PoolKey memory requested, SwapParams memory params) = abi.decode(data, (PoolKey, SwapParams));
        BalanceDelta delta = manager.swap(requested, params, "");
        _settle(requested.currency0, delta.amount0());
        _settle(requested.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _settle(Currency currency, int128 amount) internal {
        if (amount < 0) {
            uint256 owed = uint256(-int256(amount));
            manager.sync(currency);
            if (Currency.unwrap(currency) == address(0)) {
                manager.settle{ value: owed }();
            } else {
                MockERC20(Currency.unwrap(currency)).transfer(address(manager), owed);
                manager.settle();
            }
        } else if (amount > 0) {
            manager.take(currency, address(this), uint256(int256(amount)));
        }
    }

    function _deployMarket(uint16 buyFee, uint16 sellFee, address module) internal {
        _deployMarketConfigured(buyFee, sellFee, module, 0, 0);
    }

    function _deployMarketConfigured(uint16 buyFee, uint16 sellFee, address module, uint24 lpFee, uint24 cap) internal {
        token = new MockERC20("Robinhood fee test", "RHF", 18);
        token.mint(address(this), 1_000_000 ether);
        EthereumNative100HookV1.PoolConfig memory config = _config(buyFee, sellFee, module, lpFee, cap);
        (, bytes32 salt) = HookMiner.find(
            address(this), REQUIRED_FLAGS, type(EthereumNative100HookV1).creationCode, abi.encode(manager, config)
        );
        hook = new EthereumNative100HookV1{ salt: salt }(manager, config);
        market = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(token)), lpFee, 200, IHooks(address(hook)));
        manager.initialize(market, SQRT_PRICE_ONE);
        token.approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity{ value: 20 ether }(
            market, ModifyLiquidityParams({ tickLower: -200, tickUpper: 200, liquidityDelta: 1000 ether, salt: 0 }), ""
        );
    }

    function _config(uint16 buyFee, uint16 sellFee, address module, uint24 lpFee, uint24 cap)
        internal
        view
        returns (EthereumNative100HookV1.PoolConfig memory)
    {
        return EthereumNative100HookV1.PoolConfig({
            token: address(token),
            lpFee: lpFee,
            tickSpacing: 200,
            initialSqrtPriceX96: SQRT_PRICE_ONE,
            initializer: address(this),
            creatorFeeRecipient: creator,
            creatorBuyFeeBps: buyFee,
            creatorSellFeeBps: sellFee,
            module: module,
            maxModuleLpFeePips: cap
        });
    }

    function _directSwap(bool isBuy, int256 amount) internal returns (BalanceDelta) {
        return abi.decode(manager.unlock(abi.encode(market, _params(isBuy, amount))), (BalanceDelta));
    }

    function _params(bool isBuy, int256 amount) internal pure returns (SwapParams memory) {
        return SwapParams({
            zeroForOne: isBuy,
            amountSpecified: amount,
            sqrtPriceLimitX96: isBuy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }

    function _assertClaimed(uint256 expectedPlatform, uint256 expectedCreator) internal {
        FeeVaultTestView vault = FeeVaultTestView(address(hook.feeVault()));
        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = creator.balance;
        assertEq(vault.platformAccrued(), expectedPlatform);
        assertEq(vault.creatorAccrued(), expectedCreator);
        if (expectedPlatform != 0) assertEq(vault.claimPlatform(), expectedPlatform);
        if (expectedCreator != 0) assertEq(vault.claimCreator(), expectedCreator);
        assertEq(TREASURY.balance - treasuryBefore, expectedPlatform);
        assertEq(creator.balance - creatorBefore, expectedCreator);
        assertEq(manager.balanceOf(address(vault), 0), 0);
    }

    function _ceil(uint256 numerator, uint256 denominator) internal pure returns (uint256) {
        return numerator == 0 ? 0 : (numerator - 1) / denominator + 1;
    }

    receive() external payable { }
}
