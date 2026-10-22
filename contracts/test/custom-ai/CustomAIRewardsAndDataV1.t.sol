// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { CustomAITypesV1 as T } from "../../src/custom-ai/CustomAITypesV1.sol";
import { CustomAIRewardVaultV1 } from "../../src/custom-ai/CustomAIRewardVaultV1.sol";
import { CustomAIDataFeedV1 } from "../../src/custom-ai/CustomAIDataFeedV1.sol";
import { ICustomAIRewardModuleV1 } from "../../src/custom-ai/ICustomAIRewardModuleV1.sol";
import { LedgerQuoteFixture } from "./CustomAIFeeLedgerV1.t.sol";

contract RewardProposalFixture is ICustomAIRewardModuleV1 {
    bytes32 public constant CONFIG = keccak256("reward-config");
    address public beneficiary = address(0xbabe);
    uint256 public amount = 100;
    uint8 public mode;

    function configure(address who, uint256 value, uint8 mode_) external {
        beneficiary = who;
        amount = value;
        mode = mode_;
    }

    function quoteReward(bytes32, address, address, uint256)
        external
        view
        returns (bytes4, address, uint256, uint64, bytes32)
    {
        if (mode == 1) revert("unavailable");
        if (mode == 2) {
            while (gasleft() > 100) { }
            revert();
        }
        if (mode == 3) {
            assembly ("memory-safe") { return(0, 0) }
        }
        if (mode == 4) {
            assembly ("memory-safe") { return(0, 100000) }
        }
        return (
            this.quoteReward.selector,
            beneficiary,
            amount,
            mode == 5 ? 0 : type(uint64).max,
            mode == 6 ? bytes32(0) : CONFIG
        );
    }
}

contract CustomAIRewardsV1Test is Test {
    address private constant CREATOR = address(0xc0ffee);
    address private constant BENEFICIARY = address(0xbabe);
    address private constant OTHER = address(0x1111);
    LedgerQuoteFixture private quote;
    RewardProposalFixture private module;
    CustomAIRewardVaultV1 private vault;

    function setUp() public {
        vm.warp(1000);
        quote = new LedgerQuoteFixture();
        module = new RewardProposalFixture();
        vault = new CustomAIRewardVaultV1(
            address(quote),
            T.Rewards(CREATOR, 4000, T.ModuleBinding(address(module), address(module).codehash, module.CONFIG()))
        );
    }

    function test_onlyFundedRewardsAndFixedClaimsNoDoublePayment() public {
        assertFalse(vault.allocate(bytes32(uint256(1))));
        quote.mint(address(vault), 1000);
        assertTrue(vault.allocate(bytes32(uint256(1))));
        assertEq(vault.creatorReceived(), 400);
        assertEq(vault.availableRewards(), 500);
        assertEq(vault.reservedRewards(), 100);
        assertEq(vault.claimable(BENEFICIARY), 100);
        assertFalse(vault.allocate(bytes32(uint256(1))));
        vm.prank(OTHER);
        vault.claimReward(BENEFICIARY);
        vm.prank(OTHER);
        vault.claimCreator();
        assertEq(quote.balanceOf(BENEFICIARY), 100);
        assertEq(quote.balanceOf(CREATOR), 400);
        assertEq(quote.balanceOf(OTHER), 0);
        assertEq(quote.balanceOf(address(vault)), 500);
        vm.expectRevert(CustomAIRewardVaultV1.NothingToClaim.selector);
        vault.claimReward(BENEFICIARY);
    }

    function test_faultyProposalsDoNotSpendOrBlockCreatorClaim() public {
        quote.mint(address(vault), 1000);
        for (uint8 mode = 1; mode <= 6; ++mode) {
            module.configure(BENEFICIARY, 100, mode);
            assertFalse(vault.allocate(bytes32(uint256(mode))));
        }
        module.configure(BENEFICIARY, 601, 0);
        assertFalse(vault.allocate(bytes32(uint256(7))));
        module.configure(address(0), 100, 0);
        assertFalse(vault.allocate(bytes32(uint256(8))));
        module.configure(address(vault), 100, 0);
        assertFalse(vault.allocate(bytes32(uint256(9))));
        module.configure(BENEFICIARY, 100, 0);
        vm.etch(address(module), hex"00");
        assertFalse(vault.allocate(bytes32(uint256(10))));
        assertEq(vault.reservedRewards(), 0);
        vault.claimCreator();
        assertEq(quote.balanceOf(CREATOR), 400);
        assertEq(vault.availableRewards(), 600);
    }

    function test_failedRecipientAndTaxedTransfersPreserveClaims() public {
        quote.mint(address(vault), 1000);
        vault.allocate(bytes32(uint256(1)));
        quote.setFaults(BENEFICIARY, false, address(0));
        vm.expectRevert();
        vault.claimReward(BENEFICIARY);
        assertEq(vault.claimable(BENEFICIARY), 100);
        vault.claimCreator();
        quote.setFaults(address(0), true, address(0));
        vm.expectRevert();
        vault.claimReward(BENEFICIARY);
        assertEq(vault.reservedRewards(), 100);
        quote.setFaults(address(0), false, address(0));
        vault.claimReward(BENEFICIARY);
        assertEq(quote.balanceOf(BENEFICIARY), 100);
    }

    function test_smallFundingCannotDivertCreatorShare() public {
        for (uint256 i; i < 100; ++i) {
            quote.mint(address(vault), 1);
            vault.sync();
        }
        assertEq(vault.creatorReceived(), 40);
        assertEq(vault.availableRewards(), 60);
        assertEq(vault.accountedBalance(), 100);
    }

    function test_otherVaultCannotSupplyBacking() public {
        CustomAIRewardVaultV1 other = new CustomAIRewardVaultV1(
            address(quote),
            T.Rewards(CREATOR, 4000, T.ModuleBinding(address(module), address(module).codehash, module.CONFIG()))
        );
        quote.mint(address(other), 1000);
        assertFalse(vault.allocate(bytes32(uint256(1))));
        assertEq(vault.claimable(BENEFICIARY), 0);
        assertTrue(other.allocate(bytes32(uint256(1))));
    }

    function testFuzz_budgetConservation(uint128 funding, uint128 requested, uint16 share) public {
        uint256 total = bound(funding, 1, type(uint128).max);
        share = uint16(bound(share, 0, 10_000));
        CustomAIRewardVaultV1 target = new CustomAIRewardVaultV1(
            address(quote),
            T.Rewards(CREATOR, share, T.ModuleBinding(address(module), address(module).codehash, module.CONFIG()))
        );
        quote.mint(address(target), total);
        uint256 requestedAmount = bound(requested, 1, type(uint128).max);
        module.configure(BENEFICIARY, requestedAmount, 0);
        bool allocated = target.allocate(bytes32(uint256(1)));
        uint256 creator = total * share / 10_000;
        assertEq(allocated, requestedAmount <= total - creator);
        assertEq(target.accountedBalance(), total);
        if (allocated) target.claimReward(BENEFICIARY);
        if (creator != 0) target.claimCreator();
        assertEq(quote.balanceOf(address(target)), target.availableRewards());
    }
}

