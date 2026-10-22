// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CustomAITypesV1 as T } from "../../src/custom-ai/CustomAITypesV1.sol";
import { CustomAIFeeMathV1 as F } from "../../src/custom-ai/CustomAIFeeMathV1.sol";

contract FeeMathHarness {
    function gross(uint256 value, uint16 bps) external pure returns (F.Fees memory) {
        return F.fromGross(value, bps);
    }

    function net(uint256 value, uint16 bps) external pure returns (uint256, F.Fees memory) {
        return F.fromNet(value, bps);
    }
}

contract CustomAIFeeMathV1Test is Test {
    FeeMathHarness private math = new FeeMathHarness();

    function test_maximumIncludesPlatformAndLeavesEightyFivePercent() public pure {
        F.Fees memory fees = F.fromGross(10_000, 1450);
        assertEq(fees.platform, 50);
        assertEq(fees.additional, 1450);
        assertEq(fees.net, 8500);
    }

    function test_baseFeeSurvivesWithoutAnAdditionalFee() public pure {
        F.Fees memory fees = F.fromGross(10_000, 0);
        assertEq(fees.platform, 50);
        assertEq(fees.additional, 0);
        assertEq(fees.net, 9950);
    }

    function test_dustNeverInheritsAnotherTradesRoundingDebt() public pure {
        F.fromGross(199, 1450);
        F.Fees memory dust = F.fromGross(1, 1450);
        assertEq(dust.net, 1);
        assertEq(dust.platform + dust.additional, 0);
    }

    function test_invalidFeeAmountAndGrossUpAreRejected() public {
        vm.expectRevert(F.FeeCapExceeded.selector);
        math.gross(10_000, 1451);
        vm.expectRevert(F.InvalidAmount.selector);
        math.gross(0, 0);
        vm.expectRevert(F.InvalidAmount.selector);
        math.gross(T.MAX_AMOUNT + 1, 0);
        vm.expectRevert(F.InvalidAmount.selector);
        math.net(T.MAX_AMOUNT, 1450);
    }

    function testFuzz_grossConservesValueAndNeverExceedsAdvertisedCap(uint128 value, uint16 bps) public pure {
        uint256 gross = bound(value, 1, T.MAX_AMOUNT);
        bps = uint16(bound(bps, 0, 1450));
        F.Fees memory fees = F.fromGross(gross, bps);
        uint256 total = fees.platform + fees.additional;
        assertEq(total + fees.net, gross);
        assertGt(fees.net, 0);
        assertLe(total * 10_000, gross * (50 + uint256(bps)));
        assertLe(total * 10_000, gross * 1500);
        assertLe(fees.platform * 10_000, gross * 50);
        assertLt(gross * 50 - fees.platform * 10_000, 10_000);
    }

    function testFuzz_exactOutputUsesTheSmallestGross(uint128 value, uint16 bps) public pure {
        uint256 net = bound(value, 1, T.MAX_AMOUNT * 85 / 100);
        bps = uint16(bound(bps, 0, 1450));
        (uint256 gross, F.Fees memory fees) = F.fromNet(net, bps);
        assertEq(fees.net, net);
        assertEq(gross, net + fees.platform + fees.additional);
        if (gross > 1) assertLt(F.fromGross(gross - 1, bps).net, net);
    }
}
