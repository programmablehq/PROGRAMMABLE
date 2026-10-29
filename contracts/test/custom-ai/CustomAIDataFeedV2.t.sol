// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import { Test } from "forge-std/Test.sol";
import { CustomAIDataFeedV2 } from "../../src/custom-ai/CustomAIDataFeedV2.sol";

contract CustomAIDataFeedV2Test is Test {
    uint256 constant KEY = 0x12345;
    CustomAIDataFeedV2 feed;

    function setUp() public {
        vm.warp(1000);
        feed = new CustomAIDataFeedV2(keccak256("london"), keccak256("model-v1"), vm.addr(KEY), 0, 100_000, 300);
    }

    function update(uint64 sequence, int256 value, uint64 observed) private {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, feed.digest(sequence, value, observed, observed + 300));
        feed.update(sequence, value, observed, observed + 300, abi.encodePacked(r, s, v));
    }

    function rejectUpdate(uint64 sequence, int256 value, uint64 observed) private {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, feed.digest(sequence, value, observed, observed + 300));
        vm.expectRevert();
        feed.update(sequence, value, observed, observed + 300, abi.encodePacked(r, s, v));
    }

    function test_preservesTransitionUntilValueActuallyChanges() public {
        update(1, 0, 1000);
        assertEq(feed.transitionSequence(), 0);
        vm.warp(1010);
        update(2, 0, 1010);
        assertEq(feed.transitionSequence(), 0);
        vm.warp(1020);
        update(3, 10, 1020);
        assertEq(feed.transitionSequence(), 1);
        assertEq(feed.previousValue(), 0);
        assertEq(feed.changedAt(), 1020);
        vm.warp(1030);
        update(4, 10, 1030);
        assertEq(feed.transitionSequence(), 1);
        assertEq(feed.changedAt(), 1020);
    }

    function test_rejectsReplayConflictingTimestampAndOtherDomain() public {
        update(1, 0, 1000);
        rejectUpdate(1, 0, 1000);
        rejectUpdate(2, 2, 1000);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, feed.digest(2, 2, 1010, 1310));
        vm.warp(1010);
        vm.chainId(4663);
        vm.expectRevert();
        feed.update(2, 2, 1010, 1310, abi.encodePacked(r, s, v));
    }

    function test_expiryAndFutureObservationCannotBecomeFresh() public {
        update(1, 0, 1000);
        vm.warp(1301);
        (,,,,,,, bool fresh) = feed.latestSnapshot();
        assertFalse(fresh);
        rejectUpdate(2, 1, 1400);
    }
}