contract CustomAIDataV1Test is Test {
    uint256 private constant KEY = 0x987654;
    CustomAIDataFeedV1 private feed;

    function setUp() public {
        vm.warp(1000);
        feed = new CustomAIDataFeedV1(keccak256("weather-temperature"), vm.addr(KEY), -100, 100, 60);
    }

    function _signature(CustomAIDataFeedV1 target, uint64 seq, int256 val, uint64 observed, uint64 expires)
        private
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, target.digest(seq, val, observed, expires));
        return abi.encodePacked(r, s, v);
    }

    function test_authenticatedDataExpiresAndCannotReplay() public {
        (, bool fresh) = feed.latest();
        assertFalse(fresh);
        bytes memory signature = _signature(feed, 1, -5, 1000, 1060);
        vm.prank(address(123));
        feed.update(1, -5, 1000, 1060, signature);
        (int256 value, bool valid) = feed.latest();
        assertEq(value, -5);
        assertTrue(valid);
        vm.expectRevert(CustomAIDataFeedV1.InvalidUpdate.selector);
        feed.update(1, -5, 1000, 1060, signature);
        vm.warp(1061);
        (, fresh) = feed.latest();
        assertFalse(fresh);
    }

    function test_signaturesBoundToContractChainAndValue() public {
        bytes memory signature = _signature(feed, 1, 10, 1000, 1060);
        CustomAIDataFeedV1 other = new CustomAIDataFeedV1(keccak256("weather-temperature"), vm.addr(KEY), -100, 100, 60);
        vm.expectRevert(CustomAIDataFeedV1.InvalidUpdate.selector);
        other.update(1, 10, 1000, 1060, signature);
        vm.expectRevert(CustomAIDataFeedV1.InvalidUpdate.selector);
        feed.update(1, 11, 1000, 1060, signature);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(CustomAIDataFeedV1.InvalidUpdate.selector);
        feed.update(1, 10, 1000, 1060, signature);
    }

    function test_boundsFutureStaleAndOutOfOrderObservationsRejected() public {
        bytes memory sig = _signature(feed, 1, 101, 1000, 1060);
        vm.expectRevert(CustomAIDataFeedV1.InvalidUpdate.selector);
        feed.update(1, 101, 1000, 1060, sig);
        sig = _signature(feed, 1, 10, 1001, 1061);
        vm.expectRevert(CustomAIDataFeedV1.InvalidUpdate.selector);
        feed.update(1, 10, 1001, 1061, sig);
        sig = _signature(feed, 1, 10, 939, 1060);
        vm.expectRevert(CustomAIDataFeedV1.InvalidUpdate.selector);
        feed.update(1, 10, 939, 1060, sig);
        feed.update(1, 10, 1000, 1060, _signature(feed, 1, 10, 1000, 1060));
        sig = _signature(feed, 2, 20, 999, 1059);
        vm.expectRevert(CustomAIDataFeedV1.InvalidUpdate.selector);
        feed.update(2, 20, 999, 1059, sig);
        feed.update(2, 20, 1000, 1030, _signature(feed, 2, 20, 1000, 1030));
        assertEq(feed.value(), 20);
    }
}
