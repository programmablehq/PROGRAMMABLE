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
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ClausLaunchTokenV1 } from "./ClausLaunchTokenV1.sol";
import { ClausQuoteHookV1 } from "./ClausQuoteHookV1.sol";

interface IClausUsdFeedV1 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @notice Candidate atomic token seed and CLAUS-funded purchase. LP principal has no exit.
/// @dev The approved feed must price official CLAUS in USD. It is consulted only at
///      initialization. No feed, policy, owner or upgrade can gate a later sell here.
contract ClausQuoteInitializerV1 is IUnlockCallback {
    using SafeERC20 for IERC20;
    address public constant QUOTE = 0x1b54E762aa34CF6E28E9C082F2848e28E45DA6b8;
    address public constant MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    uint256 public constant MINIMUM_FDV_USD = 15_000;
    IPoolManager public immutable poolManager;
    address public immutable graphExecutor;
    address public immutable quotePayer;
    address public immutable initialBuyer;
    IClausUsdFeedV1 public immutable usdFeed;
    bytes32 public immutable usdFeedCodeHash;
    uint8 public immutable feedDecimals;
    uint256 public immutable maxFeedAge;
    bool public initialized;
    uint128 public lockedLiquidity;
    uint256 public openingFdvUsd;
    bytes32 private callback;

    error InvalidConfiguration();
    error Unauthorized();
    error InvalidPrice();
    error InvalidSettlement();
    event LaunchInitialized(
        address indexed token, address indexed hook, address indexed buyer, uint256 fdvUsd, uint256 quoteSpent
    );

    constructor(
        IPoolManager manager,
        address executor,
        address payer,
        address buyer,
        IClausUsdFeedV1 feed,
        bytes32 feedHash,
        uint256 maxAge
    ) {
        if (
            block.chainid != 1 || address(manager) != MANAGER || address(manager).code.length == 0
                || QUOTE.code.length == 0 || executor.code.length == 0 || payer == address(0) || buyer == address(0)
                || address(feed).code.length == 0 || address(feed).codehash != feedHash || maxAge == 0
                || maxAge > 1 days || feed.decimals() > 18
        ) revert InvalidConfiguration();
        poolManager = manager;
        graphExecutor = executor;
        quotePayer = payer;
        initialBuyer = buyer;
        usdFeed = feed;
        usdFeedCodeHash = feedHash;
        feedDecimals = feed.decimals();
        maxFeedAge = maxAge;
    }

    function initialize(
        ClausQuoteHookV1 hook,
        ClausLaunchTokenV1 token,
        int24 startTick,
        uint256 quoteBuyAmount,
        uint256 minimumTokenOutput
    ) external {
        if (msg.sender != graphExecutor || initialized) revert Unauthorized();
        PoolKey memory key = hook.poolKey();
        if (
            hook.initializer() != address(this) || hook.initialBuyer() != initialBuyer
                || address(hook.token()) != address(token) || token.initializer() != address(this)
                || token.poolManager() != address(poolManager) || quoteBuyAmount == 0
                || quoteBuyAmount > uint256(uint128(type(int128).max)) || minimumTokenOutput == 0 || startTick % 60 != 0
                || startTick <= TickMath.minUsableTick(60) || startTick >= TickMath.maxUsableTick(60)
                || address(key.hooks) != address(hook) || key.fee != 0 || key.tickSpacing != 60
        ) revert InvalidConfiguration();
        bool quote0 = QUOTE < address(token);
        if (
            Currency.unwrap(key.currency0) != (quote0 ? QUOTE : address(token))
                || Currency.unwrap(key.currency1) != (quote0 ? address(token) : QUOTE)
        ) revert InvalidConfiguration();
        uint160 price = TickMath.getSqrtPriceAtTick(startTick);
        if (price != hook.initialSqrtPriceX96()) revert InvalidPrice();
        openingFdvUsd = _fdv(token.launchSupply(), price, quote0);
        if (openingFdvUsd < MINIMUM_FDV_USD) revert InvalidPrice();
        initialized = true;
        poolManager.initialize(key, price);
        bytes memory data = abi.encode(key, token, startTick, quoteBuyAmount, minimumTokenOutput, quote0);
        callback = keccak256(data);
        bytes memory result = poolManager.unlock(data);
        if (callback != bytes32(0) || result.length != 0) revert InvalidSettlement();
        emit LaunchInitialized(address(token), address(hook), initialBuyer, openingFdvUsd, quoteBuyAmount);
    }

    function _fdv(uint256 supply, uint160 sqrtPriceX96, bool quote0) private view returns (uint256) {
        if (address(usdFeed).codehash != usdFeedCodeHash) revert InvalidPrice();
        (uint80 round, int256 price,, uint256 updated, uint80 answered) = usdFeed.latestRoundData();
        if (
            round == 0 || price <= 0 || updated == 0 || updated > block.timestamp
                || block.timestamp - updated > maxFeedAge || answered < round
        ) revert InvalidPrice();
        uint256 rawQuote;
        if (sqrtPriceX96 <= type(uint128).max) {
            uint256 ratio = uint256(sqrtPriceX96) * sqrtPriceX96;
            rawQuote = quote0
                ? FullMath.mulDiv(supply, uint256(1) << 192, ratio)
                : FullMath.mulDiv(supply, ratio, uint256(1) << 192);
        } else {
            uint256 ratio = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, uint256(1) << 64);
            rawQuote = quote0
                ? FullMath.mulDiv(supply, uint256(1) << 128, ratio)
                : FullMath.mulDiv(supply, ratio, uint256(1) << 128);
        }
        return FullMath.mulDiv(rawQuote, uint256(price), 1 ether * 10 ** feedDecimals);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || callback == bytes32(0) || keccak256(data) != callback) {
            revert Unauthorized();
        }
        callback = bytes32(0);
        (
            PoolKey memory key,
            ClausLaunchTokenV1 token,
            int24 startTick,
            uint256 quoteAmount,
            uint256 minimumOutput,
            bool quote0
        ) = abi.decode(data, (PoolKey, ClausLaunchTokenV1, int24, uint256, uint256, bool));
        {
            uint256 supply = token.balanceOf(address(this));
            if (supply != token.launchSupply()) revert InvalidConfiguration();
            int24 lower = quote0 ? TickMath.minUsableTick(60) : startTick;
            int24 upper = quote0 ? startTick : TickMath.maxUsableTick(60);
            uint128 liquidity = quote0
                ? LiquidityAmounts.getLiquidityForAmount1(
                    TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), supply
                )
                : LiquidityAmounts.getLiquidityForAmount0(
                    TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), supply
                );
            if (liquidity == 0 || liquidity > uint128(type(int128).max)) revert InvalidSettlement();
            lockedLiquidity = liquidity;
            (BalanceDelta seed,) = poolManager.modifyLiquidity(
                key, ModifyLiquidityParams(lower, upper, int256(uint256(liquidity)), bytes32(0)), ""
            );
            int128 tokenDebt = quote0 ? seed.amount1() : seed.amount0();
            if ((quote0 ? seed.amount0() : seed.amount1()) != 0 || tokenDebt >= 0) revert InvalidSettlement();
            uint256 owed = uint256(-int256(tokenDebt));
            poolManager.sync(Currency.wrap(address(token)));
            IERC20(address(token)).safeTransfer(address(poolManager), owed);
            if (poolManager.settle() != owed) revert InvalidSettlement();
        }
        token.start();
        BalanceDelta buy = poolManager.swap(
            key,
            SwapParams(
                quote0, -int256(quoteAmount), quote0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            ""
        );
        int128 quoteDelta = quote0 ? buy.amount0() : buy.amount1();
        int128 tokenDelta = quote0 ? buy.amount1() : buy.amount0();
        if (
            int256(quoteDelta) != -int256(quoteAmount) || tokenDelta <= 0
                || uint256(uint128(tokenDelta)) < minimumOutput
        ) revert InvalidSettlement();
        poolManager.sync(Currency.wrap(QUOTE));
        uint256 beforeBalance = IERC20(QUOTE).balanceOf(address(poolManager));
        IERC20(QUOTE).safeTransferFrom(quotePayer, address(poolManager), quoteAmount);
        if (
            IERC20(QUOTE).balanceOf(address(poolManager)) - beforeBalance != quoteAmount
                || poolManager.settle() != quoteAmount
        ) revert InvalidSettlement();
        poolManager.take(Currency.wrap(address(token)), initialBuyer, uint256(uint128(tokenDelta)));
        return "";
    }
}
