// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

interface IAutomaticTestRouterV2 {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { BalanceDelta, BalanceDeltaLibrary } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { ProtectedLaunchTokenV1 } from "../../src/launch-protection/ProtectedLaunchTokenV1.sol";
import {
    ProtectedNativeInitializerV1,
    IProtectedLaunchHookV1,
    ILaunchUsdFeedV1
} from "../../src/launch-protection/ProtectedNativeInitializerV1.sol";
import {
    AutomaticProtectedNative30HookV2
} from "../../src/automatic-platform-fees-v2/AutomaticProtectedNative30HookV2.sol";
import { RobinhoodPlatformFeeRouterV1 } from "../../src/automatic-platform-fees-v1/RobinhoodPlatformFeeRouterV1.sol";

contract AutomaticHookV2ForkTest is Test {
    address constant TEAM = 0x9F5856A3578Faba96A6E8Dfd9C10563A1E598f62;

    function _launch(bool robinhood) private {
        vm.createSelectFork(
            robinhood ? "https://rpc.mainnet.chain.robinhood.com" : "https://ethereum-rpc.publicnode.com"
        );
        vm.deal(address(this), 1 ether);
        IPoolManager manager = IPoolManager(
            robinhood ? 0x8366a39CC670B4001A1121B8F6A443A643e40951 : 0x000000000004444c5dc75cB358380D2e3dE08A90
        );
        address swapRouter =
            robinhood ? 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99 : 0xd92A36B0000531EF3063dEd4De20A0783308446C;
        address feed =
            robinhood ? 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9 : 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;
        address recipientRouter = robinhood ? address(new RobinhoodPlatformFeeRouterV1(vm.addr(0xA11CE))) : address(0);
        bytes32 routerHash = robinhood ? recipientRouter.codehash : bytes32(0);
        ProtectedNativeInitializerV1 initializer =
            new ProtectedNativeInitializerV1(manager, address(this), ILaunchUsdFeedV1(feed), feed.codehash);
        ProtectedLaunchTokenV1 token = new ProtectedLaunchTokenV1(
            "Automatic fee proof", "AFEE", 1_000_000_000 ether, address(initializer), address(manager)
        );
        int24 tick = 180_120;
        AutomaticProtectedNative30HookV2.PoolConfig memory config = AutomaticProtectedNative30HookV2.PoolConfig(
            address(token),
            0,
            60,
            TickMath.getSqrtPriceAtTick(tick),
            address(initializer),
            address(this),
            0,
            0,
            address(0),
            0
        );
        address[6] memory exemptions;
        bytes memory args = abi.encode(
            manager, config, address(this), swapRouter, swapRouter.codehash, exemptions, recipientRouter, routerHash
        );
        (, bytes32 salt) =
            HookMiner.find(address(this), 0x20cc, type(AutomaticProtectedNative30HookV2).creationCode, args);
        AutomaticProtectedNative30HookV2 hook = new AutomaticProtectedNative30HookV2{ salt: salt }(
            manager, config, address(this), swapRouter, swapRouter.codehash, exemptions, recipientRouter, routerHash
        );
        uint256 beforeBalance = TEAM.balance;
        initializer.initialize{ value: 0.01 ether }(
            IProtectedLaunchHookV1(address(hook)), token, tick, address(this), 1
        );
        assertGt(token.balanceOf(address(this)), 0);
        assertEq(hook.feeVault().totalPlatformRecorded(), 0.000_03 ether);
        assertEq(hook.feeVault().totalPlatformPaid(), 0.000_03 ether);
        assertEq(hook.feeVault().platformAccrued(), 0);
        assertEq(TEAM.balance - beforeBalance, robinhood ? 0.000_006 ether : 0.000_03 ether);
        if (robinhood) {
            assertEq(RobinhoodPlatformFeeRouterV1(payable(recipientRouter)).buybackReserve(), 0.000_024 ether);
        }
        vm.warp(block.timestamp + 15);
        address buyer = address(0xB0B);
        vm.deal(buyer, 1 ether);
        uint256 nativeBefore = TEAM.balance;
        uint256 reserveBefore = robinhood ? RobinhoodPlatformFeeRouterV1(payable(recipientRouter)).buybackReserve() : 0;
        bytes[] memory params = new bytes[](3);
        params[0] = robinhood
            ? abi.encode(hook.poolKey(), true, uint128(0.001 ether), uint128(1), uint256(0), bytes(""))
            : abi.encode(hook.poolKey(), true, uint128(0.001 ether), uint128(1), bytes(""));
        params[1] = abi.encode(address(0), uint256(0.001 ether));
        params[2] = abi.encode(address(token), uint256(1));
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(hex"060c0f", params);
        inputs[1] = abi.encode(address(0), address(1), uint256(0));
        vm.prank(buyer, buyer);
        IAutomaticTestRouterV2(swapRouter).execute{ value: 0.001 ether }(hex"1004", inputs, block.timestamp + 1000);
        uint256 normal = hook.feeVault().totalPlatformRecorded() - 0.000_03 ether;
        uint256 opening = hook.openingTaxVault().totalPlatformRecorded();
        assertGt(normal, 0);
        assertGt(opening, 0);
        assertEq(hook.openingTaxVault().platformAccrued(), 0);
        assertEq(hook.openingTaxVault().totalPlatformPaid(), opening);
        assertEq(hook.openingTaxVault().creatorAccrued(), 0);
        if (robinhood) {
            uint256 allocated = RobinhoodPlatformFeeRouterV1(payable(recipientRouter)).buybackReserve() - reserveBefore;
            assertEq(TEAM.balance - nativeBefore + allocated, normal + opening);
            assertApproxEqAbs(allocated, (normal + opening) * 8000 / 10_000, 1);
        } else {
            assertEq(TEAM.balance - nativeBefore, normal + opening);
        }
    }

    function testEthereumActualPoolManagerDeliversDuringInitialSwap() public {
        _launch(false);
    }

    function testRobinhoodActualPoolManagerSplitsDuringInitialSwap() public {
        _launch(true);
    }
    receive() external payable { }
}
