// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Pool } from "@uniswap/v4-core/src/libraries/Pool.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";

/// @notice Fixed-supply, one-sided FoundationFactoryV3 range calculation.
/// @dev The launcher validates USD price; CustomAILiquidityVaultV1 owns the position without any removal entrypoint.
library CustomAILiquidityV1 {
    bytes32 internal constant PLAN_ID = keccak256("programmable.custom-ai.foundation-v3-one-sided.v1");

    struct Position {
        int24 lower;
        int24 upper;
        uint128 liquidity;
        uint128 tokenPrincipal;
        uint128 tokenRounding;
    }

    error InvalidPosition();

    function plan(bool token0, int24 initialTick) internal pure returns (Position memory p) {
        int24 minTick = TickMath.minUsableTick(T.TICK_SPACING);
        int24 maxTick = TickMath.maxUsableTick(T.TICK_SPACING);
        if (initialTick % T.TICK_SPACING != 0 || initialTick <= minTick || initialTick >= maxTick) {
            revert InvalidPosition();
        }
        p.lower = token0 ? initialTick : minTick;
        p.upper = token0 ? maxTick : initialTick;
        uint160 lower = TickMath.getSqrtPriceAtTick(p.lower);
        uint160 upper = TickMath.getSqrtPriceAtTick(p.upper);
        p.liquidity = token0
            ? LiquidityAmounts.getLiquidityForAmount0(lower, upper, T.TOKEN_SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount1(lower, upper, T.TOKEN_SUPPLY);
        uint256 debt = token0
            ? SqrtPriceMath.getAmount0Delta(lower, upper, p.liquidity, true)
            : SqrtPriceMath.getAmount1Delta(lower, upper, p.liquidity, true);
        if (
            p.liquidity == 0 || p.liquidity > Pool.tickSpacingToMaxLiquidityPerTick(T.TICK_SPACING) || debt == 0
                || debt > T.TOKEN_SUPPLY
        ) revert InvalidPosition();
        p.tokenPrincipal = uint128(debt);
        p.tokenRounding = uint128(T.TOKEN_SUPPLY - debt);
    }
}
