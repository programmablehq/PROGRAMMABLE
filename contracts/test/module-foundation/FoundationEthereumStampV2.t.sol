// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationEthereumStampV1Test, G, R } from "./FoundationEthereumStampV1.t.sol";
import { IFoundationUniversalRouterV2 } from "../../src/module-foundation/FoundationFactoryV2.sol";
import { FoundationEthereumGraphProxyV1 } from "../../src/module-foundation/FoundationEthereumGraphProxyV1.sol";
import { FoundationEthereumGraphProxyV2 } from "../../src/module-foundation/FoundationEthereumGraphProxyV2.sol";

contract FoundationDirectGraphCallerV2 {
    function deploy(G factory, G.GraphAuthorization memory authorization, G.Target[] memory targets) external {
        factory.deployGraph(authorization, targets);
    }
}

/// @notice Reuses the existing stamped launch, fee, module and custody lifecycle against V2.
contract FoundationEthereumStampV2Test is FoundationEthereumStampV1Test {
    // Mining is deliberately charged to the test. Keep each strategy's full
    // lifecycle within its own test budget instead of sharing one four-case cap.
    function testEconomicStrategiesThroughCanonicalStamp() public override {
        _verifyEconomicStamp(0, address(0));
    }

    function testEconomicStrategyOneThroughCanonicalStamp() public {
        _verifyEconomicStamp(1, address(0));
    }

    function testEconomicStrategyTwoThroughCanonicalStamp() public {
        _verifyEconomicStamp(2, address(0));
    }

    function testEconomicStrategyThreeThroughCanonicalStamp() public {
        _verifyEconomicStamp(3, address(0));
    }

    function _deployGraphImplementation(bytes32[5] memory hashes) internal override returns (address) {
        return deployCode(
            "FoundationEthereumGraphLaunchV2.sol:FoundationEthereumGraphLaunchV2",
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

    function _graphProxyCreationCode(bytes32 routeNonce) internal view override returns (bytes memory) {
        return abi.encodePacked(
            type(FoundationEthereumGraphProxyV2).creationCode,
            abi.encode(implementation, implementation.codehash, ALICE, routeNonce)
        );
    }

    function test_directWalletCannotCreateUnstampedModuleGraph() public {
        (,, bytes memory payload, address engine) = _build(0, 0);
        R.CustomGraphRouteV1 memory route = abi.decode(payload, (R.CustomGraphRouteV1));
        G.GraphAuthorization memory authorization = G.GraphAuthorization(
            route.routeNamespace, route.routeNonce, route.topologyHash, bytes32(uint256(1)), ALICE, 0
        );
        (authorization.graphCommitment,) = graph.computeGraphCommitment(authorization, route.targets);
        address directEngine = graph.predictTarget(authorization, route.targets[0]);
        assertTrue(directEngine != engine);
        vm.expectRevert();
        vm.prank(ALICE);
        graph.deployGraph(authorization, route.targets);
        assertEq(directEngine.code.length, 0);
        assertEq(engine.code.length, 0);
    }

    function test_forwardingContractCannotCreateUnstampedModuleGraph() public {
        (,, bytes memory payload, address engine) = _build(0, 0);
        R.CustomGraphRouteV1 memory route = abi.decode(payload, (R.CustomGraphRouteV1));
        FoundationDirectGraphCallerV2 caller = new FoundationDirectGraphCallerV2();
        G.GraphAuthorization memory authorization = G.GraphAuthorization(
            route.routeNamespace, route.routeNonce, route.topologyHash, bytes32(uint256(1)), address(caller), 0
        );
        (authorization.graphCommitment,) = graph.computeGraphCommitment(authorization, route.targets);
        address directEngine = graph.predictTarget(authorization, route.targets[0]);
        vm.expectRevert();
        caller.deploy(graph, authorization, route.targets);
        assertEq(directEngine.code.length, 0);
        assertEq(engine.code.length, 0);
    }

    function test_legacyProxyCannotBypassStampedInitializer() public {
        vm.expectRevert();
        vm.prank(CANONICAL_GRAPH_FACTORY);
        new FoundationEthereumGraphProxyV1(implementation, implementation.codehash, ALICE);
    }

    function test_constructorNonceMustMatchFactorySalt() public {
        (,, bytes memory payload,) = _build(0, 0);
        R.CustomGraphRouteV1 memory route = abi.decode(payload, (R.CustomGraphRouteV1));
        G.GraphAuthorization memory authorization = G.GraphAuthorization(
            route.routeNamespace,
            keccak256("another-route"),
            route.topologyHash,
            bytes32(uint256(1)),
            CANONICAL_ROUTER,
            0
        );
        (authorization.graphCommitment,) = graph.computeGraphCommitment(authorization, route.targets);
        address engine = graph.predictTarget(authorization, route.targets[0]);
        vm.expectRevert();
        vm.prank(CANONICAL_ROUTER);
        graph.deployGraph(authorization, route.targets);
        assertEq(engine.code.length, 0);
    }

    function test_failedStampVerificationRollsBackTheEntireGraph() public {
        (R.LaunchPermitV1 memory permit, R.StampRequestV1 memory request, bytes memory payload, address engine) =
            _build(0, 0);
        R.CustomGraphRouteV1 memory route = abi.decode(payload, (R.CustomGraphRouteV1));
        route.expectedGraphDeploymentHash = keccak256("incorrect final graph result");
        bytes32[] memory outputHashes = new bytes32[](route.expectedOutputs.length);
        for (uint8 i; i < route.expectedOutputs.length; ++i) {
            R.ExpectedGraphOutputV1 memory output = route.expectedOutputs[i];
            outputHashes[i] = keccak256(
                abi.encode(OUTPUT_TYPEHASH, i, output.targetIdHash, output.account, output.runtimeCodeHash)
            );
        }
        payload = abi.encode(route);
        permit.routePayloadHash = keccak256(payload);
        permit.expectedResultHash = keccak256(
            abi.encode(RESULT_TYPEHASH, keccak256(abi.encodePacked(outputHashes)), route.expectedGraphDeploymentHash)
        );
        _authorizeOnlyOnFork(permit);
        vm.expectRevert(
            abi.encodeWithSelector(bytes4(keccak256("FactoryResultMismatch(uint8,uint256)")), uint8(1), uint256(0))
        );
        vm.prank(ALICE);
        stampRouter.launchAndStampV1(permit, request, payload, hex"c0ffee");
        assertEq(engine.code.length, 0);
        assertEq(request.token.code.length, 0);
        assertEq(address(request.poolKey.hooks).code.length, 0);
        assertEq(stampRouter.launchIdByToken(request.token), bytes32(0));
    }
}
