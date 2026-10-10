// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { EconomicReleaseFixtureV1 } from "./EconomicReleaseFixtureV1.sol";

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { PathKey } from "@uniswap/v4-periphery-v211/src/libraries/PathKey.sol";
import { FoundationForkBaseV3 } from "./FoundationDirectionalFeesV3.t.sol";
import { FoundationEthereumFixtureV3 } from "./FoundationEthereumV3.t.sol";
import { FoundationEthereumGraphLaunchV1 } from "../../src/module-foundation/FoundationEthereumGraphLaunchV1.sol";
import { FoundationEthereumGraphProxyV1 } from "../../src/module-foundation/FoundationEthereumGraphProxyV1.sol";
import {
    LaunchWalletCapEthereumFactoryV1
} from "../../src/module-foundation/modules/launch-wallet-cap/LaunchWalletCapEthereumFactoryV1.sol";
import { LaunchWalletCapV1 } from "../../src/module-foundation/modules/launch-wallet-cap/LaunchWalletCapV1.sol";
import { IV4Router } from "@uniswap/v4-periphery-v211/src/interfaces/IV4Router.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { IFoundationWrappedEth } from "../../src/module-foundation/FoundationFactoryV2Native.sol";
import { FoundationFixtureFactory, FoundationStatefulFixture } from "./FoundationFixturesV1.sol";
import { FoundationFactoryV3 } from "../../src/module-foundation/FoundationFactoryV3.sol";
import { IFoundationUniversalRouterV2 } from "../../src/module-foundation/FoundationFactoryV2.sol";
import { FoundationTokenV1 } from "../../src/module-foundation/FoundationTokenV1.sol";
import { FoundationHookV2 } from "../../src/module-foundation/FoundationHookV2.sol";
import { FoundationLedgerV1 } from "../../src/module-foundation/FoundationLedgerV1.sol";
import { IFoundationModuleV1, IFoundationModuleFactoryV1 } from "../../src/module-foundation/IFoundationModuleV1.sol";
import { FeeStrategyV1 } from "../../src/module-foundation/modules/economics/FeeStrategyV1.sol";
import { FoundationTypesV1 as T } from "../../src/module-foundation/FoundationTypesV1.sol";
import { FoundationLaunchTypesV3 as P } from "../../src/module-foundation/FoundationLaunchTypesV3.sol";
import { FoundationLaunchTypesV2 as L } from "../../src/module-foundation/FoundationLaunchTypesV2.sol";
import { ProgrammableLaunchStampRouterV1 } from "../../src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol";
import {
    IProgrammableLaunchStampRouterV1 as R
} from "../../src/robinhood-custom-launch/interfaces/IProgrammableLaunchStampRouterV1.sol";
import {
    IProgrammableCreate2GraphDeployerV1 as G
} from "../../src/robinhood-custom-launch/interfaces/IProgrammableCreate2GraphDeployerV1.sol";

interface FoundationStampColdVm {
    function cool(address target) external;
}

interface IFoundationGraphPlannerV1 is G {
    function computeGraphCommitment(GraphAuthorization calldata authorization, Target[] calldata targets)
        external
        view
        returns (bytes32, uint256);
    function predictTarget(GraphAuthorization calldata authorization, Target calldata target)
        external
        view
        returns (address);
    function effectiveTargetSalt(GraphAuthorization calldata authorization, bytes32 targetIdHash, bytes32 applicantSalt)
        external
        view
        returns (bytes32);
}

