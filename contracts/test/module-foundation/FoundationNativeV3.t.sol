// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationForkBaseV3 } from "./FoundationDirectionalFeesV3.t.sol";
import { FoundationFactoryV3 } from "../../src/module-foundation/FoundationFactoryV3.sol";
import { IFoundationUniversalRouterV2 } from "../../src/module-foundation/FoundationFactoryV2.sol";
import { FoundationFactoryV3Native } from "../../src/module-foundation/FoundationFactoryV3Native.sol";
import { IFoundationWrappedEth } from "../../src/module-foundation/FoundationFactoryV2Native.sol";
import { FoundationLaunchTypesV3 as P } from "../../src/module-foundation/FoundationLaunchTypesV3.sol";
import { FoundationLedgerV1 } from "../../src/module-foundation/FoundationLedgerV1.sol";
import { FoundationLaunchTypesV2 as L } from "../../src/module-foundation/FoundationLaunchTypesV2.sol";
import { FoundationHookV2 } from "../../src/module-foundation/FoundationHookV2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { PathKey } from "@uniswap/v4-periphery-v211/src/libraries/PathKey.sol";
import { FoundationQuoteFixture } from "./FoundationFixturesV1.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

contract FoundationNativeV3Test is FoundationForkBaseV3 {
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    FoundationFactoryV3Native nativeFactory;

    function setUp() public override {
        super.setUp();
        bytes32[5] memory hashes =
            [MANAGER.codehash, POSM.codehash, ROUTER.codehash, PERMIT2.codehash, address(deployer).codehash];
        nativeFactory = FoundationFactoryV3Native(
            payable(deployCode(
                    "FoundationFactoryV3Native.sol:FoundationFactoryV3Native",
                    abi.encode(manager, positions, IFoundationUniversalRouterV2(ROUTER), permits, deployer, hashes)
                ))
        );
        factory = FoundationFactoryV3(address(nativeFactory));
        vm.deal(ALICE, 10 ether);
    }

    function _nativeParams(uint128 buy) internal returns (P.LaunchParamsV3 memory p) {
        p = _params(true, 200, 700, 0, buy);
        p.quote = WETH;
        p.metadata.description = "";
        p.initialTick =
            WETH < factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata) ? int24(120_000) : int24(-120_000);
        _mine(p);
    }

    function test_nativeLaunchAndBuyRequiresNoWalletTokensOrApprovals() public {
        P.LaunchParamsV3 memory p = _nativeParams(0.005 ether);
        assertEq(IERC20(WETH).balanceOf(ALICE), 0);
        assertEq(IERC20(WETH).allowance(ALICE, address(factory)), 0);
        uint256 beforeEth = ALICE.balance;
        vm.prank(ALICE);
        L.LaunchResultV2 memory r = nativeFactory.launchWithEthRoute{ value: 0.005 ether }(p, _emptyPath());
        assertEq(beforeEth - ALICE.balance, 0.005 ether);
        assertGt(r.initialBuyTokenAmount, 0);
        assertEq(IERC20(r.token).balanceOf(ALICE), r.initialBuyTokenAmount);
        assertEq(FoundationHookV2(r.hook).creator(), ALICE);
        assertEq(FoundationHookV2(r.hook).creatorBuyFeeBps(), 200);
        assertEq(FoundationHookV2(r.hook).creatorSellFeeBps(), 700);
        assertEq(FoundationLedgerV1(r.ledger).creatorReceived(), 0.005 ether * 200 / 10_000);
        assertEq(FoundationLedgerV1(r.ledger).platformReceived(), 0.005 ether * 30 / 10_000);
        assertEq(IERC721(POSM).ownerOf(r.basePositionId), factory.LP_RECIPIENT());
        assertEq(IERC20(WETH).balanceOf(ALICE), 0);
        assertEq(IERC20(WETH).allowance(ALICE, address(factory)), 0);
        assertEq(address(factory).balance, 0);
        assertEq(IERC20(WETH).balanceOf(address(factory)), 0);
        assertEq(IERC20(WETH).allowance(address(factory), PERMIT2), 0);
    }

    function test_refundsOnlyNewEthAndPreservesExistingFactoryBalances() public {
        P.LaunchParamsV3 memory p = _nativeParams(0.005 ether);
        vm.deal(address(factory), 3 ether);
        vm.deal(address(this), 1 ether);
        IFoundationWrappedEth(WETH).deposit{ value: 1 ether }();
        IERC20(WETH).transfer(address(factory), 1 ether);
        uint256 beforeEth = ALICE.balance;
        vm.prank(ALICE);
        nativeFactory.launchWithEthRoute{ value: 0.007 ether }(p, _emptyPath());
        assertEq(beforeEth - ALICE.balance, 0.005 ether);
        assertEq(address(factory).balance, 3 ether);
        assertEq(IERC20(WETH).balanceOf(address(factory)), 1 ether);
    }

    function test_failedBuyRollsBackWrapCoinPoolAndEth() public {
        P.LaunchParamsV3 memory p = _nativeParams(0.005 ether);
        p.initialBuyMinimumTokenAmount = type(uint128).max;
        address token = factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata);
        uint256 beforeEth = ALICE.balance;
        vm.prank(ALICE);
        vm.expectRevert();
        nativeFactory.launchWithEthRoute{ value: 0.005 ether }(p, _emptyPath());
        assertEq(ALICE.balance, beforeEth);
        assertEq(token.code.length, 0);
        assertEq(IERC20(WETH).balanceOf(address(factory)), 0);
        assertEq(IERC20(WETH).allowance(address(factory), PERMIT2), 0);
    }

    function test_insufficientValueAndWrongFundingPoolRevert() public {
        P.LaunchParamsV3 memory p = _nativeParams(0.005 ether);
        vm.prank(ALICE);
        vm.expectRevert(FoundationFactoryV3.InvalidConfiguration.selector);
        nativeFactory.launchWithEthRoute{ value: 0.004 ether }(p, _emptyPath());
        PathKey[] memory wrong = new PathKey[](1);
        wrong[0] = PathKey(Currency.wrap(address(0)), 3000, 60, IHooks(address(0)), bytes(""));
        vm.prank(ALICE);
        vm.expectRevert(FoundationFactoryV3.InvalidConfiguration.selector);
        nativeFactory.launchWithEthRoute{ value: 0.005 ether }(p, abi.encode(wrong));
    }

    function test_otherQuoteIsBoughtInternallyAndUnusedEthRefunded() public {
        _otherQuoteFunding(0);
    }

    function test_fixedInfinitePermit2QuoteNeedsNoExplicitTokenApproval() public {
        quote = new FoundationFixedPermit2QuoteFixtureV3();
        quote.mint(ALICE, 1_000_000 ether);
        _otherQuoteFunding(type(uint256).max);
    }

    function _otherQuoteFunding(uint256 expectedTokenAllowance) internal {
        PoolKey memory key =
            PoolKey(Currency.wrap(address(0)), Currency.wrap(address(quote)), 3000, 60, IHooks(address(0)));
        manager.initialize(key, uint160(1 << 96));
        PoolModifyLiquidityTest seeder = new PoolModifyLiquidityTest(manager);
        vm.startPrank(ALICE);
        quote.approve(address(seeder), type(uint256).max);
        seeder.modifyLiquidity{ value: 1 ether }(
            key, ModifyLiquidityParams(-600, 600, int256(10 ether), bytes32(0)), bytes("")
        );
        quote.transfer(address(0x1234), quote.balanceOf(ALICE));
        vm.stopPrank();
        PathKey[] memory path = new PathKey[](1);
        path[0] = PathKey(Currency.wrap(address(0)), key.fee, key.tickSpacing, key.hooks, bytes(""));
        vm.deal(ROUTER, 3 ether);
        vm.deal(address(factory), 2 ether);
        P.LaunchParamsV3 memory p = _params(true, 200, 700, 0, 0.004 ether);
        uint256 beforeEth = ALICE.balance;
        vm.prank(ALICE);
        L.LaunchResultV2 memory r = nativeFactory.launchWithEthRoute{ value: 0.005 ether }(p, abi.encode(path));
        assertGt(IERC20(r.token).balanceOf(ALICE), 0);
        assertEq(quote.balanceOf(ALICE), 0);
        assertGt(beforeEth - ALICE.balance, 0.004 ether);
        assertLt(beforeEth - ALICE.balance, 0.005 ether);
        assertEq(IERC20(WETH).balanceOf(address(factory)), 0);
        assertEq(address(factory).balance, 2 ether);
        assertEq(ROUTER.balance, 3 ether);
        assertEq(IERC20(WETH).allowance(address(factory), PERMIT2), 0);
        assertEq(quote.allowance(address(factory), PERMIT2), expectedTokenAllowance);
        (uint160 remaining,,) = permits.allowance(address(factory), address(quote), ROUTER);
        assertEq(remaining, 0);
    }

    function test_gasOnlyLaunchStillNeedsNoTokens() public {
        P.LaunchParamsV3 memory p = _nativeParams(0);
        vm.prank(ALICE);
        L.LaunchResultV2 memory r = factory.launch(p);
        assertEq(r.initialBuyTokenAmount, 0);
        assertEq(IERC20(WETH).balanceOf(ALICE), 0);
        assertGt(r.basePositionId, 0);
    }

    function test_nativeMultiHopFundingAndBudgetFailureAreAtomic() public {
        FoundationQuoteFixture bridge = new FoundationQuoteFixture(18);
        bridge.mint(ALICE, 100 ether);
        PoolKey memory first =
            PoolKey(Currency.wrap(address(0)), Currency.wrap(address(bridge)), 3000, 60, IHooks(address(0)));
        PoolKey memory last = PoolKey(
            Currency.wrap(address(bridge) < address(quote) ? address(bridge) : address(quote)),
            Currency.wrap(address(bridge) < address(quote) ? address(quote) : address(bridge)),
            3000,
            60,
            IHooks(address(0))
        );
        manager.initialize(first, uint160(1 << 96));
        manager.initialize(last, uint160(1 << 96));
        PoolModifyLiquidityTest seeder = new PoolModifyLiquidityTest(manager);
        vm.startPrank(ALICE);
        bridge.approve(address(seeder), type(uint256).max);
        quote.approve(address(seeder), type(uint256).max);
        seeder.modifyLiquidity{ value: 1 ether }(
            first, ModifyLiquidityParams(-600, 600, int256(10 ether), bytes32(0)), bytes("")
        );
        seeder.modifyLiquidity(last, ModifyLiquidityParams(-600, 600, int256(10 ether), bytes32(0)), bytes(""));
        bridge.transfer(BOB, bridge.balanceOf(ALICE));
        quote.transfer(BOB, quote.balanceOf(ALICE));
        vm.stopPrank();
        PathKey[] memory path = new PathKey[](2);
        path[0] = PathKey(Currency.wrap(address(0)), first.fee, first.tickSpacing, first.hooks, bytes(""));
        path[1] = PathKey(Currency.wrap(address(bridge)), last.fee, last.tickSpacing, last.hooks, bytes(""));
        P.LaunchParamsV3 memory p = _params(true, 200, 700, 0, 0.004 ether);
        address predicted = factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata);
        uint256 beforeEth = ALICE.balance;
        vm.prank(ALICE);
        vm.expectRevert();
        nativeFactory.launchWithEthRoute{ value: 0.003 ether }(p, abi.encode(path));
        assertEq(ALICE.balance, beforeEth);
        assertEq(predicted.code.length, 0);
        vm.prank(ALICE);
        L.LaunchResultV2 memory r = nativeFactory.launchWithEthRoute{ value: 0.005 ether }(p, abi.encode(path));
        assertEq(r.token, predicted);
        assertGt(r.initialBuyTokenAmount, 0);
        assertGt(beforeEth - ALICE.balance, 0.004 ether);
        assertLt(beforeEth - ALICE.balance, 0.005 ether);
        assertEq(bridge.balanceOf(ALICE), 0);
        assertEq(quote.balanceOf(ALICE), 0);
        assertEq(bridge.balanceOf(address(factory)), 0);
        assertEq(quote.balanceOf(address(factory)), 0);
        assertEq(address(factory).balance, 0);
    }

    function test_changedWrappedEthCodeFailsBeforeDeployingAnything() public {
        P.LaunchParamsV3 memory p = _nativeParams(0.005 ether);
        vm.etch(WETH, hex"00");
        vm.prank(ALICE);
        vm.expectRevert(FoundationFactoryV3.InvalidConfiguration.selector);
        nativeFactory.launchWithEthRoute{ value: 0.005 ether }(p, _emptyPath());
    }

    function _emptyPath() internal pure returns (bytes memory) {
        return abi.encode(new PathKey[](0));
    }
}

contract FoundationFixedPermit2QuoteFixtureV3 is FoundationQuoteFixture {
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    constructor() FoundationQuoteFixture(18) { }

    function allowance(address owner, address spender) public view override returns (uint256) {
        return spender == PERMIT2 ? type(uint256).max : super.allowance(owner, spender);
    }

    function approve(address spender, uint256 amount) public override returns (bool) {
        require(spender != PERMIT2, "Permit2 allowance is already fixed");
        return super.approve(spender, amount);
    }
}
