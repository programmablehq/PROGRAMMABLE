// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ProtectedLaunchTokenV1 } from "./ProtectedLaunchTokenV1.sol";
import { LaunchProtectionModuleV1 } from "./LaunchProtectionModuleV1.sol";

interface IProtectedLaunchHookV1 {
    function poolKey() external view returns (PoolKey memory);
    function initializer() external view returns (address);
    function module() external view returns (address);
    function initialSqrtPriceX96() external view returns (uint160);
}

interface ILaunchUsdFeedV1 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @notice Atomic seed plus capped initial purchase, with an independent USD opening-price check.
/// @dev There is no remove-liquidity, collect-fees, execute, upgrade or owner-withdrawal entry point.
contract ProtectedNativeInitializerV1 is IUnlockCallback {
    using SafeERC20 for IERC20;
    uint256 public constant MINIMUM_FDV_USD = 15_000;
    uint256 public immutable MAX_FEED_AGE;
    address public immutable graphFactory;
    IPoolManager public immutable poolManager;
    ILaunchUsdFeedV1 public immutable nativeUsdFeed;
    bytes32 public immutable feedCodeHash;
    uint8 public immutable feedDecimals;
    bool public initialized;
    uint128 public lockedLiquidity;
    uint256 public openingFdvUsd;
    bytes32 private _callback;

    error InvalidConfiguration();
    error Unauthorized();
    error AlreadyInitialized();
    error InvalidOraclePrice();
    error OpeningValuationTooLow(uint256 actual);
    error InvalidSettlement();
    error InvalidInitialBuy();

    event ProtectedLaunch(
        address indexed token,
        address indexed hook,
        uint256 openingFdvUsd,
        uint128 lockedLiquidity,
        uint256 initialBuyNative,
        uint256 initialBuyTokens
    );

    constructor(IPoolManager manager_, address graphFactory_, ILaunchUsdFeedV1 feed_, bytes32 expectedFeedCodeHash) {
        address canonicalFeed = block.chainid == 1
            ? 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419
            : block.chainid == 4663 ? 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9 : address(0);
        address canonicalManager = block.chainid == 1
            ? 0x000000000004444c5dc75cB358380D2e3dE08A90
            : block.chainid == 4663 ? 0x8366a39CC670B4001A1121B8F6A443A643e40951 : address(0);
        if (
            canonicalFeed == address(0) || address(feed_) != canonicalFeed || address(manager_) != canonicalManager
                || address(manager_).code.length == 0 || graphFactory_ == address(0) || address(feed_).code.length == 0
                || address(feed_).codehash != expectedFeedCodeHash
        ) {
            revert InvalidConfiguration();
        }
        uint8 decimals_ = feed_.decimals();
        if (decimals_ > 18) revert InvalidConfiguration();
        poolManager = manager_;
        // Bound to the published heartbeat of the fixed feed, not an applicant-supplied tolerance.
        MAX_FEED_AGE = block.chainid == 1 ? 1 hours : 24 hours;
        graphFactory = graphFactory_;
        nativeUsdFeed = feed_;
        feedCodeHash = expectedFeedCodeHash;
        feedDecimals = decimals_;
    }

    function initialize(
        IProtectedLaunchHookV1 hook,
        ProtectedLaunchTokenV1 token,
        int24 startTick,
        address buyer,
        uint256 minTokenOut
    ) external payable {
        if (msg.sender != graphFactory) revert Unauthorized();
        if (initialized) revert AlreadyInitialized();
        PoolKey memory key = hook.poolKey();
        LaunchProtectionModuleV1 protection = LaunchProtectionModuleV1(hook.module());
        if (
            hook.initializer() != address(this) || token.initializer() != address(this)
                || token.poolManager() != address(poolManager) || Currency.unwrap(key.currency0) != address(0)
                || Currency.unwrap(key.currency1) != address(token) || address(key.hooks) != address(hook)
                || key.fee != 0 || key.tickSpacing != 60 || protection.kernel() != address(hook)
                || address(protection.token()) != address(token) || protection.developer() != buyer
                || startTick % 60 != 0 || startTick <= TickMath.minUsableTick(60)
                || startTick >= TickMath.maxUsableTick(60)
        ) revert InvalidConfiguration();
        uint160 price = TickMath.getSqrtPriceAtTick(startTick);
        if (hook.initialSqrtPriceX96() != price) revert InvalidConfiguration();
        if (
            msg.value == 0 || msg.value > uint256(uint128(type(int128).max)) || minTokenOut == 0 || buyer == address(0)
                || buyer == address(this) || buyer == address(poolManager)
        ) revert InvalidInitialBuy();
        openingFdvUsd = _openingFdv(token.launchSupply(), price);
        if (openingFdvUsd < MINIMUM_FDV_USD) revert OpeningValuationTooLow(openingFdvUsd);
        initialized = true;
        poolManager.initialize(key, price);
        bytes memory data = abi.encode(key, startTick, token, buyer, minTokenOut, msg.value);
        _callback = keccak256(data);
        poolManager.unlock(data);
        if (_callback != bytes32(0)) revert InvalidSettlement();
    }

    function _openingFdv(uint256 supply, uint160 sqrtPriceX96) private view returns (uint256) {
        if (address(nativeUsdFeed).codehash != feedCodeHash) revert InvalidOraclePrice();
        (uint80 round, int256 answer,, uint256 updated, uint80 answeredRound) = nativeUsdFeed.latestRoundData();
        if (
            answer <= 0 || updated == 0 || updated > block.timestamp || block.timestamp - updated > MAX_FEED_AGE
                || answeredRound < round || round == 0
        ) revert InvalidOraclePrice();
        // Native is currency0 and token is currency1. Round down conservatively before enforcing the floor.
        uint256 nativeValue;
        if (sqrtPriceX96 <= type(uint128).max) {
            nativeValue = FullMath.mulDiv(uint256(1) << 192, supply, uint256(sqrtPriceX96) * sqrtPriceX96);
        } else {
            uint256 ratioX128 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, uint256(1) << 64);
            nativeValue = FullMath.mulDiv(uint256(1) << 128, supply, ratioX128);
        }
        return FullMath.mulDiv(nativeValue, uint256(answer), 1 ether * 10 ** feedDecimals);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || _callback == bytes32(0) || keccak256(data) != _callback) {
            revert Unauthorized();
        }
        _callback = bytes32(0);
        (
            PoolKey memory key,
            int24 upper,
            ProtectedLaunchTokenV1 token,
            address buyer,
            uint256 minOut,
            uint256 nativeIn
        ) = abi.decode(data, (PoolKey, int24, ProtectedLaunchTokenV1, address, uint256, uint256));
        uint256 supply = token.balanceOf(address(this));
        if (supply != token.launchSupply()) revert InvalidConfiguration();
        uint256 liquidity = FullMath.mulDiv(
            supply,
            uint256(1) << 96,
            TickMath.getSqrtPriceAtTick(upper) - TickMath.getSqrtPriceAtTick(TickMath.minUsableTick(60))
        );
        if (liquidity == 0 || liquidity > type(uint128).max) revert InvalidSettlement();
        lockedLiquidity = uint128(liquidity);
        (BalanceDelta seed,) = poolManager.modifyLiquidity(
            key, ModifyLiquidityParams(TickMath.minUsableTick(60), upper, int256(liquidity), bytes32(0)), ""
        );
        if (seed.amount0() != 0 || seed.amount1() >= 0) revert InvalidSettlement();
        uint256 owed = uint256(-int256(seed.amount1()));
        poolManager.sync(key.currency1);
        IERC20(address(token)).safeTransfer(address(poolManager), owed);
        if (poolManager.settle() != owed) revert InvalidSettlement();
        token.start();
        BalanceDelta buy = poolManager.swap(key, SwapParams(true, -int256(nativeIn), TickMath.MIN_SQRT_PRICE + 1), "");
        if (int256(buy.amount0()) != -int256(nativeIn) || buy.amount1() <= 0) revert InvalidSettlement();
        uint256 out = uint256(uint128(buy.amount1()));
        if (out < minOut) revert InvalidInitialBuy();
        if (poolManager.settle{ value: nativeIn }() != nativeIn) revert InvalidSettlement();
        poolManager.take(key.currency1, buyer, out);
        emit ProtectedLaunch(address(token), address(key.hooks), openingFdvUsd, lockedLiquidity, nativeIn, out);
        return "";
    }
}
