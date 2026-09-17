// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { DirectLiquidityLauncherV1 } from "../src/DirectLiquidityLauncherV1.sol";
import { BoundedDynamicFeeHookFactoryV1 } from "../src/BoundedDynamicFeeHookFactoryV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { PlatformFeeHookFactoryV1 } from "../src/PlatformFeeHookFactoryV1.sol";

/// @title DeploySepoliaInfrastructureV1
/// @notice Deploys Launcher’s permissionless factories and direct-liquidity entrypoint after validating dependencies.
/// @dev Use a configured Foundry account or hardware wallet. No private key is read by this script.
contract DeploySepoliaInfrastructureV1 is Script {
    uint256 internal constant SEPOLIA_CHAIN_ID = 11_155_111;

    address internal constant TEST_DEPLOYMENT_WALLET = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address internal constant PLATFORM_TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address internal constant STATE_VIEW = 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant LIQUIDITY_LAUNCHER = 0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0;
    address internal constant LBP_STRATEGY = 0x95434E898Af471945Cab33D5064d2aC1A6Ba2000;
    address internal constant CCA_FACTORY = 0x000000001F26a0044BaA66024e7b6599c61963F8;
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;

    bytes32 internal constant POOL_MANAGER_CODEHASH =
        0x09930125a49f5b95caf8052991cc14d1240dca8b43f42b899115b86867e4bce1;
    bytes32 internal constant POSITION_MANAGER_CODEHASH =
        0xcffd746f78c2b50aafd19076bbe9c48f14446e5248fc5d76b9b4896610e51aab;
    bytes32 internal constant STATE_VIEW_CODEHASH = 0xaaed3db8eb8ebde8014ce4c8a3938496687f4c6374e17a7d735288f6c65ceb9e;
    bytes32 internal constant PERMIT2_CODEHASH = 0x96d9f5c3f0fb0423426b7f970186235b7347027f4e5c19c40c412b7d97fc3751;
    bytes32 internal constant LIQUIDITY_LAUNCHER_CODEHASH =
        0x4a586d925c9d59ece13ce2239ebd7dea9ee725f9d33c6667e0fd16ae8d977d80;
    bytes32 internal constant LBP_STRATEGY_CODEHASH =
        0x077959d7cd725a2ec1c0e73acd47b38d5227a1a22e75a83d4dbf7905d7fff02f;
    bytes32 internal constant CCA_FACTORY_CODEHASH = 0xa1d2a90564f4f63580b25de42efaff92505c254b00fc666f65ab38126cce5cfa;
    bytes32 internal constant UERC20_FACTORY_CODEHASH =
        0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb;

    error UnexpectedBroadcaster(address actual, address expected);
    error UnexpectedChain(uint256 actual, uint256 expected);
    error UnexpectedCodeHash(address target, bytes32 actual, bytes32 expected);

    function run()
        external
        returns (
            PlatformFeeHookFactoryV1 platformFeeHookFactory,
            LockedPositionFeeForwarderFactoryV1 lockedPositionFeeForwarderFactory,
            DirectLiquidityLauncherV1 directLiquidityLauncher,
            BoundedDynamicFeeHookFactoryV1 boundedDynamicFeeHookFactory
        )
    {
        validateDependencies();

        address broadcaster = vm.envOr("LAUNCHER_TEST_DEPLOYER", TEST_DEPLOYMENT_WALLET);
        if (broadcaster != TEST_DEPLOYMENT_WALLET) {
            revert UnexpectedBroadcaster(broadcaster, TEST_DEPLOYMENT_WALLET);
        }

        vm.startBroadcast(broadcaster);
        platformFeeHookFactory = new PlatformFeeHookFactoryV1();
        lockedPositionFeeForwarderFactory = new LockedPositionFeeForwarderFactoryV1(IPositionManager(POSITION_MANAGER));
        directLiquidityLauncher = new DirectLiquidityLauncherV1(
            IPoolManager(POOL_MANAGER),
            IPositionManager(POSITION_MANAGER),
            UERC20Factory(UERC20_FACTORY),
            platformFeeHookFactory,
            lockedPositionFeeForwarderFactory,
            PLATFORM_TREASURY
        );
        boundedDynamicFeeHookFactory = new BoundedDynamicFeeHookFactoryV1();
        vm.stopBroadcast();
    }

    /// @notice Read-only preflight that fails closed if the selected chain or official bytecode drifts.
    function validateDependencies() public view {
        if (block.chainid != SEPOLIA_CHAIN_ID) {
            revert UnexpectedChain(block.chainid, SEPOLIA_CHAIN_ID);
        }

        _assertCodeHash(POOL_MANAGER, POOL_MANAGER_CODEHASH);
        _assertCodeHash(POSITION_MANAGER, POSITION_MANAGER_CODEHASH);
        _assertCodeHash(STATE_VIEW, STATE_VIEW_CODEHASH);
        _assertCodeHash(PERMIT2, PERMIT2_CODEHASH);
        _assertCodeHash(LIQUIDITY_LAUNCHER, LIQUIDITY_LAUNCHER_CODEHASH);
        _assertCodeHash(LBP_STRATEGY, LBP_STRATEGY_CODEHASH);
        _assertCodeHash(CCA_FACTORY, CCA_FACTORY_CODEHASH);
        _assertCodeHash(UERC20_FACTORY, UERC20_FACTORY_CODEHASH);
    }

    function _assertCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert UnexpectedCodeHash(target, actual, expected);
    }
}
