// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {ProtectedLaunchTokenV1} from "../../src/launch-protection/ProtectedLaunchTokenV1.sol";
import {HyperEvmLaunchProtectionModuleV1} from "../../src/hyperevm-custom-v1/HyperEvmLaunchProtectionModuleV1.sol";
import {
    HyperEvmProtectedNativeInitializerV1,
    IProtectedLaunchHookV1,
    ILaunchUsdFeedV1
} from "../../src/hyperevm-custom-v1/HyperEvmProtectedNativeInitializerV1.sol";
import {HyperEvmProtectedNative30HookV1} from "../../src/hyperevm-custom-v1/HyperEvmProtectedNative30HookV1.sol";

contract HyperEvmTestPriceFeed {
    uint8 public constant decimals = 18;
    int256 public answer = 2000e18;
    uint256 public updatedAt;

    constructor() {
        updatedAt = block.timestamp;
    }

    function set(int256 answer_, uint256 updated_) external {
        answer = answer_;
        updatedAt = updated_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

/// @dev Test fixture only, not a production router or a source of runtime evidence.
contract HyperEvmTestAuthenticatedRouter is IUnlockCallback {
    IPoolManager public immutable manager;
    address public msgSender;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function swap(PoolKey calldata key, bool buy, uint256 amount) external payable returns (BalanceDelta delta) {
        return _swap(key, buy, -int256(amount));
    }

    function swapExactOutput(PoolKey calldata key, bool buy, uint256 amount)
        external
        payable
        returns (BalanceDelta delta)
    {
        return _swap(key, buy, int256(amount));
    }

    function _swap(PoolKey calldata key, bool buy, int256 specified) private returns (BalanceDelta delta) {
        require(msgSender == address(0));
        msgSender = msg.sender;
        delta = abi.decode(manager.unlock(abi.encode(key, buy, specified)), (BalanceDelta));
        msgSender = address(0);
        uint256 refund = address(this).balance;
        if (refund != 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            require(ok);
        }
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (PoolKey memory key, bool buy, int256 specified) = abi.decode(data, (PoolKey, bool, int256));
        BalanceDelta delta = manager.swap(
            key, SwapParams(buy, specified, buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1), ""
        );
        if (buy) {
            manager.settle{value: uint256(-int256(delta.amount0()))}();
            manager.take(key.currency1, msgSender, uint256(uint128(delta.amount1())));
        } else {
            manager.sync(key.currency1);
            IERC20(Currency.unwrap(key.currency1))
                .transferFrom(msgSender, address(manager), uint256(-int256(delta.amount1())));
            manager.settle();
            manager.take(key.currency0, msgSender, uint256(uint128(delta.amount0())));
        }
        return abi.encode(delta);
    }
}

contract HyperEvmLaunchProtectionV1Test is Test {
    address MANAGER;
    address constant DEV = address(0xD001);
    address constant BUYER = address(0xB001);
    uint256 constant SUPPLY = 1_000_000_000 ether;
    int24 constant START_TICK = 180_120; // At least USD 30k for 1b units with ETH at USD 2k.
    IPoolManager manager;
    HyperEvmTestPriceFeed feed;
    HyperEvmTestAuthenticatedRouter router;
    HyperEvmProtectedNativeInitializerV1 initializer;
    ProtectedLaunchTokenV1 token;
    HyperEvmProtectedNative30HookV1 hook;

    function _chain() internal pure virtual returns (uint256) {
        return 999;
    }

    function setUp() public {
        vm.chainId(_chain());
        MANAGER = 0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F;
        vm.warp(100_000);
        vm.deal(address(this), 100 ether);
        vm.deal(DEV, 100 ether);
        vm.deal(BUYER, 100 ether);
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), MANAGER);
        manager = IPoolManager(MANAGER);
        address feedAddress = 0x2b25BC41D55de29F3A2e163F8Eebf63966B25b57;
        deployCodeTo("HyperEvmTestPriceFeed", "", feedAddress);
        feed = HyperEvmTestPriceFeed(feedAddress);
        address routerAddress = 0xeD270A1Bcdc63cf1356D695e7f40961d4819d6bF;
        deployCodeTo("HyperEvmTestAuthenticatedRouter", abi.encode(manager), routerAddress);
        router = HyperEvmTestAuthenticatedRouter(routerAddress);
        initializer = new HyperEvmProtectedNativeInitializerV1(
            manager, address(this), ILaunchUsdFeedV1(address(feed)), address(feed).codehash
        );
        token = new ProtectedLaunchTokenV1("Protected", "GUARD", SUPPLY, address(initializer), MANAGER);
        _deployHook(
            address(router),
            address(router).codehash,
            [address(0xA1), address(0xA2), address(0xA3), address(0xA4), address(0xA5), address(0xA6)]
        );
    }

    function _deployHook(address router_, bytes32 hash, address[6] memory exempt) internal {
        HyperEvmProtectedNative30HookV1.PoolConfig memory config = HyperEvmProtectedNative30HookV1.PoolConfig({
            token: address(token),
            lpFee: 0,
            tickSpacing: 60,
            initialSqrtPriceX96: TickMath.getSqrtPriceAtTick(START_TICK),
            initializer: address(initializer),
            creatorFeeRecipient: DEV,
            creatorBuyFeeBps: 70,
            creatorSellFeeBps: 70,
            module: address(0),
            maxModuleLpFeePips: 0
        });
        bytes memory args = abi.encode(manager, config, DEV, router_, hash, exempt);
        (, bytes32 salt) =
            HookMiner.find(address(this), 0x20cc, type(HyperEvmProtectedNative30HookV1).creationCode, args);
        hook = new HyperEvmProtectedNative30HookV1{salt: salt}(manager, config, DEV, router_, hash, exempt);
    }

    function _launch() internal {
        initializer.initialize{value: 0.01 ether}(IProtectedLaunchHookV1(address(hook)), token, START_TICK, DEV, 1);
    }

    function test_atomicStartEnforcesFdvInitialBuyAndFee() public {
        _launch();
        assertGe(initializer.openingFdvUsd(), 15_000);
        assertEq(token.POLICY_REVISION(), 2);
        assertEq(hook.POLICY_REVISION(), 2);
        assertEq(token.startedAt(), block.timestamp);
        assertGt(token.balanceOf(DEV), 0);
        assertLe(token.balanceOf(DEV), SUPPLY / 50);
        assertGt(initializer.lockedLiquidity(), 0);
        assertEq(hook.feeVault().platformAccrued(), 0.000_03 ether);
    }

    function test_launchBetweenFifteenAndThirtyThousandIsAllowed() public {
        feed.set(1000e18, block.timestamp);
        _launch();
        assertGe(initializer.openingFdvUsd(), 15_000);
        assertLt(initializer.openingFdvUsd(), 30_000);
    }

    function test_noOrdinaryTransferBeforeStart() public {
        vm.prank(address(initializer));
        vm.expectRevert(ProtectedLaunchTokenV1.TradingNotStarted.selector);
        token.transfer(BUYER, 1);
    }

    function test_arbitraryOracleCannotSubstituteForUsdFeed() public {
        HyperEvmTestPriceFeed fake = new HyperEvmTestPriceFeed();
        vm.expectRevert(HyperEvmProtectedNativeInitializerV1.InvalidConfiguration.selector);
        new HyperEvmProtectedNativeInitializerV1(
            manager, address(this), ILaunchUsdFeedV1(address(fake)), address(fake).codehash
        );
    }

    function test_cumulativeCapIncludesTransfersAndDoesNotRefill() public {
        _launch();
        uint256 limit = token.walletTokenLimit();
        vm.prank(MANAGER);
        token.transfer(BUYER, limit);
        vm.prank(BUYER);
        token.transfer(address(0xC1), limit / 2);
        vm.prank(MANAGER);
        vm.expectRevert(
            abi.encodeWithSelector(ProtectedLaunchTokenV1.WalletLimitExceeded.selector, BUYER, limit + 1, limit)
        );
        token.transfer(BUYER, 1);
        vm.prank(BUYER);
        token.burn(limit / 2);
        vm.prank(MANAGER);
        vm.expectRevert(
            abi.encodeWithSelector(ProtectedLaunchTokenV1.WalletLimitExceeded.selector, BUYER, limit + 1, limit)
        );
        token.transfer(BUYER, 1);
    }

    function test_devAndExemptWalletsHaveSameCap() public {
        _launch();
        address[7] memory wallets =
            [DEV, address(0xA1), address(0xA2), address(0xA3), address(0xA4), address(0xA5), address(0xA6)];
        for (uint256 i; i < wallets.length; ++i) {
            uint256 remaining = token.walletTokenLimit() - token.receivedDuringProtection(wallets[i]);
            vm.prank(MANAGER);
            token.transfer(wallets[i], remaining);
            vm.prank(MANAGER);
            vm.expectRevert();
            token.transfer(wallets[i], 1);
        }
    }

    function test_exactFiveMinuteBoundaryReleasesCap() public {
        _launch();
        uint256 overLimit = token.walletTokenLimit() + 1;
        vm.warp(token.startedAt() + 299);
        vm.prank(MANAGER);
        vm.expectRevert();
        token.transfer(BUYER, overLimit);
        vm.warp(token.startedAt() + 300);
        vm.prank(MANAGER);
        token.transfer(BUYER, overLimit);
        assertGt(token.balanceOf(BUYER), token.walletTokenLimit());
    }

    function test_decayAndOnlyTaxExemptions() public {
        _launch();
        HyperEvmLaunchProtectionModuleV1 module = HyperEvmLaunchProtectionModuleV1(hook.module());
        uint24 start = module.additionalTaxPpmForBuyer(BUYER);
        assertEq(start, 980_000);
        assertEq(module.additionalTaxPpmForBuyer(DEV), 0);
        for (uint160 i = 0xA1; i <= 0xA6; ++i) {
            assertTrue(module.isTaxExempt(address(i)));
            assertEq(module.additionalTaxPpmForBuyer(address(i)), 0);
        }
        assertFalse(module.isTaxExempt(address(0xA7)));
        vm.warp(token.startedAt() + 15);
        assertLt(module.additionalTaxPpmForBuyer(BUYER), start);
        assertGt(module.additionalTaxPpmForBuyer(BUYER), 480_000);
        vm.warp(token.startedAt() + 30);
        assertEq(module.additionalTaxPpmForBuyer(BUYER), 0);
    }

    function test_realBuyAndSellPayPlatformOnce() public {
        _launch();
        assertEq(hook.openingTaxVault().platformAccrued(), 0, "dev initial buy is exempt only from opening tax");
        uint256 before = hook.feeVault().platformAccrued();
        vm.startPrank(BUYER);
        router.swap{value: 0.001 ether}(hook.poolKey(), true, 0.001 ether);
        uint256 tokens = token.balanceOf(BUYER);
        assertGt(tokens, 0);
        assertEq(hook.feeVault().platformAccrued() - before, 0.000_003 ether);
        uint256 openingTax = hook.openingTaxVault().platformAccrued();
        assertEq(openingTax, 0.000_98 ether);
        token.approve(address(router), tokens);
        router.swap(hook.poolKey(), false, tokens / 2);
        vm.stopPrank();
        assertGt(hook.feeVault().platformAccrued(), before + 0.000_003 ether);
        assertEq(hook.openingTaxVault().platformAccrued(), openingTax, "selling adds no opening tax");
        uint256 owed = hook.feeVault().platformAccrued();
        address recipient = hook.feeVault().PLATFORM_RECIPIENT();
        uint256 balance = recipient.balance;
        hook.feeVault().claimPlatform();
        assertEq(recipient.balance - balance, owed);
        hook.openingTaxVault().claimPlatform();
        assertEq(recipient.balance - balance, owed + openingTax);
        assertEq(hook.openingTaxVault().creatorAccrued(), 0);
        assertGt(initializer.lockedLiquidity(), 0);
    }

    function test_exactOutputTaxAndThirtySecondEnd() public {
        _launch();
        PoolKey memory key = hook.poolKey();
        uint256 before = BUYER.balance;
        vm.prank(BUYER);
        router.swapExactOutput{value: 0.1 ether}(key, true, 1000 ether);
        uint256 gross = before - BUYER.balance;
        assertEq(token.balanceOf(BUYER), 1000 ether);
        assertEq(
            hook.openingTaxVault().platformAccrued(), (gross * 9900 + 9999) / 10_000 - (gross * 100 + 9999) / 10_000
        );
        vm.warp(token.startedAt() + 30);
        uint256 taxBefore = hook.openingTaxVault().platformAccrued();
        vm.prank(BUYER);
        router.swap{value: 0.001 ether}(key, true, 0.001 ether);
        assertEq(hook.openingTaxVault().platformAccrued(), taxBefore);
    }

    function testFuzz_feeComponentsAndNetInverse(uint128 raw, uint8 secondsElapsed) public {
        _launch();
        uint256 amount = bound(raw, 100, 1 ether);
        vm.warp(token.startedAt() + bound(secondsElapsed, 0, 30));
        (uint256 gross, uint256 platformFee, uint256 creatorFee, uint256 tax) =
            hook.previewTradeFees(amount, true, true, BUYER);
        assertEq(gross - platformFee - creatorFee - tax, amount);
        (uint256 sameGross, uint256 p2, uint256 c2, uint256 t2) = hook.previewTradeFees(gross, false, true, BUYER);
        assertEq(sameGross, gross);
        assertEq(p2, platformFee);
        assertEq(c2, creatorFee);
        assertEq(t2, tax);
    }

    function test_untrustedRouterAndSpoofedDataCannotClaimExemption() public {
        _launch();
        HyperEvmTestAuthenticatedRouter other = new HyperEvmTestAuthenticatedRouter(manager);
        PoolKey memory key = hook.poolKey();
        vm.prank(DEV);
        vm.expectRevert();
        other.swap{value: 0.001 ether}(key, true, 0.001 ether);
        vm.warp(token.startedAt() + 31);
        vm.prank(DEV);
        vm.expectRevert();
        other.swap{value: 0.001 ether}(key, true, 0.001 ether);
    }

    function test_cumulativeBuyerLimitAlsoAppliesToExemptWallets() public {
        _launch();
        PoolKey memory key = hook.poolKey();
        address exemptBuyer = address(0xA6);
        vm.deal(exemptBuyer, 5 ether);
        uint256 limit = token.walletTokenLimit();
        vm.prank(exemptBuyer);
        router.swapExactOutput{value: 1 ether}(key, true, limit);
        assertEq(hook.boughtDuringProtection(exemptBuyer), limit);
        vm.prank(exemptBuyer);
        token.transfer(address(0xB2), limit);
        vm.prank(exemptBuyer);
        vm.expectRevert(
            abi.encodeWithSignature(
                "WrappedError(address,bytes4,bytes,bytes)",
                address(hook),
                IHooks.afterSwap.selector,
                abi.encodeWithSelector(
                    HyperEvmProtectedNative30HookV1.BuyerLimitExceeded.selector, exemptBuyer, limit + 1, limit
                ),
                abi.encodeWithSignature("HookCallFailed()")
            )
        );
        router.swapExactOutput{value: 1 ether}(key, true, 1);
    }

    function test_staleNegativeAndLowUsdPriceRollBackLaunch() public {
        feed.set(-1, block.timestamp);
        vm.expectRevert(HyperEvmProtectedNativeInitializerV1.InvalidOraclePrice.selector);
        _launch();
        feed.set(2000e18, block.timestamp - initializer.MAX_FEED_AGE() - 1);
        vm.expectRevert(HyperEvmProtectedNativeInitializerV1.InvalidOraclePrice.selector);
        _launch();
        feed.set(100e18, block.timestamp);
        vm.expectRevert();
        _launch();
        assertFalse(initializer.initialized());
        assertEq(token.startedAt(), 0);
    }

    function test_duplicateExemptionsRejected() public {
        vm.expectRevert(HyperEvmLaunchProtectionModuleV1.InvalidConfiguration.selector);
        new HyperEvmLaunchProtectionModuleV1(
            address(1),
            token,
            DEV,
            address(router),
            address(router).codehash,
            70,
            [address(0xA1), address(0xA1), address(0), address(0), address(0), address(0)]
        );
    }

    function test_initialBuyOverTwoPercentRollsBackEverything() public {
        vm.expectRevert();
        initializer.initialize{value: 1 ether}(IProtectedLaunchHookV1(address(hook)), token, START_TICK, DEV, 1);
        assertFalse(initializer.initialized());
        assertEq(token.startedAt(), 0);
        assertEq(token.balanceOf(address(initializer)), SUPPLY);
    }

    function test_startAndInitializationCannotBeCalledByOtherWallet() public {
        vm.prank(BUYER);
        vm.expectRevert(ProtectedLaunchTokenV1.NotInitializer.selector);
        token.start();
        vm.prank(BUYER);
        vm.expectRevert(HyperEvmProtectedNativeInitializerV1.Unauthorized.selector);
        _launch();
    }

    function test_lockedPositionHasNoWithdrawalOrFeeCollectionEntrypoint() public {
        _launch();
        (bool withdraw,) = address(initializer).call(abi.encodeWithSignature("withdraw()"));
        (bool collect,) = address(initializer).call(abi.encodeWithSignature("collectLpFees()"));
        assertFalse(withdraw);
        assertFalse(collect);
    }

    function testFuzz_openingFeeIsMonotonicAndEnds(uint8 secondsElapsed) public {
        _launch();
        HyperEvmLaunchProtectionModuleV1 module = HyperEvmLaunchProtectionModuleV1(hook.module());
        uint256 elapsed = bound(secondsElapsed, 0, 30);
        vm.warp(token.startedAt() + elapsed);
        uint24 current = module.additionalTaxPpmForBuyer(BUYER);
        vm.warp(token.startedAt() + elapsed + 1);
        assertLe(module.additionalTaxPpmForBuyer(BUYER), current);
        assertLe(current, 990_000);
        if (elapsed == 30) assertEq(current, 0);
    }

    function testFuzz_receiptsNeverExceedTwoPercent(uint128 value) public {
        _launch();
        uint256 limit = token.walletTokenLimit();
        uint256 amount = bound(value, 1, limit);
        vm.prank(MANAGER);
        token.transfer(BUYER, amount);
        assertLe(token.receivedDuringProtection(BUYER), limit);
        vm.prank(MANAGER);
        vm.expectRevert();
        token.transfer(BUYER, limit - amount + 1);
    }

    receive() external payable {}
}

