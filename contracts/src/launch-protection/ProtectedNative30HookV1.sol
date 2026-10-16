// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { LaunchProtectionModuleV1 } from "./LaunchProtectionModuleV1.sol";
import { ProtectedLaunchTokenV1 } from "./ProtectedLaunchTokenV1.sol";
import { EthereumNativeFeeVaultV3 } from "../ethereum-native30-v3/EthereumNativeFeeVaultV3.sol";

/// @notice V2 supports read-only dynamic LP fees and validation, not stateful modules or custom settlement/deltas.
/// @dev Implementations must authenticate this kernel as caller. A module never executes in kernel storage.
interface IProtectedNativeFeeModuleV1 {
    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata data)
        external
        view
        returns (bytes4, BeforeSwapDelta, uint24);
    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata data
    ) external view returns (bytes4, int128);
}

/// @notice Sealed native/token launch kernel with a mandatory immutable protection module and fixed 30-bps fee.
/// @dev V2 accounting profile: fees round UP per trade; total fee rounds once, platform is allocated first.
///      This is not the historical cumulative-floor V2 fee profile. Only the exact bound PoolKey is covered.
///      ETH-specified partial fills revert. Nonzero custom deltas are unsupported, never silently ignored.
///      The shell has no swap, unlock-forwarding, delegatecall, arbitrary-call, or privileged execution path:
///      those paths would bypass callbacks under Uniswap's same-hook-sender exception.
contract ProtectedNative30HookV1 is BaseHook {
    using SafeCast for uint256;
    using SafeCast for int256;
    using LPFeeLibrary for uint24;

    uint256 public immutable CHAIN_ID;
    address public immutable CANONICAL_POOL_MANAGER;
    address public constant PLATFORM_RECIPIENT = 0xD88539d3c4C460136a733A3Fd60cf6BF269079da;
    uint16 public constant PLATFORM_FEE_BPS = 30;
    uint16 public constant FEE_DENOMINATOR = 10_000;
    bytes32 public constant FEE_PROFILE = keccak256("programmable.protected-native-fee.v1.gross-native.ceil-per-trade");

    struct PoolConfig {
        address token;
        uint24 lpFee;
        int24 tickSpacing;
        uint160 initialSqrtPriceX96;
        address initializer;
        address creatorFeeRecipient;
        uint16 creatorBuyFeeBps;
        uint16 creatorSellFeeBps;
        address module;
        uint24 maxModuleLpFeePips;
    }

    address public immutable token;
    uint24 public immutable lpFee;
    int24 public immutable tickSpacing;
    uint160 public immutable initialSqrtPriceX96;
    address public immutable initializer;
    uint16 public immutable creatorBuyFeeBps;
    uint16 public immutable creatorSellFeeBps;
    address public immutable module;
    bytes32 public immutable moduleCodeHash;
    uint24 public immutable maxModuleLpFeePips;
    EthereumNativeFeeVaultV3 public immutable feeVault;
    bool public initialized;
    bool private swapActive;
    bytes32 private activeSwap;
    uint256 private expectedNativePoolAmount;

    error InvalidConfiguration();
    error UnexpectedPool();
    error UnauthorizedInitializer();
    error UninitializedPool();
    error ReentrantSwap();
    error InvalidSwapContext();
    error PartialFillUnsupported(uint256 expected, uint256 actual);
    error UnsupportedCustomDelta();
    error InvalidModuleResponse();
    error ModuleCodeChanged();
    error InvalidDynamicFeeOverride();
    error NoTrade();

    event NativeFeesAccrued(
        bytes32 indexed poolId,
        address indexed sender,
        bool isBuy,
        uint256 grossNative,
        uint256 platformFee,
        uint256 creatorFee
    );

    constructor(
        IPoolManager manager,
        PoolConfig memory config,
        address developer,
        address router,
        bytes32 routerCodeHash,
        address[3] memory exemptWallets
    ) BaseHook(manager) {
        CHAIN_ID = block.chainid;
        CANONICAL_POOL_MANAGER = block.chainid == 1
            ? 0x000000000004444c5dc75cB358380D2e3dE08A90
            : 0x8366a39CC670B4001A1121B8F6A443A643e40951;
        if (
            (block.chainid != 1 && block.chainid != 4663) || address(manager) != CANONICAL_POOL_MANAGER
                || address(manager).code.length == 0 || config.lpFee != 0x800000 || config.tickSpacing != 60
                || config.module != address(0) || config.creatorBuyFeeBps > 1000 || config.creatorSellFeeBps > 1000
                || config.token == address(0) || config.initializer == address(0)
                || config.creatorFeeRecipient == address(0) || config.initialSqrtPriceX96 == 0
                || config.tickSpacing <= 0 || config.maxModuleLpFeePips > LPFeeLibrary.MAX_LP_FEE
                || uint256(config.creatorBuyFeeBps) + PLATFORM_FEE_BPS >= FEE_DENOMINATOR
                || uint256(config.creatorSellFeeBps) + PLATFORM_FEE_BPS >= FEE_DENOMINATOR
        ) revert InvalidConfiguration();
        config.lpFee.getInitialLPFee();
        if (
            ProtectedLaunchTokenV1(config.token).initializer() != config.initializer
                || ProtectedLaunchTokenV1(config.token).poolManager() != address(manager)
        ) {
            revert InvalidConfiguration();
        }
        token = config.token;
        lpFee = config.lpFee;
        tickSpacing = config.tickSpacing;
        initialSqrtPriceX96 = config.initialSqrtPriceX96;
        initializer = config.initializer;
        creatorBuyFeeBps = config.creatorBuyFeeBps;
        creatorSellFeeBps = config.creatorSellFeeBps;
        LaunchProtectionModuleV1 protection = new LaunchProtectionModuleV1(
            address(this),
            ProtectedLaunchTokenV1(config.token),
            developer,
            router,
            routerCodeHash,
            config.creatorBuyFeeBps,
            exemptWallets
        );
        module = address(protection);
        moduleCodeHash = address(protection).codehash;
        maxModuleLpFeePips = 990_000;
        feeVault = new EthereumNativeFeeVaultV3(manager, config.creatorFeeRecipient);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        permissions.beforeInitialize = true;
        permissions.beforeSwap = true;
        permissions.afterSwap = true;
        permissions.beforeSwapReturnDelta = true;
        permissions.afterSwapReturnDelta = true;
    }

    function poolKey() public view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(token), lpFee, tickSpacing, IHooks(address(this)));
    }

    /// @notice Quote gross native trade value and fixed-recipient fee allocations, all denominated in wei.
    /// @dev Gross includes platform and creator hook fees. Core LP fees already affect the core trade price.
    ///      Creator rates cannot reduce platform's independent ceil(gross * 30 / 10000) allocation.
    function quoteFees(uint256 amount, bool amountIsNet, bool isBuy)
        public
        view
        returns (uint256 gross, uint256 platformFee, uint256 creatorFee)
    {
        uint256 totalBps = PLATFORM_FEE_BPS + uint256(isBuy ? creatorBuyFeeBps : creatorSellFeeBps);
        gross =
            amountIsNet ? Math.mulDiv(amount, FEE_DENOMINATOR, FEE_DENOMINATOR - totalBps, Math.Rounding.Ceil) : amount;
        uint256 totalFee =
            amountIsNet ? gross - amount : Math.mulDiv(gross, totalBps, FEE_DENOMINATOR, Math.Rounding.Ceil);
        platformFee = Math.mulDiv(gross, PLATFORM_FEE_BPS, FEE_DENOMINATOR, Math.Rounding.Ceil);
        creatorFee = totalFee - platformFee;
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160 price) internal override returns (bytes4) {
        _requirePool(key);
        if (initialized || sender != initializer || price != initialSqrtPriceX96) revert UnauthorizedInitializer();
        initialized = true;
        return IHooks.beforeInitialize.selector;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata data)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24 overrideFee)
    {
        _requirePool(key);
        if (!initialized) revert UninitializedPool();
        if (swapActive) revert ReentrantSwap();
        if (params.amountSpecified == 0) revert NoTrade();
        swapActive = true;
        activeSwap = keccak256(abi.encode(sender, key, params, data));
        overrideFee = _beforeModule(sender, key, params, data);
        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (!nativeIsSpecified) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, overrideFee);
        uint256 nativeAmount = _absolute(params.amountSpecified);
        (uint256 gross, uint256 platformFee, uint256 creatorFee) =
            quoteFees(nativeAmount, params.amountSpecified > 0, params.zeroForOne);
        uint256 total = platformFee + creatorFee;
        expectedNativePoolAmount = params.amountSpecified > 0 ? gross : nativeAmount - total;
        if (expectedNativePoolAmount == 0) revert NoTrade();
        _accrue(sender, key, params.zeroForOne, gross, platformFee, creatorFee);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(total.toInt256().toInt128(), 0), overrideFee);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata data
    ) internal override returns (bytes4, int128) {
        _requirePool(key);
        if (!swapActive || activeSwap != keccak256(abi.encode(sender, key, params, data))) revert InvalidSwapContext();
        uint256 nativeAmount = _absolute(int256(delta.amount0()));
        if (nativeAmount == 0 || delta.amount1() == 0) revert NoTrade();
        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);
        uint256 total;
        if (nativeIsSpecified) {
            if (nativeAmount != expectedNativePoolAmount) {
                revert PartialFillUnsupported(expectedNativePoolAmount, nativeAmount);
            }
        } else {
            (uint256 gross, uint256 platformFee, uint256 creatorFee) =
                quoteFees(nativeAmount, params.amountSpecified > 0, params.zeroForOne);
            total = platformFee + creatorFee;
            if (params.amountSpecified < 0 && total >= nativeAmount) revert NoTrade();
            _accrue(sender, key, params.zeroForOne, gross, platformFee, creatorFee);
        }
        _afterModule(sender, key, params, delta, data);
        expectedNativePoolAmount = 0;
        activeSwap = bytes32(0);
        swapActive = false;
        return (IHooks.afterSwap.selector, total.toInt256().toInt128());
    }

    function _beforeModule(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata data)
        private
        view
        returns (uint24 overrideFee)
    {
        if (module == address(0)) return 0;
        _requireModuleCode();
        (bytes4 selector, BeforeSwapDelta customDelta, uint24 fee) =
            IProtectedNativeFeeModuleV1(module).beforeSwap(sender, key, params, data);
        if (selector != IProtectedNativeFeeModuleV1.beforeSwap.selector) revert InvalidModuleResponse();
        if (BeforeSwapDelta.unwrap(customDelta) != 0) revert UnsupportedCustomDelta();
        if (fee != 0) {
            if (!lpFee.isDynamicFee() || !fee.isOverride()) revert InvalidDynamicFeeOverride();
            if (fee.removeOverrideFlagAndValidate() > maxModuleLpFeePips) revert InvalidDynamicFeeOverride();
        }
        return fee;
    }

    function _afterModule(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata data
    ) private view {
        if (module == address(0)) return;
        _requireModuleCode();
        (bytes4 selector, int128 customDelta) =
            IProtectedNativeFeeModuleV1(module).afterSwap(sender, key, params, delta, data);
        if (selector != IProtectedNativeFeeModuleV1.afterSwap.selector) revert InvalidModuleResponse();
        if (customDelta != 0) revert UnsupportedCustomDelta();
    }

    function _requireModuleCode() private view {
        if (module.codehash != moduleCodeHash) revert ModuleCodeChanged();
    }

    function _requirePool(PoolKey calldata key) private view {
        if (
            Currency.unwrap(key.currency0) != address(0) || Currency.unwrap(key.currency1) != token || key.fee != lpFee
                || key.tickSpacing != tickSpacing || address(key.hooks) != address(this)
        ) revert UnexpectedPool();
    }

    function _accrue(
        address sender,
        PoolKey calldata key,
        bool isBuy,
        uint256 gross,
        uint256 platformFee,
        uint256 creatorFee
    ) private {
        uint256 total = platformFee + creatorFee;
        total.toInt256().toInt128();
        poolManager.mint(address(feeVault), 0, total);
        feeVault.recordFees(platformFee, creatorFee);
        emit NativeFeesAccrued(keccak256(abi.encode(key)), sender, isBuy, gross, platformFee, creatorFee);
    }

    function _absolute(int256 amount) private pure returns (uint256) {
        if (amount == type(int256).min) revert InvalidConfiguration();
        return uint256(amount < 0 ? -amount : amount);
    }
}
