// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { RobinhoodPlatformFeeRouterV1 } from "../../src/automatic-platform-fees-v1/RobinhoodPlatformFeeRouterV1.sol";

/// @dev Read-only upstream fork. Every deployment, deposit and swap is local to this test EVM.
contract RobinhoodPlatformFeesForkTest is Test {
    using StateLibrary for IPoolManager;
    uint256 private constant SIGNER_KEY = 0xA11CE;
    address private constant TEAM = 0x9F5856A3578Faba96A6E8Dfd9C10563A1E598f62;
    address private constant V4 = 0xC60bA256B44334A0Cd2C7242E98B88f031abB006;
    RobinhoodPlatformFeeRouterV1 router;

    function setUp() public {
        vm.createSelectFork("https://rpc.mainnet.chain.robinhood.com");
        vm.deal(address(this), 1 ether);
        router = new RobinhoodPlatformFeeRouterV1(vm.addr(SIGNER_KEY));
    }

    function _deposit(uint256 value) private {
        (bool paid,) = address(router).call{ value: value }("");
        assertTrue(paid);
    }

    function _order(uint128 value) private view returns (RobinhoodPlatformFeeRouterV1.BuybackOrder memory) {
        (uint160 price, int24 tick,,) = router.POOL_MANAGER().getSlot0(PoolId.wrap(router.MAIN_POOL_ID()));
        uint256 ratioX96 = FullMath.mulDiv(price, price, uint256(1) << 96);
        uint128 minOut = uint128(FullMath.mulDiv(FullMath.mulDiv(value, 97, 100), ratioX96, uint256(1) << 96));
        return RobinhoodPlatformFeeRouterV1.BuybackOrder(
            router.nextNonce(),
            value,
            minOut,
            TickMath.getSqrtPriceAtTick(tick - 200),
            uint64(block.timestamp),
            uint64(block.timestamp + 60)
        );
    }

    function _signature(RobinhoodPlatformFeeRouterV1.BuybackOrder memory order) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, router.orderDigest(order));
        return abi.encodePacked(r, s, v);
    }

    function testLivePoolForkPaysTeamAndBuysV4WithoutClaiming() public {
        uint256 ethBefore = TEAM.balance;
        _deposit(10_000_000_000);
        assertEq(router.buybackReserve(), 8_000_000_000);
        assertEq(TEAM.balance - ethBefore, 2_000_000_000);
        uint256 tokenBefore = IERC20(V4).balanceOf(TEAM);
        RobinhoodPlatformFeeRouterV1.BuybackOrder memory order = _order(8_000_000_000);
        bytes memory signature = _signature(order);
        vm.prank(address(0xB0B));
        uint256 delivered = router.executeBuyback(order, signature);
        assertGe(delivered, order.minimumOut);
        assertEq(IERC20(V4).balanceOf(TEAM) - tokenBefore, delivered);
        assertEq(router.buybackReserve(), 0);
        assertEq(router.nativeReserve(), 0);
        assertEq(address(router).balance, 0);
        vm.expectRevert(RobinhoodPlatformFeeRouterV1.InvalidOrder.selector);
        router.executeBuyback(order, signature);
    }

    function testDustDepositsCannotChangeEightyTwentySplit() public {
        uint256 ethBefore = TEAM.balance;
        for (uint256 i; i < 10; ++i) {
            _deposit(1);
        }
        assertEq(router.buybackReserve(), 8);
        assertEq(router.totalRevenue(), 10);
        assertEq(TEAM.balance - ethBefore, 2);
    }

    function testRevertingMinimumPreservesEntireBuybackReserve() public {
        _deposit(10_000_000_000);
        RobinhoodPlatformFeeRouterV1.BuybackOrder memory order = _order(8_000_000_000);
        order.minimumOut = type(uint128).max;
        bytes memory signature = _signature(order);
        vm.expectRevert(RobinhoodPlatformFeeRouterV1.InvalidSettlement.selector);
        router.executeBuyback(order, signature);
        assertEq(router.buybackReserve(), 8_000_000_000);
        assertEq(router.nextNonce(), 0);
        assertEq(address(router).balance, 8_000_000_000);
    }
}
