// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";

/// @notice Conservative USD valuation of the fixed supply at the actual initial pool tick.
library CustomAIPriceV1 {
    uint64 internal constant MAX_AGE = 120;
    uint256 internal constant MAX_START_USD_E18 = T.START_FDV_USD_E18 * 10_061 / 10_000;
    error InvalidPrice();
    error InvalidStartValue();

    /// @notice Gross quote input worth at least 0.01 ETH, rounded up to a whole quote unit.
    function minimumInitialBuy(uint8 decimals, T.Price memory price) internal pure returns (uint256) {
        if (
            decimals > 36 || price.quoteUsdE18 == 0 || price.quoteUsdE18 > 1e36 || price.ethUsdE18 == 0
                || price.ethUsdE18 > 1e36
        ) revert InvalidPrice();
        return FullMath.mulDivRoundingUp(
            T.MIN_INITIAL_BUY_ETH * price.ethUsdE18, 10 ** uint256(decimals), price.quoteUsdE18 * 1 ether
        );
    }

    function validate(bool token0, int24 tick, uint8 decimals, T.Price memory price)
        internal
        view
        returns (uint256 lower, uint256 upper)
    {
        if (
            price.quoteUsdE18 == 0 || price.quoteUsdE18 > 1e36 || price.ethUsdE18 == 0 || price.ethUsdE18 > 1e36
                || decimals > 36 || price.observedAt > block.timestamp || block.timestamp - price.observedAt > MAX_AGE
                || price.validUntil < block.timestamp || price.validUntil < price.observedAt
                || uint256(price.validUntil) > uint256(price.observedAt) + MAX_AGE
        ) revert InvalidPrice();
        if (
            tick % T.TICK_SPACING != 0 || tick <= TickMath.minUsableTick(T.TICK_SPACING)
                || tick >= TickMath.maxUsableTick(T.TICK_SPACING)
        ) revert InvalidStartValue();
        (lower, upper) = bounds(token0, tick, decimals, price.quoteUsdE18);
        // 60-tick granularity: choose the first grid point conservatively at/above $15k, at most +0.61%.
        if (lower < T.START_FDV_USD_E18 || upper > MAX_START_USD_E18) revert InvalidStartValue();
        (uint256 prior,) =
            bounds(token0, token0 ? tick - T.TICK_SPACING : tick + T.TICK_SPACING, decimals, price.quoteUsdE18);
        if (prior >= T.START_FDV_USD_E18) revert InvalidStartValue();
    }

    function bounds(bool token0, int24 tick, uint8 decimals, uint256 quoteUsdE18)
        internal
        pure
        returns (uint256 lower, uint256 upper)
    {
        uint160 sqrt = TickMath.getSqrtPriceAtTick(tick);
        uint256 quoteAmount;
        uint256 quoteUpper;
        if (sqrt <= type(uint128).max) {
            uint256 ratio = uint256(sqrt) * sqrt;
            quoteAmount = token0
                ? FullMath.mulDiv(ratio, T.TOKEN_SUPPLY, 1 << 192)
                : FullMath.mulDiv(1 << 192, T.TOKEN_SUPPLY, ratio);
            quoteUpper = token0
                ? FullMath.mulDivRoundingUp(ratio, T.TOKEN_SUPPLY, 1 << 192)
                : FullMath.mulDivRoundingUp(1 << 192, T.TOKEN_SUPPLY, ratio);
        } else {
            // The Q128 ratio is rounded down. Bound the inverse in the conservative direction.
            uint256 ratio = FullMath.mulDiv(sqrt, sqrt, 1 << 64);
            quoteAmount = token0
                ? FullMath.mulDiv(ratio, T.TOKEN_SUPPLY, 1 << 128)
                : FullMath.mulDiv(1 << 128, T.TOKEN_SUPPLY, ratio + 1);
            quoteUpper = token0
                ? FullMath.mulDivRoundingUp(ratio + 1, T.TOKEN_SUPPLY, 1 << 128)
                : FullMath.mulDivRoundingUp(1 << 128, T.TOKEN_SUPPLY, ratio);
        }
        uint256 scale = 10 ** uint256(decimals);
        lower = FullMath.mulDiv(quoteAmount, quoteUsdE18, scale);
        upper = FullMath.mulDivRoundingUp(quoteUpper, quoteUsdE18, scale);
    }
}
