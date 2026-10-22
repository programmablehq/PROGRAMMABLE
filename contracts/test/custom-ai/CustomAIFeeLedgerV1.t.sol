// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { CustomAITypesV1 as T } from "../../src/custom-ai/CustomAITypesV1.sol";
import { CustomAIFeeMathV1 as F } from "../../src/custom-ai/CustomAIFeeMathV1.sol";
import { CustomAIFeeLedgerV1 } from "../../src/custom-ai/CustomAIFeeLedgerV1.sol";

contract LedgerQuoteFixture is ERC20 {
    address public blocked;
    bool public taxed;
    address public reenter;
    bool public reentrySucceeded;
    bool public reentryAttempted;

    constructor() ERC20("Ledger fixture", "LF") { }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function setFaults(address blocked_, bool taxed_, address reenter_) external {
        blocked = blocked_;
        taxed = taxed_;
        reenter = reenter_;
    }

    function _update(address from, address to, uint256 amount) internal override {
        require(to != blocked || to == address(0), "blocked recipient");
        if (reenter != address(0) && from != address(0)) {
            reentryAttempted = true;
            (reentrySucceeded,) = reenter.call(abi.encodeWithSignature("claimPlatform()"));
        }
        uint256 tax = taxed && from != address(0) && to != address(0) ? amount / 100 : 0;
        super._update(from, to, amount - tax);
        if (tax != 0) super._update(from, address(0), tax);
    }
}

contract CustomAIFeeLedgerV1Test is Test, IUnlockCallback {
    IPoolManager private manager;
    LedgerQuoteFixture private quote;
    CustomAIFeeLedgerV1 private ledger;
    address private constant CREATOR = address(0xc0ffee);
    address private constant STRANGER = address(0xb0b);

    function setUp() public {
        manager = new PoolManager(address(this));
        quote = new LedgerQuoteFixture();
        ledger = new CustomAIFeeLedgerV1(manager, address(quote), CREATOR);
    }

    function _fund(CustomAIFeeLedgerV1 target, uint256 amount) private {
        if (amount == 0) return;
        quote.mint(address(this), amount);
        manager.unlock(abi.encode(address(target), amount));
    }

    function _accrue(uint256 gross, uint16 extra) private returns (F.Fees memory fees) {
        fees = F.fromGross(gross, extra);
        _fund(ledger, fees.platform + fees.additional);
        ledger.accrue(gross, extra);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "manager");
        (address target, uint256 amount) = abi.decode(data, (address, uint256));
        manager.sync(Currency.wrap(address(quote)));
        quote.transfer(address(manager), amount);
        assertEq(manager.settle(), amount);
        manager.mint(target, uint256(uint160(address(quote))), amount);
        return bytes("");
    }

    function test_realPoolManagerBackingAndFixedRecipients() public {
        _accrue(10_000 ether, 1000);
        assertEq(ledger.platformReceived(), 50 ether);
        assertEq(ledger.additionalReceived(), 1000 ether);
        assertEq(ledger.outstandingBacking(), 1050 ether);
        vm.startPrank(STRANGER);
        assertEq(ledger.claimPlatform(), 50 ether);
        assertEq(ledger.claimAdditional(), 1000 ether);
        vm.stopPrank();
        assertEq(quote.balanceOf(T.PLATFORM_RECIPIENT), 50 ether);
        assertEq(quote.balanceOf(CREATOR), 1000 ether);
        assertEq(quote.balanceOf(STRANGER), 0);
        assertEq(ledger.outstandingBacking(), 0);
        assertEq(manager.balanceOf(address(ledger), uint256(uint160(address(quote)))), 0);
        vm.expectRevert(CustomAIFeeLedgerV1.NothingToClaim.selector);
        ledger.claimPlatform();
    }

    function test_unbackedAndUnauthorizedCreditsDoNotCreateClaims() public {
        vm.expectRevert(CustomAIFeeLedgerV1.InsufficientBacking.selector);
        ledger.accrue(10_000, 1000);
        assertEq(ledger.platformReceived(), 0);
        vm.prank(STRANGER);
        vm.expectRevert(CustomAIFeeLedgerV1.Unauthorized.selector);
        ledger.accrue(10_000, 1000);
        vm.expectRevert(F.FeeCapExceeded.selector);
        ledger.accrue(10_000, 1451);
    }

    function test_oneLaunchCannotUseAnotherLaunchsCredits() public {
        CustomAIFeeLedgerV1 other = new CustomAIFeeLedgerV1(manager, address(quote), STRANGER);
        _accrue(10_000 ether, 1000);
        vm.expectRevert(CustomAIFeeLedgerV1.InsufficientBacking.selector);
        other.accrue(10_000 ether, 1000);
        assertEq(other.outstandingBacking(), 0);
        vm.prank(STRANGER);
        vm.expectRevert();
        manager.transferFrom(address(ledger), STRANGER, uint256(uint160(address(quote))), 1);
    }

    function test_failingCreatorCannotBlockPlatformAndClaimRemains() public {
        _accrue(10_000 ether, 1000);
        quote.setFaults(CREATOR, false, address(0));
        vm.expectRevert();
        ledger.claimAdditional();
        assertEq(ledger.additionalClaimed(), 0);
        ledger.claimPlatform();
        assertEq(quote.balanceOf(T.PLATFORM_RECIPIENT), 50 ether);
        assertEq(ledger.outstandingBacking(), 1000 ether);
        quote.setFaults(address(0), false, address(0));
        ledger.claimAdditional();
        assertEq(quote.balanceOf(CREATOR), 1000 ether);
    }

    function test_taxedTransferRollsBackClaimsAndUnderlyingBalances() public {
        _accrue(10_000 ether, 1000);
        quote.setFaults(address(0), true, address(0));
        vm.expectRevert(CustomAIFeeLedgerV1.InvalidTransfer.selector);
        ledger.claimAdditional();
        assertEq(ledger.additionalClaimed(), 0);
        assertEq(quote.balanceOf(CREATOR), 0);
        assertEq(quote.balanceOf(address(manager)), 1050 ether);
        assertEq(manager.balanceOf(address(ledger), uint256(uint160(address(quote)))), 1050 ether);
    }

    function test_reentryAndForgedCallbacksCannotDoublePay() public {
        _accrue(10_000 ether, 1000);
        quote.setFaults(address(0), false, address(ledger));
        ledger.claimPlatform();
        assertTrue(quote.reentryAttempted());
        assertFalse(quote.reentrySucceeded());
        assertEq(quote.balanceOf(T.PLATFORM_RECIPIENT), 50 ether);
        vm.prank(address(manager));
        vm.expectRevert(CustomAIFeeLedgerV1.Unauthorized.selector);
        ledger.unlockCallback(abi.encode(STRANGER, 1000 ether));
    }

    function testFuzz_claimOrderConservesEveryCreditedUnit(uint128 amount, uint16 extra, bool platformFirst) public {
        uint256 gross = bound(amount, 10_000, T.MAX_AMOUNT);
        extra = uint16(bound(extra, 1, 1450));
        F.Fees memory fees = _accrue(gross, extra);
        if (platformFirst) {
            ledger.claimPlatform();
            ledger.claimAdditional();
        } else {
            ledger.claimAdditional();
            ledger.claimPlatform();
        }
        assertEq(quote.balanceOf(T.PLATFORM_RECIPIENT), fees.platform);
        assertEq(quote.balanceOf(CREATOR), fees.additional);
        assertEq(quote.balanceOf(address(manager)), 0);
        assertEq(ledger.outstandingBacking(), 0);
    }
}
