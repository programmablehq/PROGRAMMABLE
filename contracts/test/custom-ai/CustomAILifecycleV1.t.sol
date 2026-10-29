// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { SwapParams, ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { MockV4Router } from "@uniswap/v4-periphery/test/mocks/MockV4Router.sol";
import { V4Quoter } from "@uniswap/v4-periphery/src/lens/V4Quoter.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { IV4Router } from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { CustomAITypesV1 as T } from "../../src/custom-ai/CustomAITypesV1.sol";
import { CustomAIFeeMathV1 as F } from "../../src/custom-ai/CustomAIFeeMathV1.sol";
import { CustomAIPriceV1 as P } from "../../src/custom-ai/CustomAIPriceV1.sol";
import { CustomAIFactoryV1 } from "../../src/custom-ai/CustomAIFactoryV1.sol";
import { CustomAITokenV1 } from "../../src/custom-ai/CustomAITokenV1.sol";
import { CustomAIHookV1 } from "../../src/custom-ai/CustomAIHookV1.sol";
import { CustomAIHookDeployerV1 } from "../../src/custom-ai/CustomAIHookDeployerV1.sol";
import { CustomAILiquidityDeployerV1 } from "../../src/custom-ai/CustomAILiquidityDeployerV1.sol";
import { CustomAILiquidityVaultV1 } from "../../src/custom-ai/CustomAILiquidityVaultV1.sol";
import { CustomAISwapRouterV1 } from "../../src/custom-ai/CustomAISwapRouterV1.sol";
import { CustomAIFeeLedgerV1 } from "../../src/custom-ai/CustomAIFeeLedgerV1.sol";
import { CustomAIRewardVaultV1 } from "../../src/custom-ai/CustomAIRewardVaultV1.sol";
import { ICustomAIFeeModuleV1 } from "../../src/custom-ai/ICustomAIFeeModuleV1.sol";
import { IVenuePolicy } from "../../src/custom-ai/IVenuePolicy.sol";
import { CustomAIProgramV1 } from "../../src/custom-ai/CustomAIProgramV1.sol";
import { CustomAIDataFeedV1 } from "../../src/custom-ai/CustomAIDataFeedV1.sol";
import { CustomAIThresholdFeeModuleV1 } from "../../src/custom-ai/CustomAIThresholdFeeModuleV1.sol";
import { RewardProposalFixture } from "./CustomAIRewardsAndDataV1.t.sol";

import { CustomAIProgramRouterV1 } from "../../src/custom-ai/CustomAIProgramRouterV1.sol";
import { CustomAILiquidityProgramV1 } from "../../src/custom-ai/CustomAILiquidityProgramV1.sol";
import { CustomAIExecutionPriceFeedV1 } from "../../src/custom-ai/CustomAIExecutionPriceFeedV1.sol";

import { CustomAIProgramFactoryV1 } from "../../src/custom-ai/CustomAIProgramFactoryV1.sol";
import { CustomAIProgramTypesV1 as PT } from "../../src/custom-ai/CustomAIProgramTypesV1.sol";
import {
    CustomAIProgramRouterDeployerV1,
    CustomAILiquidityProgramDeployerV1,
    CustomAIFundedProgramDeployerV1
} from "../../src/custom-ai/CustomAIProgramDeployersV1.sol";

contract LifecycleQuote is ERC20 {
    uint8 private immutable _decimals;
    bool public taxed;
    address public reentryTarget;
    bytes public reentryData;
    bool public attempted;
    bool public succeeded;

    constructor(uint8 d) ERC20("Quote fixture", "Q") {
        _decimals = d;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTaxed(bool value) external {
        taxed = value;
    }

    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (reentryTarget != address(0) && from != address(0)) {
            attempted = true;
            (succeeded,) = reentryTarget.call(reentryData);
        }
        uint256 tax = taxed && from != address(0) && to != address(0) ? amount / 100 : 0;
        super._update(from, to, amount - tax);
        if (tax != 0) super._update(from, address(0), tax);
    }
}

contract LifecycleFeeModule is ICustomAIFeeModuleV1 {
    bytes32 public constant CONFIG = keccak256("lifecycle-fixture");
    uint16 public extra = 500;
    uint8 public mode;
    int24 public initialTick;
    IPoolManager public immutable manager;

    constructor(IPoolManager m) {
        manager = m;
    }

    function configure(uint16 fee, uint8 mode_, int24 tick) external {
        extra = fee;
        mode = mode_;
        initialTick = tick;
    }

    function quoteFee(T.SwapContext calldata context) external view returns (bytes4, uint16, uint64, bytes32) {
        if (mode == 1) revert("module unavailable");
        uint16 fee = extra;
        if (mode == 2) {
            (, int24 tick,,) = StateLibrary.getSlot0(manager, PoolId.wrap(context.poolId));
            if (tick != initialTick) fee = 1200;
        }
        if (mode == 3) {
            while (gasleft() > 100) { }
            revert();
        }
        return (this.quoteFee.selector, fee, mode == 4 ? 0 : type(uint64).max, CONFIG);
    }
}

contract ComposableFeeFixture is LifecycleFeeModule {
    constructor(IPoolManager m) LifecycleFeeModule(m) { }

    function actionState(bytes32, uint64) external view returns (bool, bytes32, uint64) {
        return (true, keccak256("rain-event"), uint64(block.timestamp));
    }
}

