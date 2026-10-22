// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { CustomAITypesV1 as T } from "../../src/custom-ai/CustomAITypesV1.sol";
import { CustomAILiquidityV1 as L } from "../../src/custom-ai/CustomAILiquidityV1.sol";

contract LiquidityHarness {
    function plan(bool token0, int24 tick) external pure returns (L.Position memory) {
        return L.plan(token0, tick);
    }
}

contract CustomAILiquidityV1Test is Test {
    LiquidityHarness private planner = new LiquidityHarness();

    function test_invalidTicksDoNotCreatePartialPositions() public {
        vm.expectRevert(L.InvalidPosition.selector);
        planner.plan(true, 1);
        vm.expectRevert(L.InvalidPosition.selector);
        planner.plan(false, TickMath.minUsableTick(60));
        vm.expectRevert(L.InvalidPosition.selector);
        planner.plan(true, TickMath.maxUsableTick(60));
    }

    function testFuzz_startingPositionNeedsOnlyTheNewToken(bool token0, int16 seed) public pure {
        int24 tick = int24(bound(int256(seed), -2000, 2000)) * 60;
        L.Position memory p = L.plan(token0, tick);
        uint160 start = TickMath.getSqrtPriceAtTick(tick);
        uint256 amount0 = SqrtPriceMath.getAmount0Delta(start, TickMath.getSqrtPriceAtTick(p.upper), p.liquidity, false);
        uint256 amount1 = SqrtPriceMath.getAmount1Delta(TickMath.getSqrtPriceAtTick(p.lower), start, p.liquidity, false);
        assertEq(token0 ? amount1 : amount0, 0);
        assertGt(token0 ? amount0 : amount1, 0);
        assertEq(uint256(p.tokenPrincipal) + p.tokenRounding, T.TOKEN_SUPPLY);
        assertLe(token0 ? amount0 : amount1, p.tokenPrincipal);
        assertLe(p.tokenPrincipal - (token0 ? amount0 : amount1), 1);
        assertEq(token0 ? p.lower : p.upper, tick);
        assertEq(token0 ? p.upper : p.lower, token0 ? TickMath.maxUsableTick(60) : TickMath.minUsableTick(60));
    }
}
