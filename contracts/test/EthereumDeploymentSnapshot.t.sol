// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CurrentOfficialDeploymentSnapshot } from "./shared/CurrentOfficialDeploymentSnapshot.sol";

interface ILBPStrategyConfiguration {
    function poolManager() external view returns (address);
    function positionManager() external view returns (address);
    function initializerFactory() external view returns (address);
}

interface IContinuousClearingAuctionFactoryConfiguration {
    function protocolFeeController() external view returns (address);
}

contract EthereumDeploymentSnapshotTest is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_612_664;

    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant STATE_VIEW = 0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant LIQUIDITY_LAUNCHER = 0x00004c4ccc709Ef590F7C81102C0689F0263D4e9;
    address internal constant LBP_STRATEGY = 0x49380c4EfaB1b491006aF7FabAB8B3459F0E6000;
    address internal constant CCA_FACTORY = 0x000000001F26a0044BaA66024e7b6599c61963F8;
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
    }

    function test_officialRuntimeCodeMatchesPinnedSnapshot() public view {
        assertEq(
            POOL_MANAGER.codehash, 0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293, "PoolManager"
        );
        assertEq(
            POSITION_MANAGER.codehash,
            0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b,
            "PositionManager"
        );
        assertEq(STATE_VIEW.codehash, 0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878, "StateView");
        assertEq(PERMIT2.codehash, 0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131, "Permit2");
        assertEq(
            LIQUIDITY_LAUNCHER.codehash,
            0x672007315147b9202d825c5a4f5fed556179de55a89d8052f64d1c49ef366ed6,
            "LiquidityLauncher"
        );
        assertEq(
            LBP_STRATEGY.codehash, 0x4eb139800b68450186721d392545ee34ae38a749b83e9029825a480f139db0ec, "LBPStrategy"
        );
        assertEq(CCA_FACTORY.codehash, 0xa1d2a90564f4f63580b25de42efaff92505c254b00fc666f65ab38126cce5cfa, "CCAFactory");
        assertEq(
            UERC20_FACTORY.codehash, 0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb, "UERC20Factory"
        );
    }

    function test_officialAuctionStackMatchesLauncherPolicy() public view {
        ILBPStrategyConfiguration strategy = ILBPStrategyConfiguration(LBP_STRATEGY);
        assertEq(strategy.poolManager(), POOL_MANAGER, "LBP PoolManager");
        assertEq(strategy.positionManager(), POSITION_MANAGER, "LBP PositionManager");
        assertEq(strategy.initializerFactory(), CCA_FACTORY, "LBP initializer factory");
        assertEq(
            IContinuousClearingAuctionFactoryConfiguration(CCA_FACTORY).protocolFeeController(),
            address(0),
            "CCA protocol fee controller"
        );
    }
}

contract EthereumCurrentDeploymentSnapshotTest is CurrentOfficialDeploymentSnapshot {
    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        _selectCurrentSnapshot("./dependencies/ethereum-mainnet.json", rpc, 1, 13);
    }
}