contract CustomAILifecycleV1Test is Test {
    uint256 private constant SIGNER_KEY = 0x123456;
    address private constant CREATOR_FEE = address(0xc0ffee);
    address private constant OTHER = address(0xabc123);
    IPoolManager private manager;
    CustomAIHookDeployerV1 private deployer;
    CustomAILiquidityDeployerV1 private lpDeployer;
    CustomAISwapRouterV1 private router;
    CustomAIFactoryV1 private factory;
    LifecycleQuote private quote;
    LifecycleFeeModule private module;
    T.LaunchParams private params;
    T.Price private price;
    bytes private signature;
    T.LaunchResult private launched;
    PoolKey private key;
    MockV4Router private upstream;
    V4Quoter private quoter;

    function setUp() public {
        vm.warp(1_000_000);
        manager = new PoolManager(address(this));
        deployer = new CustomAIHookDeployerV1();
        lpDeployer = new CustomAILiquidityDeployerV1();
        router = new CustomAISwapRouterV1(manager);
        factory = new CustomAIFactoryV1(manager, deployer, lpDeployer, router, vm.addr(SIGNER_KEY));
        quote = new LifecycleQuote(18);
        module = new LifecycleFeeModule(manager);
        quote.mint(address(this), 1_000_000 ether);
        quote.approve(address(factory), type(uint256).max);
        quote.approve(address(router), type(uint256).max);
        params.metadata = T.Metadata("Custom AI", "CAI", "Core lifecycle", "ipfs://image", "", "");
        params.quote = address(quote);
        params.quoteDecimals = 18;
        params.launchSalt = keccak256("first");
        params.feeModule = T.ModuleBinding(address(module), address(module).codehash, module.CONFIG());
        params.rewards.creatorRecipient = CREATOR_FEE;
        params.rewards.creatorShareBps = 10_000;
        params.maximumFeeBps = 1500;
        params.deadline = uint64(block.timestamp + 120);
        price = T.Price(1 ether, 3000 ether, uint64(block.timestamp), uint64(block.timestamp + 120));
        _prepare();
    }

    function _prepare() private {
        params.initialBuyQuote = uint128(P.minimumInitialBuy(params.quoteDecimals, price));
        params.minimumBuyTokens = 1;
        if (quote.balanceOf(address(this)) < params.initialBuyQuote) quote.mint(address(this), params.initialBuyQuote);
        quote.approve(address(factory), type(uint256).max);
        address token = factory.predictTokenAddress(address(this), params);
        int24 magnitude = params.quoteDecimals == 6 ? int24(387_360) : int24(111_060);
        params.initialTick = token < params.quote ? -magnitude : magnitude;
        bytes32 initHash = deployer.initCodeHash(
            manager, address(factory), token, params.quote, params.initialTick, params.feeModule, params.rewards
        );
        for (uint256 i; i < 1_000_000; ++i) {
            bytes32 salt = bytes32(i);
            address predicted =
                address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(deployer), salt, initHash)))));
            if (uint160(predicted) & 16_383 == 8396) {
                params.hookSalt = salt;
                _sign();
                return;
            }
        }
        revert("salt search failed");
    }

    function _sign() private {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(SIGNER_KEY, factory.priceDigest(factory.hashPlan(address(this), params), price));
        signature = abi.encodePacked(r, s, v);
    }

    function _launch() private {
        launched = factory.launch(params, price, signature);
        key = CustomAIHookV1(launched.hook).poolKey();
        IERC20(launched.token).approve(address(router), type(uint256).max);
    }

    function _trade(bool buy, bool exactInput, uint256 amount, uint256 limit, uint16 ceiling)
        private
        returns (uint256 paid, uint256 received)
    {
        bool zeroForOne = buy == (params.quote < launched.token);
        return router.swap(
            key,
            SwapParams(
                zeroForOne,
                exactInput ? -int256(amount) : int256(amount),
                zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            limit,
            ceiling,
            address(this),
            uint64(block.timestamp)
        );
    }

    function test_atomicLaunchSupplyPriceAndLockedPosition() public {
        uint256 quoteBefore = quote.balanceOf(address(this));
        _launch();
        CustomAITokenV1 token = CustomAITokenV1(launched.token);
        assertEq(token.totalSupply(), T.TOKEN_SUPPLY);
        assertEq(token.balanceOf(address(this)), launched.initialBuyTokens);
        assertGt(launched.initialBuyTokens, 0);
        assertEq(token.balanceOf(address(factory)), 0);
        assertEq(quote.balanceOf(address(this)), quoteBefore - params.initialBuyQuote);
        assertEq(quote.balanceOf(address(manager)), params.initialBuyQuote);
        assertEq(token.balanceOf(address(manager)) + launched.initialBuyTokens, launched.tokenPrincipal);
        assertEq(token.balanceOf(T.LP_RECIPIENT), launched.tokenRounding);
        assertEq(uint256(launched.tokenPrincipal) + launched.tokenRounding, T.TOKEN_SUPPLY);
        assertTrue(token.supportsInterface(type(IVenuePolicy).interfaceId));
        assertEq(uint8(token.venueEnforcement()), uint8(IVenuePolicy.VenueEnforcement.Preferred));
        assertEq(address(token.canonicalPools()[0].hooks), launched.hook);
        (uint160 sqrt, int24 tick, uint24 protocolFee, uint24 lpFee) =
            StateLibrary.getSlot0(manager, PoolId.wrap(launched.poolId));
        assertTrue(sqrt != TickMath.getSqrtPriceAtTick(params.initialTick));
        assertTrue(tick != params.initialTick);
        assertEq(protocolFee + lpFee, 0);
        (uint256 lower, uint256 upper) = P.validate(launched.token < params.quote, params.initialTick, 18, price);
        assertGe(lower, 15_000 ether);
        assertLe(upper, 15_091.5 ether);
        (int24 bottom, int24 top, uint128 liquidity,,) = CustomAILiquidityVaultV1(launched.liquidityVault).position();
        (uint128 actual,,) = StateLibrary.getPositionInfo(
            manager, PoolId.wrap(launched.poolId), launched.liquidityVault, bottom, top, bytes32(0)
        );
        assertEq(actual, liquidity);
        PoolModifyLiquidityTest thief = new PoolModifyLiquidityTest(manager);
        vm.expectRevert();
        thief.modifyLiquidity(key, ModifyLiquidityParams(bottom, top, -int256(uint256(liquidity)), bytes32(0)), "");
        vm.prank(address(factory));
        vm.expectRevert(CustomAILiquidityVaultV1.Unauthorized.selector);
        CustomAILiquidityVaultV1(launched.liquidityVault).initialize(key, tick);
        vm.prank(address(manager));
        vm.expectRevert(CustomAILiquidityVaultV1.Unauthorized.selector);
        CustomAILiquidityVaultV1(launched.liquidityVault).unlockCallback("");
    }

    function test_allFourTradeModesAndRealFeeClaims() public {
        _launch();
        _checkedTrade(true, true, 1000 ether);
        _checkedTrade(false, true, IERC20(launched.token).balanceOf(address(this)) / 5);
        _checkedTrade(true, false, 1000 ether);
        _checkedTrade(false, false, 1 ether);
        CustomAIFeeLedgerV1 ledger = CustomAIFeeLedgerV1(launched.ledger);
        uint256 platform = ledger.platformReceived();
        uint256 additional = ledger.additionalReceived();
        assertEq(manager.balanceOf(launched.ledger, uint256(uint160(params.quote))), platform + additional);
        vm.prank(OTHER);
        ledger.claimPlatform();
        vm.prank(OTHER);
        ledger.claimAdditional();
        vm.prank(OTHER);
        CustomAIRewardVaultV1(launched.rewardVault).claimCreator();
        assertEq(quote.balanceOf(T.PLATFORM_RECIPIENT), platform);
        assertEq(quote.balanceOf(CREATOR_FEE), additional);
        assertEq(ledger.outstandingBacking(), 0);
        assertEq(quote.balanceOf(OTHER), 0);
        assertEq(quote.balanceOf(address(router)), 0);
        assertEq(IERC20(launched.token).balanceOf(address(router)), 0);
    }

    function _checkedTrade(bool buy, bool exactInput, uint256 amount) private {
        CustomAIFeeLedgerV1 ledger = CustomAIFeeLedgerV1(launched.ledger);
        uint256 beforeP = ledger.platformReceived();
        uint256 beforeA = ledger.additionalReceived();
        uint256 beforeQuote = quote.balanceOf(address(this));
        uint256 beforeToken = IERC20(launched.token).balanceOf(address(this));
        (uint256 paid, uint256 received) = _trade(buy, exactInput, amount, exactInput ? 1 : type(uint128).max, 1500);
        uint256 p = ledger.platformReceived() - beforeP;
        uint256 a = ledger.additionalReceived() - beforeA;
        uint256 gross = buy ? paid : received + p + a;
        F.Fees memory expected = F.fromGross(gross, 500);
        assertEq(p, expected.platform);
        assertEq(a, expected.additional);
        assertEq(quote.balanceOf(address(this)), buy ? beforeQuote - paid : beforeQuote + received);
        assertEq(IERC20(launched.token).balanceOf(address(this)), buy ? beforeToken + received : beforeToken - paid);
        assertEq(exactInput ? paid : received, amount);
    }

    function test_initialBuyMinimumCannotBeBypassed() public {
        uint256 beforeBalance = quote.balanceOf(address(this));
        for (uint256 i; i < 2; ++i) {
            params.initialBuyQuote = i == 0 ? 0 : uint128(30 ether - 1);
            _sign();
            vm.expectRevert(abi.encodeWithSelector(CustomAIFactoryV1.InitialBuyTooSmall.selector, 30 ether));
            factory.launch(params, price, signature);
            assertEq(factory.predictTokenAddress(address(this), params).code.length, 0);
            assertEq(quote.balanceOf(address(this)), beforeBalance);
        }
        params.initialBuyQuote = 30 ether;
        _sign();
        _launch();
        assertEq(quote.balanceOf(address(this)), beforeBalance - 30 ether);
        assertEq(CustomAIFeeLedgerV1(launched.ledger).platformReceived(), 0.15 ether);
    }

    function test_initialBuyMinimumRoundsSixDecimalQuotesUp() public {
        quote = new LifecycleQuote(6);
        params.quote = address(quote);
        params.quoteDecimals = 6;
        price.ethUsdE18 = 3000 ether + 1;
        _prepare();
        assertEq(params.initialBuyQuote, 30e6 + 1);
        params.initialBuyQuote--;
        _sign();
        vm.expectRevert(abi.encodeWithSelector(CustomAIFactoryV1.InitialBuyTooSmall.selector, 30e6 + 1));
        factory.launch(params, price, signature);
        params.initialBuyQuote++;
        _sign();
        _launch();
        assertGt(launched.initialBuyTokens, 0);
    }

    function test_initialBuyNoPolicyCapAndIdempotentReplay() public {
        params.initialBuyQuote = 100_000 ether;
        params.minimumBuyTokens = 100_000_000 ether;
        _sign();
        _launch();
        uint256 tokens = IERC20(launched.token).balanceOf(address(this));
        assertGt(tokens, T.TOKEN_SUPPLY / 2);
        assertEq(tokens, launched.initialBuyTokens);
        assertEq(quote.allowance(address(factory), address(router)), 0);
        uint256 balance = quote.balanceOf(address(this));
        vm.warp(block.timestamp + 1000);
        T.LaunchResult memory replay = factory.launch(params, price, "");
        assertEq(replay.token, launched.token);
        assertEq(quote.balanceOf(address(this)), balance);
        assertEq(IERC20(launched.token).balanceOf(address(this)), tokens);
        params.minimumBuyTokens++;
        vm.expectRevert(CustomAIFactoryV1.SaltAlreadyUsed.selector);
        factory.launch(params, price, signature);
    }

    function test_signedPlanBindsCreatorChainParametersAndPrice() public {
        params.maximumFeeBps--;
        vm.expectRevert(CustomAIFactoryV1.InvalidSignature.selector);
        factory.launch(params, price, signature);
        params.maximumFeeBps++;
        vm.prank(OTHER);
        vm.expectRevert(CustomAIFactoryV1.InvalidSignature.selector);
        factory.launch(params, price, signature);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(CustomAIFactoryV1.InvalidSignature.selector);
        factory.launch(params, price, signature);
        _sign();
        price.ethUsdE18++;
        vm.expectRevert(CustomAIFactoryV1.InvalidSignature.selector);
        factory.launch(params, price, signature);
        price.ethUsdE18--;
        price.quoteUsdE18++;
        vm.expectRevert(CustomAIFactoryV1.InvalidSignature.selector);
        factory.launch(params, price, signature);
        assertEq(factory.launchOf(address(this), params.launchSalt).token, address(0));
    }

    function test_stalePriceWrongFdvAndFailedBuyRollBackEverything() public {
        price.observedAt -= 121;
        price.validUntil = price.observedAt + 120;
        _sign();
        vm.expectRevert(P.InvalidPrice.selector);
        factory.launch(params, price, signature);
        price.observedAt = uint64(block.timestamp);
        price.validUntil = uint64(block.timestamp + 120);
        price.quoteUsdE18 = 2 ether;
        _sign();
        vm.expectRevert(P.InvalidStartValue.selector);
        factory.launch(params, price, signature);
        price.quoteUsdE18 = 1 ether;
        params.initialBuyQuote = 30 ether;
        params.minimumBuyTokens = uint128(T.TOKEN_SUPPLY);
        _sign();
        address predicted = factory.predictTokenAddress(address(this), params);
        uint256 beforeQuote = quote.balanceOf(address(this));
        vm.expectRevert(CustomAISwapRouterV1.SlippageExceeded.selector);
        factory.launch(params, price, signature);
        assertEq(predicted.code.length, 0);
        assertEq(factory.launchOf(address(this), params.launchSalt).token, address(0));
        assertEq(quote.balanceOf(address(this)), beforeQuote);
        params.minimumBuyTokens = 1;
        _sign();
        _launch();
        assertEq(launched.token, predicted);
    }

    function test_feeSnapshotUsesBeforePriceNotAfterPrice() public {
        _launch();
        (, int24 beforeTick,,) = StateLibrary.getSlot0(manager, PoolId.wrap(launched.poolId));
        uint256 beforeAdditional = CustomAIFeeLedgerV1(launched.ledger).additionalReceived();
        module.configure(700, 2, beforeTick);
        _trade(true, true, 1000 ether, 1, 750);
        assertEq(CustomAIFeeLedgerV1(launched.ledger).additionalReceived() - beforeAdditional, 70 ether);
        vm.expectRevert();
        _trade(true, true, 1 ether, 1, 750);
    }

    function test_moduleFailuresFallBackAndDoNotPreventSelling() public {
        _launch();
        _trade(true, true, 1000 ether, 1, 1500);
        for (uint8 mode = 1; mode <= 4; ++mode) {
            if (mode == 2) continue;
            module.configure(500, mode, 0);
            uint256 beforeAdditional = CustomAIFeeLedgerV1(launched.ledger).additionalReceived();
            _trade(false, true, 1000 ether, 1, 50);
            assertEq(CustomAIFeeLedgerV1(launched.ledger).additionalReceived(), beforeAdditional);
        }
        module.configure(1451, 0, 0);
        _trade(false, true, 1000 ether, 1, 50);
        vm.etch(address(module), hex"00");
        _trade(false, true, 1000 ether, 1, 50);
    }

    function test_feeSlippageExpiryAndTaxedQuoteGuards() public {
        _launch();
        vm.expectRevert();
        _trade(true, true, 1 ether, 1, 549);
        vm.expectRevert(CustomAISwapRouterV1.SlippageExceeded.selector);
        _trade(true, true, 1 ether, T.TOKEN_SUPPLY, 1500);
        quote.setTaxed(true);
        vm.expectRevert();
        _trade(true, true, 100 ether, 1, 1500);
        quote.setTaxed(false);
        _trade(true, true, 100 ether, 1, 1500);
        quote.setTaxed(true);
        vm.expectRevert();
        _trade(false, true, 100_000 ether, 1, 1500);
        quote.setTaxed(false);
        vm.expectRevert(CustomAISwapRouterV1.DeadlineExpired.selector);
        router.swap(key, SwapParams(true, -1, TickMath.MIN_SQRT_PRICE + 1), 0, 1500, address(this), 1);
        vm.prank(address(manager));
        vm.expectRevert(CustomAISwapRouterV1.Unauthorized.selector);
        router.unlockCallback("");
    }

    function test_tokenOrderAndSixDecimalQuote() public {
        _launch();
        _checkedTrade(true, true, 1000 ether);
        bool firstOrder = launched.token < params.quote;
        quote = new LifecycleQuote(6);
        quote.mint(address(this), 1_000_000e6);
        quote.approve(address(factory), type(uint256).max);
        quote.approve(address(router), type(uint256).max);
        params.quote = address(quote);
        params.quoteDecimals = 6;
        for (uint256 i = 1;; ++i) {
            params.launchSalt = bytes32(i);
            if ((factory.predictTokenAddress(address(this), params) < params.quote) != firstOrder) break;
        }
        _prepare();
        _launch();
        _checkedTrade(true, true, 1000e6);
        _checkedTrade(false, true, IERC20(launched.token).balanceOf(address(this)) / 5);
        _checkedTrade(true, false, 1000 ether);
        _checkedTrade(false, false, 1e6);
    }

    function test_protocolFeeIncludedWithoutBlockingTrading() public {
        _launch();
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(key, 1000 | (1000 << 12));
        _checkedTrade(true, true, 1000 ether);
        _checkedTrade(false, true, IERC20(launched.token).balanceOf(address(this)) / 5);
        _checkedTrade(true, false, 1000 ether);
        _checkedTrade(false, false, 1 ether);
        vm.expectRevert();
        _trade(true, true, 100 ether, 1, 550);
        module.configure(1450, 0, 0);
        CustomAIFeeLedgerV1 ledger = CustomAIFeeLedgerV1(launched.ledger);
        uint256 beforeAdditional = ledger.additionalReceived();
        _trade(true, true, 100 ether, 1, 1500);
        assertEq(ledger.additionalReceived() - beforeAdditional, 14.4 ether);
        _trade(false, true, IERC20(launched.token).balanceOf(address(this)) / 10, 1, 1500);
    }

    function test_tradingFeesFundIsolatedCreatorAndRewardClaims() public {
        RewardProposalFixture rewards = new RewardProposalFixture();
        rewards.configure(OTHER, 10 ether, 0);
        params.rewards.creatorShareBps = 4000;
        params.rewards.module = T.ModuleBinding(address(rewards), address(rewards).codehash, rewards.CONFIG());
        _prepare();
        _launch();
        _trade(true, true, 1000 ether, 1, 1500);
        CustomAIFeeLedgerV1(launched.ledger).claimAdditional();
        CustomAIRewardVaultV1 vault = CustomAIRewardVaultV1(launched.rewardVault);
        assertTrue(vault.allocate(keccak256("earned-reward")));
        assertEq(vault.creatorReceived(), 20.6 ether);
        assertEq(vault.availableRewards(), 20.9 ether);
        assertEq(vault.reservedRewards(), 10 ether);
        vault.claimReward(OTHER);
        vault.claimCreator();
        assertEq(quote.balanceOf(OTHER), 10 ether);
        assertEq(quote.balanceOf(CREATOR_FEE), 20.6 ether);
        assertEq(quote.balanceOf(launched.rewardVault), 20.9 ether);
        assertEq(CustomAIFeeLedgerV1(launched.ledger).outstandingBacking(), 5.15 ether);
    }

    function test_signedExternalDataChangesFeeAndStaleDataFallsBack() public {
        CustomAIDataFeedV1 feed = new CustomAIDataFeedV1(keccak256("external-data"), vm.addr(SIGNER_KEY), 0, 100, 60);
        CustomAIThresholdFeeModuleV1 rule = new CustomAIThresholdFeeModuleV1(feed, 10, 500, 1000);
        params.feeModule = T.ModuleBinding(address(rule), address(rule).codehash, rule.configurationHash());
        _prepare();
        _launch();
        _trade(true, true, 100 ether, 1, 50);
        uint64 now_ = uint64(block.timestamp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, feed.digest(1, 5, now_, now_ + 60));
        feed.update(1, 5, now_, now_ + 60, abi.encodePacked(r, s, v));
        _trade(true, true, 100 ether, 1, 550);
        (v, r, s) = vm.sign(SIGNER_KEY, feed.digest(2, 20, now_, now_ + 60));
        feed.update(2, 20, now_, now_ + 60, abi.encodePacked(r, s, v));
        _trade(true, true, 100 ether, 1, 1050);
        vm.warp(block.timestamp + 61);
        _trade(true, true, 100 ether, 1, 50);
        assertEq(CustomAIFeeLedgerV1(launched.ledger).platformReceived(), 2.15 ether);
        assertEq(CustomAIFeeLedgerV1(launched.ledger).additionalReceived(), 15 ether);
    }

    function test_reentryAndUnrelatedBalancesCannotBeSpent() public {
        _launch();
        bool zeroForOne = params.quote < launched.token;
        SwapParams memory swapParams = SwapParams(
            zeroForOne, -int256(1 ether), zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        );
        quote.setReentry(
            address(router), abi.encodeCall(router.swap, (key, swapParams, 1, 1500, OTHER, uint64(block.timestamp)))
        );
        quote.mint(address(router), 77 ether);
        quote.mint(address(factory), 88 ether);
        _trade(true, true, 100 ether, 1, 1500);
        assertTrue(quote.attempted());
        assertFalse(quote.succeeded());
        assertEq(quote.balanceOf(address(router)), 77 ether);
        assertEq(quote.balanceOf(address(factory)), 88 ether);
        assertEq(IERC20(launched.token).balanceOf(OTHER), 0);
    }

    function test_partialFillRollsBackAndTransferHasNoTax() public {
        _launch();
        bool zeroForOne = params.quote < launched.token;
        (, int24 beforeTick,,) = StateLibrary.getSlot0(manager, PoolId.wrap(launched.poolId));
        uint160 limitPrice = TickMath.getSqrtPriceAtTick(beforeTick + (zeroForOne ? int24(-1) : int24(1)));
        uint256 beforeQuote = quote.balanceOf(address(this));
        vm.expectRevert();
        router.swap(
            key,
            SwapParams(zeroForOne, -int256(1000 ether), limitPrice),
            1,
            1500,
            address(this),
            uint64(block.timestamp)
        );
        assertEq(quote.balanceOf(address(this)), beforeQuote);
        assertEq(CustomAIFeeLedgerV1(launched.ledger).platformReceived(), 0.15 ether);
        _trade(true, true, 1000 ether, 1, 1500);
        uint256 beforeFees = CustomAIFeeLedgerV1(launched.ledger).platformReceived();
        IERC20(launched.token).transfer(OTHER, 10_000 ether);
        assertEq(IERC20(launched.token).balanceOf(OTHER), 10_000 ether);
        assertEq(IERC20(launched.token).totalSupply(), T.TOKEN_SUPPLY);
        assertEq(CustomAIFeeLedgerV1(launched.ledger).platformReceived(), beforeFees);
    }

    function testFuzz_tradeSequenceConservesBackingAndCap(uint256 seed) public {
        _launch();
        manager.setProtocolFeeController(address(this));
        uint256 initialQuote = quote.balanceOf(address(this)) + quote.balanceOf(address(manager));
        CustomAIFeeLedgerV1 ledger = CustomAIFeeLedgerV1(launched.ledger);
        for (uint256 i; i < 8; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint16 extra = uint16(seed % 1451);
            module.configure(extra, 0, 0);
            uint256 beforePlatform = ledger.platformReceived();
            uint256 beforeAdditional = ledger.additionalReceived();
            bool buy = i % 2 == 0;
            uint24 protocolPips = uint24(seed % 1001);
            manager.setProtocolFee(key, protocolPips | (protocolPips << 12));
            Currency inputCurrency = Currency.wrap(buy ? params.quote : launched.token);
            uint256 beforeProtocol = manager.protocolFeesAccrued(inputCurrency);
            uint256 amount = buy ? (seed % 1000 + 1) * 1 ether : IERC20(launched.token).balanceOf(address(this)) / 3;
            (uint256 paid, uint256 received) = _trade(buy, true, amount, 1, 1500);
            uint256 platform = ledger.platformReceived() - beforePlatform;
            uint256 additional = ledger.additionalReceived() - beforeAdditional;
            uint256 gross = buy ? paid : received + platform + additional;
            uint256 protocolPaid = manager.protocolFeesAccrued(inputCurrency) - beforeProtocol;
            if (buy) {
                assertLe((platform + additional + protocolPaid) * 10_000, gross * 1500);
            } else {
                assertLe(
                    (protocolPaid * gross + (paid - protocolPaid) * (platform + additional)) * 10_000,
                    paid * gross * 1500
                );
            }
            assertEq(platform, gross * 50 / 10_000);
            assertEq(manager.balanceOf(launched.ledger, uint256(uint160(params.quote))), ledger.outstandingBacking());
            assertEq(quote.balanceOf(address(this)) + quote.balanceOf(address(manager)), initialQuote);
            assertEq(
                IERC20(launched.token).balanceOf(address(this)) + IERC20(launched.token).balanceOf(address(manager))
                    + IERC20(launched.token).balanceOf(T.LP_RECIPIENT),
                T.TOKEN_SUPPLY
            );
        }
        ledger.claimPlatform();
        if (ledger.additionalReceived() != 0) {
            ledger.claimAdditional();
            CustomAIRewardVaultV1(launched.rewardVault).claimCreator();
        }
        assertEq(
            quote.balanceOf(address(this)) + quote.balanceOf(address(manager)) + quote.balanceOf(T.PLATFORM_RECIPIENT)
                + quote.balanceOf(CREATOR_FEE),
            initialQuote
        );
        assertEq(ledger.outstandingBacking(), 0);
    }

    function _prepareUpstream() private {
        upstream = new MockV4Router(manager);
        quoter = new V4Quoter(manager);
        quote.approve(address(upstream), type(uint256).max);
        IERC20(launched.token).approve(address(upstream), type(uint256).max);
    }

    // The upstream test entrypoint supplies ERC20 payment only; swap and
    // slippage logic are the unmodified v4-periphery V4Router implementation.
    function _upstreamTrade(
        address trader,
        bool buy,
        bool exactInput,
        uint128 amount,
        uint128 limit,
        bytes memory hookData
    ) private returns (uint256 paid, uint256 received) {
        bool zeroForOne = buy == (params.quote < launched.token);
        Currency input = buy ? Currency.wrap(params.quote) : Currency.wrap(launched.token);
        Currency output = buy ? Currency.wrap(launched.token) : Currency.wrap(params.quote);
        uint256 beforeIn = IERC20(Currency.unwrap(input)).balanceOf(trader);
        uint256 beforeOut = IERC20(Currency.unwrap(output)).balanceOf(trader);
        CustomAIFeeLedgerV1 ledger = CustomAIFeeLedgerV1(launched.ledger);
        uint256 beforePlatform = ledger.platformReceived();
        uint256 beforeAdditional = ledger.additionalReceived();
        uint256 beforeProtocol = manager.protocolFeesAccrued(input);
        bytes[] memory inputs = new bytes[](3);
        inputs[0] = exactInput
            ? abi.encode(IV4Router.ExactInputSingleParams(key, zeroForOne, amount, limit, hookData))
            : abi.encode(IV4Router.ExactOutputSingleParams(key, zeroForOne, amount, limit, hookData));
        inputs[1] = abi.encode(input, exactInput ? amount : limit);
        inputs[2] = abi.encode(output, exactInput ? limit : amount);
        upstream.executeActions(
            abi.encode(
                abi.encodePacked(
                    uint8(exactInput ? Actions.SWAP_EXACT_IN_SINGLE : Actions.SWAP_EXACT_OUT_SINGLE),
                    uint8(Actions.SETTLE_ALL),
                    uint8(Actions.TAKE_ALL)
                ),
                inputs
            )
        );
        paid = beforeIn - IERC20(Currency.unwrap(input)).balanceOf(trader);
        received = IERC20(Currency.unwrap(output)).balanceOf(trader) - beforeOut;
        uint256 platform = ledger.platformReceived() - beforePlatform;
        uint256 additional = ledger.additionalReceived() - beforeAdditional;
        uint256 protocolPaid = manager.protocolFeesAccrued(input) - beforeProtocol;
        uint256 gross = buy ? paid : received + platform + additional;
        assertEq(platform, gross * 50 / 10_000);
        if (buy) {
            assertLe((platform + additional + protocolPaid) * 10_000, gross * 1500);
        } else {
            assertLe(
                (protocolPaid * gross + (paid - protocolPaid) * (platform + additional)) * 10_000, paid * gross * 1500
            );
        }
        assertEq(manager.balanceOf(launched.ledger, uint256(uint160(params.quote))), ledger.outstandingBacking());
        assertEq(IERC20(Currency.unwrap(input)).balanceOf(address(upstream)), 0);
        assertEq(IERC20(Currency.unwrap(output)).balanceOf(address(upstream)), 0);
    }

    function test_scannerFreshWalletTransfersAndSellsEntireBalanceThroughUpstreamRouter() public {
        address buyer = makeAddr("fresh buyer");
        address receiver = makeAddr("fresh receiver");
        address seller = makeAddr("fresh seller");
        for (uint8 i; i < 2; ++i) {
            uint8 decimals_ = i == 0 ? 6 : 18;
            quote = new LifecycleQuote(decimals_);
            params.quote = address(quote);
            params.quoteDecimals = decimals_;
            params.launchSalt = bytes32(uint256(100 + i));
            _prepare();
            _launch();
            _prepareUpstream();
            module.configure(1450, 0, 0);
            manager.setProtocolFeeController(address(this));
            manager.setProtocolFee(key, uint24(1000 | (1000 << 12)));
            quote.mint(buyer, 1000 * 10 ** decimals_);
            vm.startPrank(buyer);
            quote.approve(address(upstream), type(uint256).max);
            (, uint256 bought) = _upstreamTrade(buyer, true, true, uint128(1000 * 10 ** decimals_), 1, "");
            IERC20(launched.token).transfer(receiver, bought);
            vm.stopPrank();
            assertEq(IERC20(launched.token).balanceOf(receiver), bought);
            vm.prank(receiver);
            IERC20(launched.token).approve(seller, bought);
            vm.startPrank(seller);
            IERC20(launched.token).transferFrom(receiver, seller, bought);
            IERC20(launched.token).approve(address(upstream), bought);
            (uint256 sold, uint256 received) = _upstreamTrade(seller, false, true, uint128(bought), 1, "");
            vm.stopPrank();
            assertEq(sold, bought);
            assertGt(received, 0);
            assertEq(IERC20(launched.token).balanceOf(seller), 0);
            assertEq(IERC20(launched.token).balanceOf(receiver), 0);
            assertEq(IERC20(launched.token).totalSupply(), T.TOKEN_SUPPLY);
        }
    }

    function test_scannerQuoterMatchesAllFourRealSwapModesWithoutSpecialHookData() public {
        _launch();
        _prepareUpstream();
        module.configure(1450, 0, 0);
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(key, uint24(1000 | (1000 << 12)));
        for (uint8 i; i < 4; ++i) {
            bool buy = i < 2;
            bool exactInput = i % 2 == 0;
            // Keep exact-output sells below quote reserves after fees on the preceding buys.
            uint128 amount = buy
                ? (exactInput ? uint128(100 ether) : uint128(1000 ether))
                : (exactInput ? uint128(1000 ether) : uint128(25 ether));
            IV4Quoter.QuoteExactSingleParams memory qp =
                IV4Quoter.QuoteExactSingleParams(key, buy == (params.quote < launched.token), amount, "");
            uint256 beforeBacking = CustomAIFeeLedgerV1(launched.ledger).outstandingBacking();
            (uint160 beforePrice,,,) = StateLibrary.getSlot0(manager, PoolId.wrap(launched.poolId));
            (uint256 preview,) = exactInput ? quoter.quoteExactInputSingle(qp) : quoter.quoteExactOutputSingle(qp);
            assertGt(preview, 0);
            assertEq(CustomAIFeeLedgerV1(launched.ledger).outstandingBacking(), beforeBacking);
            (uint160 afterPrice,,,) = StateLibrary.getSlot0(manager, PoolId.wrap(launched.poolId));
            assertEq(beforePrice, afterPrice);
            (uint256 paid, uint256 received) =
                _upstreamTrade(address(this), buy, exactInput, amount, uint128(preview), "");
            assertEq(exactInput ? received : paid, preview);
            assertEq(exactInput ? paid : received, amount);
        }
    }

    function test_scannerBadModuleCannotBlockUpstreamRoundTrip() public {
        _launch();
        _prepareUpstream();
        uint8[4] memory modes = [uint8(1), 3, 4, 0];
        for (uint8 i; i < modes.length; ++i) {
            module.configure(i == 3 ? 1451 : 500, modes[i], 0);
            uint256 beforeExtra = CustomAIFeeLedgerV1(launched.ledger).additionalReceived();
            (, uint256 bought) = _upstreamTrade(address(this), true, true, 100 ether, 1, "");
            _upstreamTrade(address(this), false, true, uint128(bought), 1, "");
            assertEq(IERC20(launched.token).balanceOf(address(this)), launched.initialBuyTokens);
            assertEq(CustomAIFeeLedgerV1(launched.ledger).additionalReceived(), beforeExtra);
        }
    }

    function test_scannerEmptyDataDoesNotRemoveExplicitFeeAndSlippageLimits() public {
        _launch();
        _prepareUpstream();
        IV4Quoter.QuoteExactSingleParams memory qp =
            IV4Quoter.QuoteExactSingleParams(key, params.quote < launched.token, 100 ether, "");
        (uint256 preview,) = quoter.quoteExactInputSingle(qp);
        vm.expectRevert();
        upstream.executeActions(_buyActions(100 ether, uint128(preview + 1), ""));
        bytes[] memory badData = new bytes[](7);
        badData[0] = hex"01";
        badData[1] = new bytes(31);
        badData[2] = new bytes(33);
        badData[3] = abi.encode(uint256(49));
        badData[4] = abi.encode(uint256(1501));
        badData[5] = abi.encode(type(uint256).max);
        badData[6] = abi.encode(uint256(549)); // active fee is 50 + 500 bps
        for (uint8 i; i < badData.length; ++i) {
            bytes memory actions = _buyActions(100 ether, 1, badData[i]);
            vm.expectRevert();
            upstream.executeActions(actions);
        }
        assertEq(IERC20(launched.token).balanceOf(address(this)), launched.initialBuyTokens);
        assertEq(CustomAIFeeLedgerV1(launched.ledger).outstandingBacking(), 1.65 ether);
        _upstreamTrade(address(this), true, true, 100 ether, uint128(preview), abi.encode(uint256(550)));
        assertEq(CustomAIHookV1(launched.hook).PLATFORM_FEE_BPS(), 50);
        assertEq(CustomAIHookV1(launched.hook).MAX_TOTAL_FEE_BPS(), 1500);
    }

    function _buyActions(uint128 amount, uint128 minimum, bytes memory data) private view returns (bytes memory) {
        bytes[] memory inputs = new bytes[](3);
        inputs[0] =
            abi.encode(IV4Router.ExactInputSingleParams(key, params.quote < launched.token, amount, minimum, data));
        inputs[1] = abi.encode(Currency.wrap(params.quote), amount);
        inputs[2] = abi.encode(Currency.wrap(launched.token), minimum);
        return abi.encode(hex"060c0f", inputs);
    }

    function test_runtimeAndCreationCodeMeetEvmDeploymentLimits() public {
        _launch();
        address[9] memory contracts_ = [
            address(factory),
            address(deployer),
            address(lpDeployer),
            address(router),
            launched.token,
            launched.hook,
            launched.ledger,
            launched.rewardVault,
            launched.liquidityVault
        ];
        for (uint256 i; i < contracts_.length; ++i) {
            assertLe(contracts_[i].code.length, 24_576);
        }
        assertLe(type(CustomAIHookV1).creationCode.length + 1024, 49_152);
        assertLe(type(CustomAIFactoryV1).creationCode.length + 1024, 49_152);
    }

    function test_fundedProgramBuybackUsesRealPoolAndPreservesCore() public {
        CustomAIProgramV1 program = new CustomAIProgramV1(
            CustomAIProgramV1.Configuration({
                factory: factory,
                creator: address(this),
                launchSalt: params.launchSalt,
                quote: address(quote),
                quoteDecimals: 18,
                mode: CustomAIProgramV1.Mode.Buyback,
                recipient: OTHER,
                interval: 3600,
                maximumBatch: 1 ether,
                minimumTokensPerQuote: 90 ether
            })
        );
        params.rewards.creatorShareBps = 4000;
        params.rewards.module =
            T.ModuleBinding(address(program), address(program).codehash, program.configurationHash());
        _prepare();
        _launch();
        CustomAIFeeLedgerV1(launched.ledger).claimAdditional();
        uint256 supplyBefore = IERC20(launched.token).totalSupply();
        uint256 balanceBefore = IERC20(launched.token).balanceOf(OTHER);
        (uint256 paid, uint256 received) = program.buyback();
        assertGt(paid, 0);
        assertLe(paid, 1 ether);
        assertGt(received, 0);
        assertEq(IERC20(launched.token).balanceOf(OTHER), balanceBefore + received);
        assertEq(IERC20(launched.token).totalSupply(), supplyBefore);
        assertEq(quote.allowance(address(program), address(router)), 0);
        assertLe(address(program).code.length, 24_576);
        vm.expectRevert(CustomAIProgramV1.NotReady.selector);
        program.buyback();
    }

    function test_fundedProgramStakingUsesLaunchedCoinAndActualFeeRevenue() public {
        CustomAIProgramV1 program = new CustomAIProgramV1(
            CustomAIProgramV1.Configuration({
                factory: factory,
                creator: address(this),
                launchSalt: params.launchSalt,
                quote: address(quote),
                quoteDecimals: 18,
                mode: CustomAIProgramV1.Mode.Staking,
                recipient: address(0),
                interval: 3600,
                maximumBatch: 0,
                minimumTokensPerQuote: 0
            })
        );
        params.rewards.creatorShareBps = 5000;
        params.rewards.module =
            T.ModuleBinding(address(program), address(program).codehash, program.configurationHash());
        _prepare();
        _launch();
        uint256 amount = IERC20(launched.token).balanceOf(address(this));
        IERC20(launched.token).approve(address(program), amount);
        program.stake(amount);
        CustomAIFeeLedgerV1(launched.ledger).claimAdditional();
        program.collect();
        uint256 beforeQuote = quote.balanceOf(address(this));
        uint256 claimed = program.claim();
        assertGt(claimed, 0);
        assertEq(quote.balanceOf(address(this)), beforeQuote + claimed);
        program.withdraw(amount);
        assertEq(IERC20(launched.token).balanceOf(address(this)), amount);
        assertEq(program.totalStaked(), 0);
    }

    function test_composableFeesBecomeRealPermanentlyHeldLiquidity() public {
        module = new ComposableFeeFixture(manager);
        params.feeModule = T.ModuleBinding(address(module), address(module).codehash, module.CONFIG());
        CustomAIExecutionPriceFeedV1 prices = new CustomAIExecutionPriceFeedV1(vm.addr(SIGNER_KEY));
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        CustomAIProgramRouterV1.Destination[] memory destinations = new CustomAIProgramRouterV1.Destination[](1);
        destinations[0] = CustomAIProgramRouterV1.Destination(keccak256("compound"), predicted, 10_000);
        CustomAIProgramRouterV1 allocator = new CustomAIProgramRouterV1(
            factory, address(this), params.launchSalt, address(quote), destinations, address(0)
        );
        CustomAILiquidityProgramV1 program = new CustomAILiquidityProgramV1(
            CustomAILiquidityProgramV1.Configuration({
                factory: factory,
                creator: address(this),
                launchSalt: params.launchSalt,
                allocator: allocator,
                actionId: keccak256("compound"),
                quote: address(quote),
                maximumBatch: 0.01 ether,
                maximumDeviationBps: 100,
                interval: 600,
                maxPriceAge: 120,
                minimumObservations: 3,
                minimumHistory: 60,
                priceFeed: prices
            })
        );
        assertEq(address(program), predicted);
        params.rewards = T.Rewards(
            CREATOR_FEE,
            0,
            T.ModuleBinding(address(allocator), address(allocator).codehash, allocator.configurationHash())
        );
        _prepare();
        _launch();
        vm.roll(200);
        vm.setBlockhash(199, keccak256("checked-block"));
        (uint160 sqrtPrice,,,) = StateLibrary.getSlot0(manager, PoolId.wrap(launched.poolId));
        bytes32 executionId = keccak256(abi.encode(program.configurationHash(), keccak256("rain-event")));
        CustomAIExecutionPriceFeedV1.Quote memory observation = CustomAIExecutionPriceFeedV1.Quote({
            program: address(program),
            poolId: launched.poolId,
            executionId: executionId,
            amount: 0.01 ether,
            sqrtPriceX96: sqrtPrice,
            observedAt: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 120),
            blockNumber: 199,
            blockHash: keccak256("checked-block"),
            observations: 3,
            historySeconds: 60
        });
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(SIGNER_KEY, prices.digest(observation));
        bytes memory proof = abi.encode(observation, abi.encodePacked(r, ss, v));
        vm.expectRevert();
        program.execute(executionId, 0.02 ether, 0, uint64(block.timestamp), proof);
        vm.expectRevert();
        program.execute(executionId, 0.01 ether, type(uint128).max, uint64(block.timestamp), proof);
        assertEq(program.liquidity(), 0);
        program.execute(executionId, 0.01 ether, 0, uint64(block.timestamp), proof);
        assertGt(program.liquidity(), 0);
        (uint128 held,,) = StateLibrary.getPositionInfo(
            manager,
            PoolId.wrap(launched.poolId),
            address(program),
            TickMath.minUsableTick(key.tickSpacing),
            TickMath.maxUsableTick(key.tickSpacing),
            keccak256("compound")
        );
        assertEq(held, program.liquidity());
        assertTrue(program.executed(executionId));
        vm.expectRevert();
        program.execute(executionId, 0.01 ether, 0, uint64(block.timestamp), proof);
        // Existing user selling and fixed platform fees still work independently.
        _trade(false, true, IERC20(launched.token).balanceOf(address(this)) / 100, 1, 1500);
        assertGt(CustomAIFeeLedgerV1(launched.ledger).platformReceived(), 0);
        (bool removed,) = address(program).call(abi.encodeWithSignature("withdraw(uint256)", 1));
        assertFalse(removed);
    }

    function test_programFactoryPredictsOneImmutableBundle() public {
        CustomAIExecutionPriceFeedV1 prices = new CustomAIExecutionPriceFeedV1(vm.addr(SIGNER_KEY));
        CustomAIProgramFactoryV1 programs = new CustomAIProgramFactoryV1(
            factory,
            new CustomAIProgramRouterDeployerV1(),
            new CustomAILiquidityProgramDeployerV1(),
            new CustomAIFundedProgramDeployerV1(),
            prices
        );
        PT.Action[] memory actions = new PT.Action[](1);
        actions[0] = PT.Action(keccak256("compound"), 0, 10_000, address(0), 0.01 ether, 0, 100, 600, 120, 3, 60);
        PT.Launch memory configuration =
            PT.Launch(factory, address(this), params.launchSalt, address(quote), 18, keccak256("rule-spec"), actions);
        (address expected, address[] memory expectedPrograms,) = programs.predictPrograms(configuration);
        (address deployed, address[] memory instances) = programs.deployPrograms(configuration);
        assertEq(deployed, expected);
        assertEq(instances[0], expectedPrograms[0]);
        assertGt(instances[0].code.length, 0);
        assertEq(programs.recipientOf(deployed, keccak256("compound")), instances[0]);
        (address repeated,) = programs.deployPrograms(configuration);
        assertEq(repeated, deployed);
        configuration.actions[0].maximumBatch = 0.02 ether;
        vm.expectRevert();
        programs.deployPrograms(configuration);
    }
}
