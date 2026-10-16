// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { ProtectedLaunchTokenV1 } from "../../src/launch-protection/ProtectedLaunchTokenV1.sol";
import { LaunchProtectionModuleV1 } from "../../src/launch-protection/LaunchProtectionModuleV1.sol";
import {
    ProtectedNativeInitializerV1,
    IProtectedLaunchHookV1,
    ILaunchUsdFeedV1
} from "../../src/launch-protection/ProtectedNativeInitializerV1.sol";
import { ProtectedNative30HookV1 } from "../../src/launch-protection/ProtectedNative30HookV1.sol";

contract TestPriceFeed {
    uint8 public constant decimals = 8;
    int256 public answer = 2000e8;
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
contract TestAuthenticatedRouter is IUnlockCallback {
    IPoolManager public immutable manager;
    address public msgSender;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function swap(PoolKey calldata key, bool buy, uint256 amount) external payable returns (BalanceDelta delta) {
        require(msgSender == address(0));
        msgSender = msg.sender;
        delta = abi.decode(manager.unlock(abi.encode(key, buy, amount)), (BalanceDelta));
        msgSender = address(0);
        uint256 refund = address(this).balance;
        if (refund != 0) {
            (bool ok,) = msg.sender.call{ value: refund }("");
            require(ok);
        }
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (PoolKey memory key, bool buy, uint256 amount) = abi.decode(data, (PoolKey, bool, uint256));
        BalanceDelta delta = manager.swap(
            key, SwapParams(buy, -int256(amount), buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1), ""
        );
        if (buy) {
            manager.settle{ value: uint256(-int256(delta.amount0())) }();
            manager.take(key.currency1, msgSender, uint256(uint128(delta.amount1())));
        } else {
            manager.sync(key.currency1);
            IERC20(Currency.unwrap(key.currency1)).transferFrom(msgSender, address(manager), amount);
            manager.settle();
            manager.take(key.currency0, msgSender, uint256(uint128(delta.amount0())));
        }
        return abi.encode(delta);
    }
}

contract LaunchProtectionV1Test is Test {
    address MANAGER;
    address constant DEV = address(0xD001);
    address constant BUYER = address(0xB001);
    uint256 constant SUPPLY = 1_000_000_000 ether;
    int24 constant START_TICK = 180_120; // At least USD 30k for 1b units with ETH at USD 2k.
    IPoolManager manager;
    TestPriceFeed feed;
    TestAuthenticatedRouter router;
    ProtectedNativeInitializerV1 initializer;
    ProtectedLaunchTokenV1 token;
    ProtectedNative30HookV1 hook;

    function _chain() internal pure virtual returns (uint256) {
        return 1;
    }

    function setUp() public {
        vm.chainId(_chain());
        MANAGER =
            _chain() == 1 ? 0x000000000004444c5dc75cB358380D2e3dE08A90 : 0x8366a39CC670B4001A1121B8F6A443A643e40951;
        vm.warp(100_000);
        vm.deal(address(this), 100 ether);
        vm.deal(DEV, 100 ether);
        vm.deal(BUYER, 100 ether);
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), MANAGER);
        manager = IPoolManager(MANAGER);
        feed = new TestPriceFeed();
        address routerAddress =
            _chain() == 1 ? 0xd92A36B0000531EF3063dEd4De20A0783308446C : 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
        deployCodeTo("TestAuthenticatedRouter", abi.encode(manager), routerAddress);
        router = TestAuthenticatedRouter(routerAddress);
        initializer = new ProtectedNativeInitializerV1(
            manager, address(this), ILaunchUsdFeedV1(address(feed)), address(feed).codehash
        );
        token = new ProtectedLaunchTokenV1("Protected", "GUARD", SUPPLY, address(initializer), MANAGER);
        _deployHook(address(router), address(router).codehash, [address(0xA1), address(0xA2), address(0xA3)]);
    }

    function _deployHook(address router_, bytes32 hash, address[3] memory exempt) internal {
        ProtectedNative30HookV1.PoolConfig memory config = ProtectedNative30HookV1.PoolConfig({
            token: address(token),
            lpFee: 0x800000,
            tickSpacing: 60,
            initialSqrtPriceX96: TickMath.getSqrtPriceAtTick(START_TICK),
            initializer: address(initializer),
            creatorFeeRecipient: DEV,
            creatorBuyFeeBps: 70,
            creatorSellFeeBps: 70,
            module: address(0),
            maxModuleLpFeePips: 990_000
        });
        bytes memory args = abi.encode(manager, config, DEV, router_, hash, exempt);
        (, bytes32 salt) = HookMiner.find(address(this), 0x20cc, type(ProtectedNative30HookV1).creationCode, args);
        hook = new ProtectedNative30HookV1{ salt: salt }(manager, config, DEV, router_, hash, exempt);
    }

    function _launch() internal {
        initializer.initialize{ value: 0.01 ether }(IProtectedLaunchHookV1(address(hook)), token, START_TICK, DEV, 1);
    }

    function test_atomicStartEnforcesFdvInitialBuyAndFee() public {
        _launch();
        assertGe(initializer.openingFdvUsd(), 30_000);
        assertEq(token.startedAt(), block.timestamp);
        assertGt(token.balanceOf(DEV), 0);
        assertLe(token.balanceOf(DEV), SUPPLY / 50);
        assertGt(initializer.lockedLiquidity(), 0);
        assertEq(hook.feeVault().platformAccrued(), 0.000_03 ether);
    }

    function test_noOrdinaryTransferBeforeStart() public {
        vm.prank(address(initializer));
        vm.expectRevert(ProtectedLaunchTokenV1.TradingNotStarted.selector);
        token.transfer(BUYER, 1);
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
        address[2] memory wallets = [DEV, address(0xA1)];
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
        LaunchProtectionModuleV1 module = LaunchProtectionModuleV1(hook.module());
        uint24 start = module.additionalLpFeePpm(BUYER);
        assertGt(start, 980_000);
        assertEq(module.additionalLpFeePpm(DEV), 0);
        assertEq(module.additionalLpFeePpm(address(0xA1)), 0);
        vm.warp(token.startedAt() + 15);
        assertLt(module.additionalLpFeePpm(BUYER), start);
        assertGt(module.additionalLpFeePpm(BUYER), 480_000);
        vm.warp(token.startedAt() + 30);
        assertEq(module.additionalLpFeePpm(BUYER), 0);
    }

    function test_realBuyAndSellPayPlatformOnce() public {
        _launch();
        uint256 before = hook.feeVault().platformAccrued();
        vm.startPrank(BUYER);
        router.swap{ value: 0.001 ether }(hook.poolKey(), true, 0.001 ether);
        uint256 tokens = token.balanceOf(BUYER);
        assertGt(tokens, 0);
        assertEq(hook.feeVault().platformAccrued() - before, 0.000_003 ether);
        token.approve(address(router), tokens);
        router.swap(hook.poolKey(), false, tokens / 2);
        vm.stopPrank();
        assertGt(hook.feeVault().platformAccrued(), before + 0.000_003 ether);
        uint256 owed = hook.feeVault().platformAccrued();
        address recipient = hook.feeVault().PLATFORM_RECIPIENT();
        uint256 balance = recipient.balance;
        hook.feeVault().claimPlatform();
        assertEq(recipient.balance - balance, owed);
        assertGt(initializer.lockedLiquidity(), 0);
    }

    function test_untrustedRouterAndSpoofedDataCannotClaimExemption() public {
        _launch();
        TestAuthenticatedRouter other = new TestAuthenticatedRouter(manager);
        PoolKey memory key = hook.poolKey();
        vm.prank(DEV);
        vm.expectRevert();
        other.swap{ value: 0.001 ether }(key, true, 0.001 ether);
    }

    function test_staleNegativeAndLowUsdPriceRollBackLaunch() public {
        feed.set(-1, block.timestamp);
        vm.expectRevert(ProtectedNativeInitializerV1.InvalidOraclePrice.selector);
        _launch();
        feed.set(2000e8, block.timestamp - 3601);
        vm.expectRevert(ProtectedNativeInitializerV1.InvalidOraclePrice.selector);
        _launch();
        feed.set(100e8, block.timestamp);
        vm.expectRevert();
        _launch();
        assertFalse(initializer.initialized());
        assertEq(token.startedAt(), 0);
    }

    function test_duplicateExemptionsRejected() public {
        vm.expectRevert(LaunchProtectionModuleV1.InvalidConfiguration.selector);
        new LaunchProtectionModuleV1(
            address(1),
            token,
            DEV,
            address(router),
            address(router).codehash,
            70,
            [address(0xA1), address(0xA1), address(0)]
        );
    }

    function test_initialBuyOverTwoPercentRollsBackEverything() public {
        vm.expectRevert();
        initializer.initialize{ value: 1 ether }(IProtectedLaunchHookV1(address(hook)), token, START_TICK, DEV, 1);
        assertFalse(initializer.initialized());
        assertEq(token.startedAt(), 0);
        assertEq(token.balanceOf(address(initializer)), SUPPLY);
    }

    function test_startAndInitializationCannotBeCalledByOtherWallet() public {
        vm.prank(BUYER);
        vm.expectRevert(ProtectedLaunchTokenV1.NotInitializer.selector);
        token.start();
        vm.prank(BUYER);
        vm.expectRevert(ProtectedNativeInitializerV1.Unauthorized.selector);
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
        LaunchProtectionModuleV1 module = LaunchProtectionModuleV1(hook.module());
        uint256 elapsed = bound(secondsElapsed, 0, 30);
        vm.warp(token.startedAt() + elapsed);
        uint24 current = module.additionalLpFeePpm(BUYER);
        vm.warp(token.startedAt() + elapsed + 1);
        assertLe(module.additionalLpFeePpm(BUYER), current);
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

    receive() external payable { }
}

/// @dev The same local Core behavior is exercised at the Robinhood chain/address binding.
/// This is not a provider-backed Robinhood fork or deployment proof.
contract RobinhoodLaunchProtectionV1Test is LaunchProtectionV1Test {
    function _chain() internal pure override returns (uint256) {
        return 4663;
    }
}
