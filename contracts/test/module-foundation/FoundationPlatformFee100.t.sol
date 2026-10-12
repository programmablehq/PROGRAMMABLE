// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationForkBaseV3 } from "./FoundationDirectionalFeesV3.t.sol";
import { FoundationEthereumStampV2Test } from "./FoundationEthereumStampV2.t.sol";
import { FoundationFactoryV3 } from "../../src/module-foundation/FoundationFactoryV3.sol";
import { FoundationFactoryFee100V1 } from "../../src/module-foundation/FoundationFactoryFee100V1.sol";
import { FoundationHookV4 } from "../../src/module-foundation/FoundationHookV4.sol";
import { IFoundationUniversalRouterV2 } from "../../src/module-foundation/FoundationFactoryV2.sol";
import { FoundationLaunchTypesV3 as P } from "../../src/module-foundation/FoundationLaunchTypesV3.sol";
import { FoundationLaunchTypesV2 as L } from "../../src/module-foundation/FoundationLaunchTypesV2.sol";
import { FoundationLedgerV1 } from "../../src/module-foundation/FoundationLedgerV1.sol";

contract FoundationRobinhoodFee100Test is FoundationForkBaseV3 {
    function _platformFeeBps() internal pure override returns (uint16) {
        return 100;
    }

    function _hookDeployerArtifact() internal pure override returns (string memory) {
        return "FoundationHookDeployerV4.sol:FoundationHookDeployerV4";
    }

    function setUp() public override {
        super.setUp();
        bytes32[5] memory hashes =
            [MANAGER.codehash, POSM.codehash, ROUTER.codehash, PERMIT2.codehash, address(deployer).codehash];
        factory = FoundationFactoryV3(
            deployCode(
                "FoundationFactoryFee100V1.sol:FoundationFactoryFee100V1",
                abi.encode(manager, positions, IFoundationUniversalRouterV2(ROUTER), permits, deployer, hashes)
            )
        );
        vm.prank(ALICE);
        quote.approve(address(factory), type(uint256).max);
    }

    function test_fee100InitialBuyAndBothSidesAllSwapForms() public {
        for (uint256 order; order < 2; ++order) {
            P.LaunchParamsV3 memory p = _params(order == 0, 100, 300, 0, 1 ether);
            L.LaunchResultV2 memory r = _launch(p);
            assertEq(FoundationHookV4(r.hook).PLATFORM_FEE_BPS(), 100);
            assertEq(FoundationFactoryFee100V1(payable(address(factory))).PLATFORM_FEE_BPS(), 100);
            assertEq(FoundationLedgerV1(r.ledger).platformReceived(), 1 ether * 100 / 10_000);
            uint256 bought = _trade(r, true, true, 1 ether);
            _trade(r, true, false, bought / 4);
            uint256 sold = _trade(r, false, true, bought / 3);
            _trade(r, false, false, sold / 3);
            uint256 earned = FoundationLedgerV1(r.ledger).platformReceived();
            address recipient = 0xD88539d3c4C460136a733A3Fd60cf6BF269079da;
            uint256 beforeBalance = quote.balanceOf(recipient);
            FoundationLedgerV1(r.ledger).claimPlatform();
            assertEq(quote.balanceOf(recipient) - beforeBalance, earned);
        }
    }
}

contract FoundationEthereumFee100Test is FoundationEthereumStampV2Test {
    function _platformFeeBps() internal pure override returns (uint16) {
        return 100;
    }

    function _graphHookCreationCode() internal pure override returns (bytes memory) {
        return type(FoundationHookV4).creationCode;
    }

    function _deployGraphImplementation(bytes32[5] memory hashes) internal override returns (address) {
        return deployCode(
            "FoundationEthereumGraphLaunchV4.sol:FoundationEthereumGraphLaunchV4",
            abi.encode(
                manager,
                positions,
                IFoundationUniversalRouterV2(ROUTER),
                permits,
                CANONICAL_GRAPH_FACTORY,
                CANONICAL_ROUTER,
                hashes
            )
        );
    }
}
