// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationForkBaseV2 } from "./FoundationCustodyV2.t.sol";
import { FoundationFactoryV2, IFoundationUniversalRouterV2 } from "../../src/module-foundation/FoundationFactoryV2.sol";
import {
    FoundationFactoryV2Native,
    IFoundationWrappedEth
} from "../../src/module-foundation/FoundationFactoryV2Native.sol";
import { FoundationTypesV1 as T } from "../../src/module-foundation/FoundationTypesV1.sol";
import { FoundationLaunchTypesV2 as L } from "../../src/module-foundation/FoundationLaunchTypesV2.sol";
import { FoundationHookV1 } from "../../src/module-foundation/FoundationHookV1.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

contract FoundationNativeV2Test is FoundationForkBaseV2 {
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    FoundationFactoryV2Native nativeFactory;

    function setUp() public override {
        super.setUp();
        bytes32[5] memory hashes =
            [MANAGER.codehash, POSM.codehash, ROUTER.codehash, PERMIT2.codehash, address(deployer).codehash];
        nativeFactory = FoundationFactoryV2Native(
            payable(deployCode(
                    "FoundationFactoryV2Native.sol:FoundationFactoryV2Native",
                    abi.encode(manager, positions, IFoundationUniversalRouterV2(ROUTER), permits, deployer, hashes)
                ))
        );
        factory = FoundationFactoryV2(address(nativeFactory));
        vm.deal(ALICE, 10 ether);
    }

    function _nativeParams(uint128 buy) internal returns (T.LaunchParams memory p) {
        p = _params(true, 200, 0, buy);
        p.quote = WETH;
        p.metadata.description = "";
        p.initialTick =
            WETH < factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata) ? int24(120_000) : int24(-120_000);
        _mine(p);
    }

    function test_nativeLaunchAndBuyRequiresNoWalletTokensOrApprovals() public {
        T.LaunchParams memory p = _nativeParams(0.005 ether);
        assertEq(IERC20(WETH).balanceOf(ALICE), 0);
        assertEq(IERC20(WETH).allowance(ALICE, address(factory)), 0);
        uint256 beforeEth = ALICE.balance;
        vm.prank(ALICE);
        L.LaunchResultV2 memory r = nativeFactory.launchWithEth{ value: 0.005 ether }(p, _zeroKey());
        assertEq(beforeEth - ALICE.balance, 0.005 ether);
        assertGt(r.initialBuyTokenAmount, 0);
        assertEq(IERC20(r.token).balanceOf(ALICE), r.initialBuyTokenAmount);
        assertEq(FoundationHookV1(r.hook).creator(), ALICE);
        assertEq(IERC721(POSM).ownerOf(r.basePositionId), factory.LP_RECIPIENT());
        assertEq(IERC20(WETH).balanceOf(ALICE), 0);
        assertEq(IERC20(WETH).allowance(ALICE, address(factory)), 0);
        assertEq(address(factory).balance, 0);
        assertEq(IERC20(WETH).balanceOf(address(factory)), 0);
        assertEq(IERC20(WETH).allowance(address(factory), PERMIT2), 0);
    }

    function test_refundsOnlyNewEthAndPreservesExistingFactoryBalances() public {
        T.LaunchParams memory p = _nativeParams(0.005 ether);
        vm.deal(address(factory), 3 ether);
        vm.deal(address(this), 1 ether);
        IFoundationWrappedEth(WETH).deposit{ value: 1 ether }();
        IERC20(WETH).transfer(address(factory), 1 ether);
        uint256 beforeEth = ALICE.balance;
        vm.prank(ALICE);
        nativeFactory.launchWithEth{ value: 0.007 ether }(p, _zeroKey());
        assertEq(beforeEth - ALICE.balance, 0.005 ether);
        assertEq(address(factory).balance, 3 ether);
        assertEq(IERC20(WETH).balanceOf(address(factory)), 1 ether);
    }

    function test_failedBuyRollsBackWrapCoinPoolAndEth() public {
        T.LaunchParams memory p = _nativeParams(0.005 ether);
        p.initialBuyMinimumTokenAmount = type(uint128).max;
        address token = factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata);
        uint256 beforeEth = ALICE.balance;
        vm.prank(ALICE);
        vm.expectRevert();
        nativeFactory.launchWithEth{ value: 0.005 ether }(p, _zeroKey());
        assertEq(ALICE.balance, beforeEth);
        assertEq(token.code.length, 0);
        assertEq(IERC20(WETH).balanceOf(address(factory)), 0);
        assertEq(IERC20(WETH).allowance(address(factory), PERMIT2), 0);
    }

    function test_insufficientValueAndWrongFundingPoolRevert() public {
        T.LaunchParams memory p = _nativeParams(0.005 ether);
        vm.prank(ALICE);
        vm.expectRevert(FoundationFactoryV2.InvalidConfiguration.selector);
        nativeFactory.launchWithEth{ value: 0.004 ether }(p, _zeroKey());
        PoolKey memory key = _zeroKey();
        key.fee = 3000;
        vm.prank(ALICE);
        vm.expectRevert(FoundationFactoryV2.InvalidConfiguration.selector);
        nativeFactory.launchWithEth{ value: 0.005 ether }(p, key);
    }

    function test_otherQuoteIsBoughtInternallyAndUnusedEthRefunded() public {
        PoolKey memory key = PoolKey(
            Currency.wrap(WETH < address(quote) ? WETH : address(quote)),
            Currency.wrap(WETH < address(quote) ? address(quote) : WETH),
            3000,
            60,
            IHooks(address(0))
        );
        manager.initialize(key, uint160(1 << 96));
        PoolModifyLiquidityTest seeder = new PoolModifyLiquidityTest(manager);
        vm.startPrank(ALICE);
        IFoundationWrappedEth(WETH).deposit{ value: 1 ether }();
        IERC20(WETH).approve(address(seeder), type(uint256).max);
        quote.approve(address(seeder), type(uint256).max);
        seeder.modifyLiquidity(key, ModifyLiquidityParams(-600, 600, int256(10 ether), bytes32(0)), bytes(""));
        IERC20(WETH).transfer(address(0x1234), IERC20(WETH).balanceOf(ALICE));
        quote.transfer(address(0x1234), quote.balanceOf(ALICE));
        vm.stopPrank();
        T.LaunchParams memory p = _params(true, 200, 0, 0.004 ether);
        uint256 beforeEth = ALICE.balance;
        vm.prank(ALICE);
        L.LaunchResultV2 memory r = nativeFactory.launchWithEth{ value: 0.005 ether }(p, key);
        assertGt(IERC20(r.token).balanceOf(ALICE), 0);
        assertEq(quote.balanceOf(ALICE), 0);
        assertGt(beforeEth - ALICE.balance, 0.004 ether);
        assertLt(beforeEth - ALICE.balance, 0.005 ether);
        assertEq(IERC20(WETH).balanceOf(address(factory)), 0);
        assertEq(address(factory).balance, 0);
        assertEq(IERC20(WETH).allowance(address(factory), PERMIT2), 0);
        assertEq(quote.allowance(address(factory), PERMIT2), 0);
    }

    function test_gasOnlyLaunchStillNeedsNoTokens() public {
        T.LaunchParams memory p = _nativeParams(0);
        vm.prank(ALICE);
        L.LaunchResultV2 memory r = factory.launch(p);
        assertEq(r.initialBuyTokenAmount, 0);
        assertEq(IERC20(WETH).balanceOf(ALICE), 0);
        assertGt(r.basePositionId, 0);
    }

    function test_changedWrappedEthCodeFailsBeforeDeployingAnything() public {
        T.LaunchParams memory p = _nativeParams(0.005 ether);
        vm.etch(WETH, hex"00");
        vm.prank(ALICE);
        vm.expectRevert(FoundationFactoryV2.InvalidConfiguration.selector);
        nativeFactory.launchWithEth{ value: 0.005 ether }(p, _zeroKey());
    }

    function testFuzz_nativeFundingAndRefundNeverTouchWalletWeth(uint96 buySeed, uint96 excessSeed) public {
        uint128 buy = uint128(bound(buySeed, 0.000_001 ether, 0.01 ether));
        uint256 excess = bound(excessSeed, 0, 1 ether);
        T.LaunchParams memory p = _nativeParams(buy);
        uint256 beforeEth = ALICE.balance;
        vm.prank(ALICE);
        L.LaunchResultV2 memory r = nativeFactory.launchWithEth{ value: buy + excess }(p, _zeroKey());
        assertEq(beforeEth - ALICE.balance, buy);
        assertEq(IERC20(WETH).balanceOf(ALICE), 0);
        assertEq(IERC20(WETH).allowance(ALICE, address(factory)), 0);
        assertEq(IERC20(r.token).balanceOf(ALICE), r.initialBuyTokenAmount);
        assertEq(address(factory).balance, 0);
        assertEq(IERC20(WETH).balanceOf(address(factory)), 0);
    }

    function _zeroKey() internal pure returns (PoolKey memory key) { }
}
