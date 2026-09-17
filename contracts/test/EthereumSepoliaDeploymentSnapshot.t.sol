// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CurrentOfficialDeploymentSnapshot } from "./shared/CurrentOfficialDeploymentSnapshot.sol";

import { DirectLiquidityLauncherV1 } from "../src/DirectLiquidityLauncherV1.sol";
import { BoundedDynamicFeeHookFactoryV1 } from "../src/BoundedDynamicFeeHookFactoryV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { PlatformFeeHookFactoryV1 } from "../src/PlatformFeeHookFactoryV1.sol";

contract EthereumSepoliaDeploymentSnapshotTest is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 11_353_915;

    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address internal constant STATE_VIEW = 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant LIQUIDITY_LAUNCHER = 0x00004c4ccc709Ef590F7C81102C0689F0263D4e9;
    address internal constant LBP_STRATEGY = 0x96641d91e223c766F45b19d09494F5925C3cE000;
    address internal constant CCA_FACTORY = 0x000000001F26a0044BaA66024e7b6599c61963F8;
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;
    address internal constant PLATFORM_TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    address internal constant PLATFORM_FEE_HOOK_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;
    address internal constant LOCKED_POSITION_FACTORY = 0xaE3C324B742a7576863A546120c4280b7c9E8448;
    address internal constant DIRECT_LIQUIDITY_LAUNCHER = 0x5fc6aDd062329742EFefA9c4b11C355AAe02Fa1E;
    address internal constant BOUNDED_DYNAMIC_FEE_FACTORY = 0x51d702731db281EE223904A4663E05BfCA26C775;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string("https://sepolia.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
    }

    function test_officialRuntimeCodeMatchesPinnedSnapshot() public view {
        assertEq(
            POOL_MANAGER.codehash, 0x09930125a49f5b95caf8052991cc14d1240dca8b43f42b899115b86867e4bce1, "PoolManager"
        );
        assertEq(
            POSITION_MANAGER.codehash,
            0xcffd746f78c2b50aafd19076bbe9c48f14446e5248fc5d76b9b4896610e51aab,
            "PositionManager"
        );
        assertEq(STATE_VIEW.codehash, 0xaaed3db8eb8ebde8014ce4c8a3938496687f4c6374e17a7d735288f6c65ceb9e, "StateView");
        assertEq(PERMIT2.codehash, 0x96d9f5c3f0fb0423426b7f970186235b7347027f4e5c19c40c412b7d97fc3751, "Permit2");
        assertEq(
            LIQUIDITY_LAUNCHER.codehash,
            0x672007315147b9202d825c5a4f5fed556179de55a89d8052f64d1c49ef366ed6,
            "LiquidityLauncher"
        );
        assertEq(
            LBP_STRATEGY.codehash, 0x273ab7765154c688e0105fed1d25c6861efd2f11ad0be5806d7592cfd723341c, "LBPStrategy"
        );
        assertEq(CCA_FACTORY.codehash, 0xa1d2a90564f4f63580b25de42efaff92505c254b00fc666f65ab38126cce5cfa, "CCAFactory");
        assertEq(
            UERC20_FACTORY.codehash, 0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb, "UERC20Factory"
        );
    }

    function test_launcherRuntimeAndConfigurationMatchPinnedDeployment() public view {
        assertEq(
            PLATFORM_FEE_HOOK_FACTORY.codehash,
            0x7792dba76c190e746dc7fbf7f8a8f690f7cf5ce6fab448c858069b1852974306,
            "PlatformFeeHookFactoryV1"
        );
        assertEq(
            LOCKED_POSITION_FACTORY.codehash,
            0x49e040806b0664b2fa4f41c5abc11241cdb8f847c538c13d6874c32804b74ebc,
            "LockedPositionFeeForwarderFactoryV1"
        );
        assertEq(
            DIRECT_LIQUIDITY_LAUNCHER.codehash,
            0x41fa4dbe9709e93f601e0406a3a9d61826144ca56e16f748e063f850fc0af48b,
            "DirectLiquidityLauncherV1"
        );
        assertEq(
            BOUNDED_DYNAMIC_FEE_FACTORY.codehash,
            0xe6bbbdba0194caba268f5546db2574dc416b3c74331bd44f33d04d4b2251ffbc,
            "BoundedDynamicFeeHookFactoryV1"
        );

        LockedPositionFeeForwarderFactoryV1 positionFactory =
            LockedPositionFeeForwarderFactoryV1(LOCKED_POSITION_FACTORY);
        DirectLiquidityLauncherV1 directLauncher = DirectLiquidityLauncherV1(payable(DIRECT_LIQUIDITY_LAUNCHER));

        assertEq(address(positionFactory.positionManager()), POSITION_MANAGER);
        assertEq(positionFactory.OPERATOR(), address(0));
        assertEq(positionFactory.TIMELOCK_BLOCK(), type(uint256).max);
        assertEq(address(directLauncher.poolManager()), POOL_MANAGER);
        assertEq(address(directLauncher.positionManager()), POSITION_MANAGER);
        assertEq(address(directLauncher.tokenFactory()), UERC20_FACTORY);
        assertEq(address(directLauncher.hookFactory()), PLATFORM_FEE_HOOK_FACTORY);
        assertEq(address(directLauncher.positionForwarderFactory()), LOCKED_POSITION_FACTORY);
        assertEq(directLauncher.platformFeeRecipient(), PLATFORM_TREASURY);
        assertEq(directLauncher.TOKEN_DECIMALS(), 18);
        assertEq(PlatformFeeHookFactoryV1(PLATFORM_FEE_HOOK_FACTORY).ALL_HOOK_MASK(), (1 << 14) - 1);
        assertEq(PlatformFeeHookFactoryV1(PLATFORM_FEE_HOOK_FACTORY).REQUIRED_HOOK_FLAGS(), 8260);
        assertEq(BoundedDynamicFeeHookFactoryV1(BOUNDED_DYNAMIC_FEE_FACTORY).ALL_HOOK_MASK(), (1 << 14) - 1);
        assertEq(BoundedDynamicFeeHookFactoryV1(BOUNDED_DYNAMIC_FEE_FACTORY).REQUIRED_HOOK_FLAGS(), 12_484);
    }
}

contract EthereumSepoliaCurrentDeploymentSnapshotTest is CurrentOfficialDeploymentSnapshot {
    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string("https://sepolia.drpc.org"));
        _selectCurrentSnapshot("./dependencies/ethereum-sepolia.json", rpc, 11_155_111, 11);
    }
}