/// @notice Uses the actual Ethereum Router, Graph Factory and Uniswap code on a fork.
/// @dev Only the exact permit's EIP-1271 signature is stubbed locally. This is compatibility evidence, not live
/// authorization.
contract FoundationEthereumStampV1Test is FoundationForkBaseV3 {
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant CANONICAL_ROUTER = 0x8622DD5bAb44185f2A458ac90384Ac99248f8d56;
    address constant CANONICAL_GRAPH_FACTORY = 0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887;
    bytes32 constant OUTPUT_TYPEHASH = keccak256(
        "ProgrammableExpectedGraphOutputV1(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)"
    );
    bytes32 constant RESULT_TYPEHASH =
        keccak256("ProgrammableExpectedGraphResultV1(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)");
    ProgrammableLaunchStampRouterV1 stampRouter = ProgrammableLaunchStampRouterV1(CANONICAL_ROUTER);
    IFoundationGraphPlannerV1 graph = IFoundationGraphPlannerV1(CANONICAL_GRAPH_FACTORY);

    address implementation;

    function _configureNetwork() internal override {
        MANAGER = FoundationEthereumFixtureV3.MANAGER;
        POSM = FoundationEthereumFixtureV3.POSM;
        ROUTER = FoundationEthereumFixtureV3.ROUTER;
        expectedChainId = 1;
        expectedInfrastructureHashes = FoundationEthereumFixtureV3.hashes();
        snapshotBlock = 26_125_239;
        forkRpcEnvironment = "FOUNDATION_ETHEREUM_RPC_URL";
        forkBlockEnvironment = "FOUNDATION_ETHEREUM_FORK_BLOCK";
    }

    function setUp() public override {
        super.setUp();
        assertEq(stampRouter.CHAIN_ID(), 1);
        assertEq(address(stampRouter.GRAPH_FACTORY()), CANONICAL_GRAPH_FACTORY);
        assertEq(address(stampRouter.POOL_MANAGER()), MANAGER);
        assertEq(CANONICAL_GRAPH_FACTORY.codehash, stampRouter.GRAPH_FACTORY_RUNTIME_CODE_HASH());
        bytes32[5] memory hashes =
            [MANAGER.codehash, POSM.codehash, ROUTER.codehash, PERMIT2.codehash, CANONICAL_GRAPH_FACTORY.codehash];
        implementation = _deployGraphImplementation(hashes);
        vm.deal(ALICE, 10 ether);
        vm.deal(address(this), 10 ether);
    }

    function _deployGraphImplementation(bytes32[5] memory hashes) internal virtual returns (address) {
        return deployCode(
            "FoundationEthereumGraphLaunchV1.sol:FoundationEthereumGraphLaunchV1",
            abi.encode(
                manager, positions, IFoundationUniversalRouterV2(ROUTER), permits, CANONICAL_GRAPH_FACTORY, hashes
            )
        );
    }

    function _graphProxyCreationCode(bytes32) internal view virtual returns (bytes memory) {
        return abi.encodePacked(
            type(FoundationEthereumGraphProxyV1).creationCode,
            abi.encode(implementation, implementation.codehash, ALICE)
        );
    }

    function _build(uint8 moduleCount, uint128 firstBuy)
        internal
        returns (R.LaunchPermitV1 memory permit, R.StampRequestV1 memory request, bytes memory payload, address engine)
    {
        return _buildWithModules(moduleCount, firstBuy, new T.ModuleSelection[](0));
    }

    function _buildWithModules(uint8 moduleCount, uint128 firstBuy, T.ModuleSelection[] memory selected)
        internal
        returns (R.LaunchPermitV1 memory permit, R.StampRequestV1 memory request, bytes memory payload, address engine)
    {
        P.LaunchParamsV3 memory p;
        p.metadata = T.Metadata(
            "Ethereum Module Fixture",
            "METH",
            "Immutable metadata in the Classic ABI",
            "https://example.com/coin.webp",
            "https://example.com",
            bytes('{"version":1,"twitter":"https://x.com/example"}')
        );
        p.quote = WETH;
        p.quoteDecimals = 18;
        p.creatorBuyFeeBps = 100;
        p.creatorSellFeeBps = 300;
        p.initialBuyQuoteAmount = firstBuy;
        p.initialBuyMinimumTokenAmount = firstBuy == 0 ? 0 : 1;
        p.deadline = uint64(block.timestamp + 120);
        p.tokenSalt = keccak256(abi.encode("foundation-ethereum-stamp-fixture", moduleCount, firstBuy));
        p.modules = selected.length == 0 ? new T.ModuleSelection[](moduleCount) : selected;
        if (selected.length == 0 && moduleCount == 1) {
            LaunchWalletCapEthereumFactoryV1 f = new LaunchWalletCapEthereumFactoryV1();
            T.Descriptor memory d = T.Descriptor(
                keccak256("programmable.foundation.launch-wallet-cap.v1"),
                1,
                3,
                0,
                100_000,
                100_000,
                0,
                false,
                keccak256("programmable.foundation.launch-wallet-cap")
            );
            p.modules[0] = T.ModuleSelection(
                address(f),
                address(f).codehash,
                keccak256(type(LaunchWalletCapV1).runtimeCode),
                keccak256(abi.encode(d)),
                abi.encode(uint16(1), uint32(3)),
                0
            );
        } else if (selected.length == 0 && moduleCount > 0) {
            FoundationFixtureFactory moduleFactory = new FoundationFixtureFactory();
            for (uint256 i; i < moduleCount; ++i) {
                T.Descriptor memory descriptor =
                    T.Descriptor(bytes32(i + 1), 1, 7, 1, 75_000, 75_000, 1_500_000, false, bytes32(0));
                p.modules[i] = T.ModuleSelection(
                    address(moduleFactory),
                    address(moduleFactory).codehash,
                    keccak256(type(FoundationStatefulFixture).runtimeCode),
                    keccak256(abi.encode(descriptor)),
                    abi.encode(descriptor, uint8(0)),
                    uint16(10_000 / moduleCount)
                );
            }
        }
        G.GraphAuthorization memory authorization = G.GraphAuthorization(
            keccak256("programmable.module-foundation.ethereum-graph.v1"),
            p.tokenSalt,
            keccak256("engine-token-hook.v1"),
            bytes32(uint256(1)),
            CANONICAL_ROUTER,
            firstBuy
        );
        G.Target[] memory targets = new G.Target[](3);
        targets[0] = G.Target(
            keccak256("engine"), bytes32(0), 0, firstBuy, _graphProxyCreationCode(authorization.routeNonce), bytes("")
        );
        engine = graph.predictTarget(authorization, targets[0]);
        targets[1] = G.Target(
            keccak256("token"),
            bytes32(0),
            0,
            0,
            abi.encodePacked(type(FoundationTokenV1).creationCode, abi.encode(p.metadata, engine)),
            bytes("")
        );
        address token = graph.predictTarget(authorization, targets[1]);
        p.initialTick = WETH < token ? int24(120_000) : int24(-120_000);
        targets[2] = G.Target(
            keccak256("hook"),
            bytes32(0),
            0,
            0,
            abi.encodePacked(
                type(FoundationHookV2).creationCode,
                abi.encode(
                    manager,
                    engine,
                    token,
                    WETH,
                    ALICE,
                    p.initialTick,
                    p.creatorBuyFeeBps,
                    p.creatorSellFeeBps,
                    p.modules
                )
            ),
            bytes("")
        );
        address hook;
        bytes32 initHash = keccak256(targets[2].initCode);
        for (uint256 i;; ++i) {
            targets[2].applicantSalt = bytes32(i);
            hook = vm.computeCreate2Address(
                graph.effectiveTargetSalt(authorization, targets[2].targetIdHash, bytes32(i)),
                initHash,
                CANONICAL_GRAPH_FACTORY
            );
            if (uint160(hook) & Hooks.ALL_HOOK_MASK == 0x20cc) break;
        }
        targets[0].initializerCalldata = abi.encodeCall(
            FoundationEthereumGraphLaunchV1.initializeGraph, (p, token, hook, abi.encode(new PathKey[](0)))
        );
        uint256 total;
        (authorization.graphCommitment, total) = graph.computeGraphCommitment(authorization, targets);
        assertEq(total, firstBuy);
        // Observe exact post-initialization runtimes in a reverted fork snapshot.
        uint256 snapshot = vm.snapshotState();
        vm.deal(CANONICAL_ROUTER, firstBuy);
        vm.prank(CANONICAL_ROUTER);
        (address[] memory outputs, bytes32[] memory runtimeHashes,, bytes32 graphHash) =
            graph.deployGraph{ value: firstBuy }(authorization, targets);
        assertEq(outputs[0], engine);
        assertEq(outputs[1], token);
        assertEq(outputs[2], hook);
        assertTrue(vm.revertToState(snapshot));
        R.CustomGraphRouteV1 memory route;
        route.routeNamespace = authorization.routeNamespace;
        route.routeNonce = authorization.routeNonce;
        route.topologyHash = authorization.topologyHash;
        route.graphCommitment = authorization.graphCommitment;
        route.targets = targets;
        route.expectedGraphDeploymentHash = graphHash;
        route.expectedOutputs = new R.ExpectedGraphOutputV1[](3);
        request.launchId = keccak256(abi.encode("ethereum-module-mode-canonical-stamp-fixture", p.tokenSalt));
        request.token = token;
        request.tokenRuntimeCodeHash = runtimeHashes[1];
        request.hookRuntimeCodeHash = runtimeHashes[2];
        request.poolKey = PoolKey(
            Currency.wrap(token < WETH ? token : WETH), Currency.wrap(token < WETH ? WETH : token), 0, 60, IHooks(hook)
        );
        request.components = new R.ComponentV1[](3);
        bytes32[] memory outputHashes = new bytes32[](3);
        for (uint8 i; i < 3; ++i) {
            route.expectedOutputs[i] = R.ExpectedGraphOutputV1(i, targets[i].targetIdHash, outputs[i], runtimeHashes[i]);
            outputHashes[i] =
                keccak256(abi.encode(OUTPUT_TYPEHASH, i, targets[i].targetIdHash, outputs[i], runtimeHashes[i]));
            request.components[i] = R.ComponentV1(
                i,
                outputs[i],
                runtimeHashes[i],
                i == 1 ? R.ComponentKindV1.Token : i == 2 ? R.ComponentKindV1.Hook : R.ComponentKindV1.Other,
                R.ComponentScopeV1.Exclusive
            );
        }
        for (uint256 i = 1; i < 3; ++i) {
            for (uint256 j = i; j > 0 && request.components[j].account < request.components[j - 1].account; --j) {
                R.ComponentV1 memory c = request.components[j - 1];
                request.components[j - 1] = request.components[j];
                request.components[j] = c;
            }
        }
        payload = abi.encode(route);
        permit = R.LaunchPermitV1(
            1,
            CANONICAL_ROUTER,
            ALICE,
            R.LaunchKindV1.CustomGraph,
            keccak256(payload),
            keccak256(abi.encode(RESULT_TYPEHASH, keccak256(abi.encodePacked(outputHashes)), graphHash)),
            stampRouter.computeStampRequestHash(request),
            authorization.routeNonce,
            uint64(block.timestamp),
            uint64(block.timestamp + 120),
            firstBuy
        );
    }

    function _authorizeOnlyOnFork(R.LaunchPermitV1 memory permit) internal {
        vm.mockCall(
            stampRouter.PERMIT_AUTHORITY(),
            abi.encodeCall(IERC1271.isValidSignature, (stampRouter.permitDigest(permit), hex"c0ffee")),
            abi.encode(IERC1271.isValidSignature.selector)
        );
    }

    function test_existingCanonicalStampIndexesModuleLaunchAndClassicMetadata() public {
        (R.LaunchPermitV1 memory permit, R.StampRequestV1 memory request, bytes memory payload, address engine) =
            _build(2, 0.005 ether);
        _authorizeOnlyOnFork(permit);
        bytes memory transactionData =
            abi.encodeCall(stampRouter.launchAndStampV1, (permit, request, payload, hex"c0ffee"));
        uint256 intrinsicGas = 21_000;
        for (uint256 i; i < transactionData.length; ++i) {
            intrinsicGas += transactionData[i] == 0 ? 4 : 16;
        }
        vm.prank(ALICE);
        uint256 gasBefore = gasleft();
        bytes32 stamp = stampRouter.launchAndStampV1{ value: permit.value }(permit, request, payload, hex"c0ffee");
        uint256 transactionGas = gasBefore - gasleft() + intrinsicGas;
        emit log_named_uint("Canonical Module launch gas including calldata", transactionGas);
        assertLt(transactionGas, 16_777_216, "Ethereum transaction gas cap");
        assertTrue(stamp != bytes32(0));
        assertEq(stampRouter.launchIdByToken(request.token), request.launchId);
        (bytes32 id, bytes32 proof) = stampRouter.stampProof(request.token);
        assertEq(id, request.launchId);
        assertEq(proof, stamp);
        assertEq(stampRouter.launchIdByComponent(engine), request.launchId);
        FoundationEthereumGraphLaunchV1 launcher = FoundationEthereumGraphLaunchV1(payable(engine));
        L.LaunchResultV2 memory r = launcher.launchOf(request.token);
        assertEq(FoundationHookV2(r.hook).creator(), ALICE);
        assertEq(FoundationHookV2(r.hook).moduleCount(), 2);
        assertEq(IERC20(request.token).balanceOf(ALICE), r.initialBuyTokenAmount);
        assertGt(r.initialBuyTokenAmount, 0);
        assertEq(FoundationLedgerV1(r.ledger).platformReceived(), permit.value * 30 / 10_000);
        (string memory description, string memory website, string memory image, bytes memory extra) =
            FoundationTokenV1(request.token).metadata();
        assertEq(description, "Immutable metadata in the Classic ABI");
        assertEq(website, "https://example.com");
        assertEq(image, "https://example.com/coin.webp");
        assertGt(extra.length, 0);
        if (vm.envOr("FOUNDATION_EXPORT_GRAPH_FIXTURE", false)) {
            emit log_named_bytes("module-graph-calldata", transactionData);
            emit log_named_address("module-graph-implementation", implementation);
            emit log_named_bytes32("module-graph-implementation-hash", implementation.codehash);
            emit log_named_bytes32("module-graph-proxy-hash", engine.codehash);
        }
        vm.expectRevert(FoundationFactoryV3.InvalidConfiguration.selector);
        vm.prank(ALICE);
        launcher.initializeGraph{ value: 0 }(
            P.LaunchParamsV3(
                T.Metadata("", "", "", "", "", bytes("")),
                WETH,
                18,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                bytes32(0),
                bytes32(0),
                new T.ModuleSelection[](0)
            ),
            request.token,
            r.hook,
            abi.encode(new PathKey[](0))
        );
    }

    function test_zeroInitialBuyIsCanonicallyStampedWithoutInventingClassicCustody() public {
        (R.LaunchPermitV1 memory permit, R.StampRequestV1 memory request, bytes memory payload, address engine) =
            _build(0, 0);
        _authorizeOnlyOnFork(permit);
        vm.prank(ALICE);
        bytes32 stamp = stampRouter.launchAndStampV1(permit, request, payload, hex"c0ffee");
        assertTrue(stamp != bytes32(0));
        L.LaunchResultV2 memory r = FoundationEthereumGraphLaunchV1(payable(engine)).launchOf(request.token);
        assertEq(r.initialBuyTokenAmount, 0);
        assertEq(r.basePositionOwner, DEAD);
        assertEq(r.roundingInventoryRecipient, DEAD);
    }

    function test_eightHeavyFixturesRequireGasBudgetRejection() public {
        (R.LaunchPermitV1 memory permit, R.StampRequestV1 memory request, bytes memory payload, address engine) =
            _build(8, 0.005 ether);
        _authorizeOnlyOnFork(permit);
        bytes memory data = abi.encodeCall(stampRouter.launchAndStampV1, (permit, request, payload, hex"c0ffee"));
        uint256 intrinsicGas = 21_000;
        for (uint256 i; i < data.length; ++i) {
            intrinsicGas += data[i] == 0 ? 4 : 16;
        }
        vm.prank(ALICE);
        uint256 gasBefore = gasleft();
        stampRouter.launchAndStampV1{ value: permit.value }(permit, request, payload, hex"c0ffee");
        uint256 transactionGas = gasBefore - gasleft() + intrinsicGas;
        emit log_named_uint("Eight module launch gas including calldata", transactionGas);
        // The fork permits a larger enclosing test transaction. The production wallet must
        // reject this measured estimate, rather than sign a transaction above EIP-7825.
        assertGt(transactionGas, 16_777_216, "heavy composition must be rejected before signing");
        assertEq(
            FoundationHookV2(FoundationEthereumGraphLaunchV1(payable(engine)).launchOf(request.token).hook)
                .moduleCount(),
            8
        );
    }

    function _buy(R.StampRequestV1 memory request, uint128 amount) internal {
        bytes[] memory actions = new bytes[](3);
        actions[0] = abi.encode(
            IV4Router.ExactInputSingleParams(
                request.poolKey, Currency.unwrap(request.poolKey.currency0) == WETH, amount, 1, 0, bytes("")
            )
        );
        actions[1] = abi.encode(Currency.wrap(WETH), amount, true);
        actions[2] = abi.encode(Currency.wrap(request.token), ALICE, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE)), actions
        );
        IFoundationUniversalRouterV2(ROUTER).execute(hex"10", inputs, block.timestamp + 60);
    }

    function test_realWalletCapCountsCreatorAndEnforcesEthereumBuysUntilExpiry() public {
        (R.LaunchPermitV1 memory permit, R.StampRequestV1 memory request, bytes memory payload, address engine) =
            _build(1, 0.005 ether);
        _authorizeOnlyOnFork(permit);
        vm.prank(ALICE);
        stampRouter.launchAndStampV1{ value: permit.value }(permit, request, payload, hex"c0ffee");
        L.LaunchResultV2 memory r = FoundationEthereumGraphLaunchV1(payable(engine)).launchOf(request.token);
        LaunchWalletCapV1 cap = LaunchWalletCapV1(FoundationHookV2(r.hook).moduleAt(0).instance);
        assertEq(cap.buyRouter(), ROUTER);
        assertEq(cap.purchasedTokens(ALICE), r.initialBuyTokenAmount);
        assertGt(r.initialBuyTokenAmount, 0);
        vm.startPrank(ALICE);
        IFoundationWrappedEth(WETH).deposit{ value: 2 ether }();
        IERC20(WETH).approve(PERMIT2, type(uint256).max);
        permits.approve(WETH, ROUTER, type(uint160).max, uint48(block.timestamp + 1 days));
        _buy(request, 0.001 ether);
        assertGt(cap.purchasedTokens(ALICE), r.initialBuyTokenAmount);
        uint256 beforeCount = cap.purchasedTokens(ALICE);
        uint256 beforeBalance = IERC20(request.token).balanceOf(ALICE);
        vm.expectRevert();
        _buy(request, 1 ether);
        assertEq(cap.purchasedTokens(ALICE), beforeCount);
        assertEq(IERC20(request.token).balanceOf(ALICE), beforeBalance);
        vm.warp(cap.protectionEndsAt());
        _buy(request, 1 ether);
        assertGt(IERC20(request.token).balanceOf(ALICE), beforeBalance);
        assertEq(cap.purchasedTokens(ALICE), beforeCount);
        vm.stopPrank();
    }

    function test_proxyAndImplementationCannotBeReinitializedOrSubstituted() public {
        (R.LaunchPermitV1 memory permit, R.StampRequestV1 memory request, bytes memory payload, address engine) =
            _build(0, 0);
        _authorizeOnlyOnFork(permit);
        vm.prank(ALICE);
        stampRouter.launchAndStampV1(permit, request, payload, hex"c0ffee");
        assertEq(FoundationEthereumGraphProxyV1(payable(engine)).implementation(), implementation);
        assertEq(FoundationEthereumGraphProxyV1(payable(engine)).implementationCodeHash(), implementation.codehash);
        assertEq(FoundationEthereumGraphLaunchV1(payable(implementation)).LAUNCH_WALLET(), implementation);
        assertEq(FoundationEthereumGraphLaunchV1(payable(engine)).LAUNCH_WALLET(), ALICE);
        for (uint256 i; i < 2; ++i) {
            vm.expectRevert(FoundationFactoryV3.InvalidConfiguration.selector);
            vm.prank(CANONICAL_GRAPH_FACTORY);
            FoundationEthereumGraphLaunchV1(payable(i == 0 ? engine : implementation))
                .initializeGraphWallet(address(0xbad));
        }
        vm.expectRevert(FoundationEthereumGraphProxyV1.InvalidImplementation.selector);
        vm.prank(CANONICAL_GRAPH_FACTORY);
        new FoundationEthereumGraphProxyV1(implementation, bytes32(uint256(1)), ALICE);
    }

    function test_missingAuthoritySignatureCannotCreateAStampOrCoin() public {
        (R.LaunchPermitV1 memory permit, R.StampRequestV1 memory request, bytes memory payload,) =
            _build(0, 0.005 ether);
        vm.expectRevert();
        vm.prank(ALICE);
        stampRouter.launchAndStampV1{ value: permit.value }(permit, request, payload, hex"dead");
        assertEq(request.token.code.length, 0);
        assertEq(stampRouter.launchIdByToken(request.token), bytes32(0));
    }

    function testEconomicStrategiesThroughCanonicalStamp() public {
        for (uint8 kind; kind < 4; ++kind) {
            uint256 snapshot = vm.snapshotState();
            _verifyEconomicStamp(kind, address(0));
            assertTrue(vm.revertToState(snapshot));
        }
    }

    function testEconomicRewardsThroughCanonicalStamp() public {
        for (uint8 kind = 4; kind < 7; ++kind) {
            uint256 snapshot = vm.snapshotState();
            _verifyEconomicStamp(kind, address(0));
            assertTrue(vm.revertToState(snapshot));
        }
    }

    function testEconomicGamesThroughCanonicalStamp() public {
        for (uint8 kind = 7; kind < 9; ++kind) {
            uint256 snapshot = vm.snapshotState();
            _verifyEconomicStamp(kind, address(0));
            assertTrue(vm.revertToState(snapshot));
        }
    }

    function testEconomicLinkedPoolsThroughCanonicalStamp() public {
        (R.LaunchPermitV1 memory permit, R.StampRequestV1 memory referenceRequest, bytes memory payload,) =
            _build(0, 0.005 ether);
        _authorizeOnlyOnFork(permit);
        vm.prank(ALICE);
        stampRouter.launchAndStampV1{ value: permit.value }(permit, referenceRequest, payload, hex"c0ffee");
        for (uint8 kind = 9; kind < 11; ++kind) {
            uint256 snapshot = vm.snapshotState();
            _verifyEconomicStamp(kind, address(referenceRequest.poolKey.hooks));
            assertTrue(vm.revertToState(snapshot));
        }
    }

    function _verifyEconomicStamp(uint8 kind, address referenceHost) internal {
        string[11] memory names = [
            "BuybackBurn",
            "DipBuyback",
            "LPRewards",
            "FullRangeLP",
            "BuyerRewards",
            "NthBuyPot",
            "KingOfTheHill",
            "HotPotato",
            "Plague",
            "ReactivePair",
            "Entangled"
        ];
        address released = EconomicReleaseFixtureV1.factory(vm, kind);
        IFoundationModuleFactoryV1 moduleFactory = IFoundationModuleFactoryV1(
            released == address(0)
                ? deployCode(string.concat("EconomicModuleFactoriesV1.sol:", names[kind], "FactoryV1"))
                : released
        );
        bytes memory configuration;
        if (kind < 4) {
            configuration = abi.encode(
                uint128(1), uint128(0.000_01 ether), uint32(30), uint32(300), uint16(500), uint16(kind == 1 ? 500 : 0)
            );
        } else if (kind < 7) {
            configuration = abi.encode(
                uint128(1), uint16(kind == 4 ? 100 : 0), uint32(kind == 5 ? 2 : 0), uint32(kind == 6 ? 300 : 0)
            );
        } else if (kind < 9) {
            configuration = abi.encode(uint128(1), uint32(kind == 7 ? 60 : 0));
        } else {
            configuration = abi.encode(
                referenceHost,
                uint16(kind == 9 ? 100 : 0),
                uint16(kind == 9 ? 10 : 0),
                uint16(kind == 9 ? 500 : 0),
                uint16(kind == 10 ? 100 : 0)
            );
        }
        address sample = moduleFactory.createModule(
            T.ModuleContext(address(this), address(1), WETH, ALICE, address(3), bytes32(uint256(1))), configuration
        );
        T.ModuleSelection[] memory selections = new T.ModuleSelection[](1);
        selections[0] = T.ModuleSelection(
            address(moduleFactory),
            address(moduleFactory).codehash,
            sample.codehash,
            keccak256(abi.encode(IFoundationModuleV1(sample).descriptor())),
            configuration,
            kind < 7 ? 10_000 : 0
        );
        EconomicReleaseFixtureV1.verify(vm, kind, selections[0]);
        (R.LaunchPermitV1 memory permit, R.StampRequestV1 memory request, bytes memory payload, address engine) =
            _buildWithModules(1, kind == 10 ? 0 : 0.005 ether, selections);
        _authorizeOnlyOnFork(permit);
        bytes memory data = abi.encodeCall(stampRouter.launchAndStampV1, (permit, request, payload, hex"c0ffee"));
        uint256 intrinsicGas = 21_000;
        for (uint256 i; i < data.length; ++i) {
            intrinsicGas += data[i] == 0 ? 4 : 16;
        }
        FoundationStampColdVm(address(vm)).cool(address(moduleFactory));
        vm.prank(ALICE);
        uint256 beforeGas = gasleft();
        bytes32 stamp = stampRouter.launchAndStampV1{ value: permit.value }(permit, request, payload, hex"c0ffee");
        uint256 used = beforeGas - gasleft() + intrinsicGas;
        emit log_named_uint(names[kind], used);
        assertLt(used, 16_777_216, "Economic module must fit the Ethereum transaction limit");
        assertTrue(stamp != bytes32(0));
        assertEq(stampRouter.launchIdByToken(request.token), request.launchId);
        L.LaunchResultV2 memory result = FoundationEthereumGraphLaunchV1(payable(engine)).launchOf(request.token);
        FoundationHookV2 host = FoundationHookV2(result.hook);
        assertEq(host.initializer(), engine);
        assertEq(host.creator(), ALICE);
        assertEq(host.moduleCount(), 1);
        assertEq(host.moduleAt(0).codeHash, sample.codehash);
        assertEq(IERC20(request.token).balanceOf(ALICE), result.initialBuyTokenAmount);
        assertEq(FoundationLedgerV1(result.ledger).platformReceived(), permit.value * 30 / 10_000);
        if (kind == 10) return; // Gate opening is exercised by the linked-pool lifecycle tests.
        vm.warp(block.timestamp + 300);
        vm.startPrank(ALICE);
        IFoundationWrappedEth(WETH).deposit{ value: 0.001 ether }();
        IERC20(WETH).approve(PERMIT2, type(uint256).max);
        permits.approve(WETH, ROUTER, type(uint160).max, uint48(block.timestamp + 1 days));
        _buy(request, 0.001 ether);
        vm.stopPrank();
        if (kind < 4 && kind != 1) {
            host.executeModuleAction(0, abi.encodePacked(bytes4(keccak256("execute()"))));
            assertGt(FeeStrategyV1(host.moduleAt(0).instance).totalQuoteUsed(), 0);
        }
    }
}
