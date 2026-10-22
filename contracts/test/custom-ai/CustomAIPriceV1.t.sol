// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CustomAIPriceV1 as P } from "../../src/custom-ai/CustomAIPriceV1.sol";
import { CustomAITypesV1 as T } from "../../src/custom-ai/CustomAITypesV1.sol";

contract PriceHarness {
    function minimum(uint8 decimals, T.Price memory price) external pure returns (uint256) {
        return P.minimumInitialBuy(decimals, price);
    }

    function validate(bool token0, int24 tick, uint8 decimals, T.Price memory price)
        external
        view
        returns (uint256, uint256)
    {
        return P.validate(token0, tick, decimals, price);
    }
}

contract CustomAIPriceV1Test is Test {
    PriceHarness private harness;

    function setUp() public {
        vm.warp(1000);
        harness = new PriceHarness();
    }

    function test_initialBuyMinimumAndQuoteUnitRounding() public view {
        assertEq(harness.minimum(18, T.Price(3000 ether, 3000 ether, 1000, 1120)), 0.01 ether);
        assertEq(harness.minimum(6, T.Price(1 ether, 3000 ether, 1000, 1120)), 30e6);
        assertEq(harness.minimum(6, T.Price(1 ether, 3000 ether + 1, 1000, 1120)), 30e6 + 1);
        assertEq(harness.minimum(0, T.Price(100 ether, 3000 ether, 1000, 1120)), 1);
        assertEq(harness.minimum(36, T.Price(1, 1e36, 1000, 1120)), 1e70);
    }

    function test_invalidEthPricesCannotLowerMinimum() public {
        vm.expectRevert(P.InvalidPrice.selector);
        harness.minimum(18, T.Price(1 ether, 0, 1000, 1120));
        vm.expectRevert(P.InvalidPrice.selector);
        harness.validate(true, -111_060, 18, T.Price(1 ether, 1e36 + 1, 1000, 1120));
    }

    function test_independentDecimalVectorsBothTokenOrders() public view {
        // Independently computed with Python decimal precision=100:
        // 1.0001**tick * 10**(27 - quoteDecimals) * quoteUsd * 10**18.
        _vector(111_060, 18, 1 ether, 15_030_264_788_580_381_397_449, 100);
        _vector(387_360, 6, 1 ether, 15_066_418_770_999_975_199_621, 1e12);
        _vector(-303_420, 36, 1 ether, 15_021_190_214_950_550_605_031, 100);
        _vector(191_100, 18, 3000 ether, 15_071_922_290_253_834_338_812, 3000);
    }

    function _vector(int24 magnitude, uint8 decimals, uint256 price, uint256 expected, uint256 tolerance) private view {
        for (uint256 i; i < 2; ++i) {
            (uint256 lower, uint256 upper) = harness.validate(
                i == 0, i == 0 ? -magnitude : magnitude, decimals, T.Price(price, 3000 ether, 1000, 1120)
            );
            assertApproxEqAbs(lower, expected, tolerance);
            assertApproxEqAbs(upper, expected, tolerance);
            assertLe(lower, upper);
            assertGe(lower, T.START_FDV_USD_E18);
            assertLe(upper, 15_091.5 ether);
        }
    }

    function test_lowerAndNextGridPointsRejected() public {
        T.Price memory price = T.Price(1 ether, 3000 ether, 1000, 1120);
        vm.expectRevert(P.InvalidStartValue.selector);
        harness.validate(true, -111_120, 18, price);
        vm.expectRevert(P.InvalidStartValue.selector);
        harness.validate(true, -111_000, 18, price);
        vm.expectRevert(P.InvalidStartValue.selector);
        harness.validate(false, 111_120, 18, price);
    }

    function test_futureStaleAndOverlongAttestationsRejected() public {
        vm.expectRevert(P.InvalidPrice.selector);
        harness.validate(true, -111_060, 18, T.Price(1 ether, 3000 ether, 1001, 1120));
        vm.expectRevert(P.InvalidPrice.selector);
        harness.validate(true, -111_060, 18, T.Price(1 ether, 3000 ether, 879, 999));
        vm.expectRevert(P.InvalidPrice.selector);
        harness.validate(true, -111_060, 18, T.Price(1 ether, 3000 ether, 1000, 1121));
        vm.expectRevert(P.InvalidPrice.selector);
        harness.validate(true, -111_060, 18, T.Price(0, 3000 ether, 1000, 1120));
    }
}
