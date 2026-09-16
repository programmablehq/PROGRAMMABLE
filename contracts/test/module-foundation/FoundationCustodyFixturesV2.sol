// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { FoundationTypesV1 as T } from "../../src/module-foundation/FoundationTypesV1.sol";
import { IFoundationModuleFactoryV1 } from "../../src/module-foundation/IFoundationModuleV1.sol";
import { FoundationStatefulFixture } from "./FoundationFixturesV1.sol";

/// @dev Test-only module factory with genuine prefunded quote. Tests the preserved actual-refund semantics.
contract FoundationDonationFactoryFixtureV2 is IFoundationModuleFactoryV1 {
    address public immutable launchFactory;
    uint256 public immutable donation;

    constructor(address factory, uint256 amount) {
        launchFactory = factory;
        donation = amount;
    }

    function createModule(T.ModuleContext calldata c, bytes calldata configuration) external returns (address) {
        require(msg.sender == c.host, "bound host");
        require(IERC20(c.quote).transfer(launchFactory, donation), "donation transfer");
        return address(new FoundationStatefulFixture(c, configuration));
    }
}
