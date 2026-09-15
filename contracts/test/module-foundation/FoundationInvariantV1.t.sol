// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationForkBase } from "./FoundationForkV1.t.sol";
import { FoundationTypesV1 as T } from "../../src/module-foundation/FoundationTypesV1.sol";
import { FoundationLedgerV1 } from "../../src/module-foundation/FoundationLedgerV1.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice Bounded stateful integration invariants over genuine Core/UR swaps and claims on the fixed fork.
contract FoundationInvariantV1Test is FoundationForkBase {
    T.LaunchResult private _result;
    uint256 private _buyGross;
    uint256 private _sellGross;
    uint256 private _successfulSwaps;

    function setUp() public override {
        super.setUp();
        _result = _launch(_params(true, 1000, 0, 0));
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = this.stepSwap.selector;
        selectors[1] = this.stepClaim.selector;
        targetSelector(FuzzSelector(address(this), selectors));
        targetContract(address(this));
        targetSender(ALICE);
    }

    function stepSwap(uint96 seed, bool buy) external {
        uint256 available = buy ? quote.balanceOf(ALICE) : IERC20(_result.token).balanceOf(ALICE);
        if (available < 1_000_000) return;
        uint256 limit = buy && available > 1 ether ? 1 ether : available;
        uint256 amount = bound(seed, 1_000_000, limit);
        FoundationLedgerV1 ledger = FoundationLedgerV1(_result.ledger);
        uint256 beforeFees = ledger.platformReceived() + ledger.creatorReceived();
        uint256 other = _trade(_result, buy, true, amount);
        if (buy) _buyGross += amount;
        else _sellGross += other + ledger.platformReceived() + ledger.creatorReceived() - beforeFees;
        ++_successfulSwaps;
    }

    function stepClaim(bool platform) external {
        FoundationLedgerV1 ledger = FoundationLedgerV1(_result.ledger);
        if (platform) {
            if (ledger.platformReceived() > ledger.platformClaimed()) ledger.claimPlatform();
        } else {
            if (ledger.creatorCredited() > ledger.creatorClaimed()) ledger.claimCreator();
        }
    }

    function invariant_quoteConservationPlatformRateAndPrincipalIsolation() public view {
        FoundationLedgerV1 ledger = FoundationLedgerV1(_result.ledger);
        assertEq(ledger.platformReceived(), _buyGross * 30 / 10_000 + _sellGross * 30 / 10_000);
        assertEq(ledger.creatorReceived(), _buyGross * 1000 / 10_000 + _sellGross * 1000 / 10_000);
        assertEq(ledger.creatorReceived(), ledger.creatorCredited());
        assertEq(manager.balanceOf(_result.ledger, uint256(uint160(address(quote)))), ledger.outstandingBacking());
        assertEq(IERC721(POSM).ownerOf(_result.basePositionId), _result.baseVault);
        assertEq(IERC721(POSM).getApproved(_result.basePositionId), address(0));
        assertEq(IERC20(_result.token).totalSupply(), T.TOKEN_SUPPLY);
        _assertClean(_result);
    }
}
