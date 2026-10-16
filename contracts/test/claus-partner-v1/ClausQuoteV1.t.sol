// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { ClausLaunchTokenV1 } from "../../src/claus-partner-v1/ClausLaunchTokenV1.sol";
import { ClausQuoteHookV1 } from "../../src/claus-partner-v1/ClausQuoteHookV1.sol";
import { ClausQuoteInitializerV1, IClausUsdFeedV1 } from "../../src/claus-partner-v1/ClausQuoteInitializerV1.sol";

// Local fixtures only. No transaction or fixture is sent to a public chain.
contract ClausQuoteFixture is ERC20 {
    constructor() ERC20("Fixture CLAUS", "CLAUS") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ClausFeedFixture {
    uint8 public constant decimals = 8;
    uint256 public updated;
    bool public broken;

    constructor() {
        updated = block.timestamp;
    }

    function breakFeed() external {
        broken = true;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!broken);
        return (1, 1e8, updated, updated, 1);
    }
}

contract ClausPolicyFixture {
    uint256 public mode;
    uint256 public rate;

    function set(uint256 m, uint256 r) external {
        mode = m;
        rate = r;
    }

    function evaluate(bytes calldata) external returns (bytes memory) {
        if (mode == 1) revert();
        if (mode == 2) return abi.encode(uint256(147_001));
        if (mode == 3) return new bytes(20_000);
        if (mode == 4) rate = 5000;
        if (mode == 5) {
            assembly { for { } 1 { } { } }
        }
        return abi.encode(rate);
    }
}

contract ClausRouterFixture is IUnlockCallback {
    IPoolManager public immutable manager;
    address public msgSender;

    constructor(IPoolManager m) {
        manager = m;
    }

    function swap(PoolKey calldata key, bool zeroForOne, int256 amount) external returns (BalanceDelta) {
        require(msgSender == address(0));
        msgSender = msg.sender;
        BalanceDelta result = abi.decode(manager.unlock(abi.encode(key, zeroForOne, amount)), (BalanceDelta));
        msgSender = address(0);
        return result;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (PoolKey memory key, bool zeroForOne, int256 amount) = abi.decode(data, (PoolKey, bool, int256));
        BalanceDelta d = manager.swap(
            key,
            SwapParams(zeroForOne, amount, zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1),
            ""
        );
        _settle(key.currency0, d.amount0());
        _settle(key.currency1, d.amount1());
        return abi.encode(d);
    }

    function _settle(Currency currency, int128 amount) private {
        if (amount < 0) {
            manager.sync(currency);
            require(
                IERC20(Currency.unwrap(currency)).transferFrom(msgSender, address(manager), uint256(-int256(amount)))
            );
            manager.settle();
        } else if (amount > 0) {
            manager.take(currency, msgSender, uint256(uint128(amount)));
        }
    }
}

contract ClausQuoteV1Test is Test {
    address constant QUOTE = 0x1b54E762aa34CF6E28E9C082F2848e28E45DA6b8;
    address constant MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant BUYER = address(0xB001);
    address constant CREATOR = address(0xC001);
    uint256 constant SUPPLY = 1_000_000_000 ether;
    IPoolManager manager;
    ClausQuoteFixture quote;
    ClausFeedFixture feed;
    ClausPolicyFixture policy;
    ClausRouterFixture router;
    ClausLaunchTokenV1 token;
    ClausQuoteHookV1 hook;
    ClausQuoteInitializerV1 initializer;
    int24 startTick;

    function _below() internal pure virtual returns (bool) {
        return false;
    }

    function setUp() public {
        vm.chainId(1);
        vm.warp(100_000);
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), MANAGER);
        deployCodeTo("ClausQuoteFixture", "", QUOTE);
        manager = IPoolManager(MANAGER);
        quote = ClausQuoteFixture(QUOTE);
        quote.mint(address(this), 10_000 ether);
        quote.mint(BUYER, 10_000 ether);
        feed = new ClausFeedFixture();
        policy = new ClausPolicyFixture();
        router = new ClausRouterFixture(manager);
        initializer = new ClausQuoteInitializerV1(
            manager, address(this), address(this), BUYER, IClausUsdFeedV1(address(feed)), address(feed).codehash, 3600
        );
        bytes memory tokenCode = abi.encodePacked(
            type(ClausLaunchTokenV1).creationCode,
            abi.encode("Project", "EXAMPLE", SUPPLY, address(initializer), MANAGER)
        );
        for (uint256 i; i < 100; ++i) {
            bytes32 salt = bytes32(i);
            address predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(tokenCode)))))
            );
            if ((predicted < QUOTE) == _below()) {
                token = new ClausLaunchTokenV1{ salt: salt }(
                    "Project", "EXAMPLE", SUPPLY, address(initializer), MANAGER
                );
                break;
            }
        }
        require(address(token) != address(0));
        startTick = _below() ? int24(-111_000) : int24(111_000);
        ClausQuoteHookV1.Config memory c = ClausQuoteHookV1.Config({
            token: token,
            initializer: address(initializer),
            initialBuyer: BUYER,
            creatorFeeRecipient: CREATOR,
            buyerRouter: address(router),
            buyerRouterCodeHash: address(router).codehash,
            feePolicy: address(policy),
            feePolicyCodeHash: address(policy).codehash,
            fallbackBuyCreatorPpm: 0,
            fallbackSellCreatorPpm: 0,
            initialSqrtPriceX96: TickMath.getSqrtPriceAtTick(startTick)
        });
        (, bytes32 hookSalt) =
            HookMiner.find(address(this), 0x20cc, type(ClausQuoteHookV1).creationCode, abi.encode(manager, c));
        hook = new ClausQuoteHookV1{ salt: hookSalt }(manager, c);
        quote.approve(address(initializer), type(uint256).max);
        vm.startPrank(BUYER);
        quote.approve(address(router), type(uint256).max);
        token.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _launch() internal {
        initializer.initialize(hook, token, startTick, 1 ether, 1);
    }

    function _swap(bool buy, int256 amount) internal {
        _swapExpect(buy, amount, false);
    }

    function _swapExpect(bool buy, int256 amount, bool reverts) internal {
        PoolKey memory key = hook.poolKey();
        bool direction = buy == hook.quoteIsCurrency0();
        if (reverts) vm.expectRevert();
        vm.prank(BUYER);
        router.swap(key, direction, amount);
    }

    function test_atomicSeedAndIndependentRecipient() public {
        _launch();
        assertGe(initializer.openingFdvUsd(), 15_000);
        assertGt(initializer.lockedLiquidity(), 0);
        assertGt(token.balanceOf(BUYER), 0);
        assertEq(token.balanceOf(CREATOR), 0);
        assertEq(hook.feeVault().creatorRecipient(), CREATOR);
        assertEq(hook.feeVault().platformAccrued(), 0.003 ether);
        assertEq(manager.balanceOf(address(hook.feeVault()), uint256(uint160(QUOTE))), 0.003 ether);
    }

    function test_directPoolBuySellAndClaim() public {
        _launch();
        vm.warp(block.timestamp + 301);
        policy.set(0, 10_000);
        _swap(true, -int256(1 ether));
        uint256 beforeSell = hook.feeVault().platformAccrued();
        _swap(false, -int256(token.balanceOf(BUYER) / 2));
        assertGt(hook.feeVault().platformAccrued(), beforeSell);
        uint256 creatorFees = hook.feeVault().creatorAccrued();
        assertGt(creatorFees, 0);
        hook.feeVault().claimCreator();
        assertEq(quote.balanceOf(CREATOR), creatorFees);
        uint256 platform = hook.feeVault().platformAccrued();
        hook.feeVault().claimPlatform();
        assertEq(quote.balanceOf(hook.feeVault().PLATFORM_RECIPIENT()), platform);
    }

    function test_failingOptionalPolicyCannotBlockSells() public {
        _launch();
        vm.warp(block.timestamp + 301);
        feed.breakFeed();
        for (uint256 mode = 1; mode <= 5; ++mode) {
            policy.set(mode, 0);
            uint256 beforeBalance = quote.balanceOf(BUYER);
            _swap(false, -int256(100 ether));
            assertGt(quote.balanceOf(BUYER), beforeBalance);
        }
    }

    function test_allSwapModesChargeQuoteWithinAggregateCap() public {
        _launch();
        vm.warp(block.timestamp + 301);
        policy.set(0, 147_000);
        for (uint256 i; i < 4; ++i) {
            uint256 quoteBefore = quote.balanceOf(BUYER);
            uint256 feesBefore = hook.feeVault().platformAccrued() + hook.feeVault().creatorAccrued();
            uint256 platformBefore = hook.feeVault().platformAccrued();
            bool buy = i < 2;
            _swap(
                buy,
                i == 0
                    ? -int256(1 ether)
                    : i == 1 ? int256(100 ether) : i == 2 ? -int256(100 ether) : int256(0.001 ether)
            );
            uint256 fees = hook.feeVault().platformAccrued() + hook.feeVault().creatorAccrued() - feesBefore;
            uint256 gross = buy ? quoteBefore - quote.balanceOf(BUYER) : quote.balanceOf(BUYER) - quoteBefore + fees;
            assertLe(fees, gross * 150_000 / 1_000_000);
            assertEq(hook.feeVault().platformAccrued() - platformBefore, (gross * 3000 + 999_999) / 1_000_000);
        }
    }

    function test_forwardingAndSellingCannotRefillOpeningBudgets() public {
        _launch();
        _swap(false, -int256(100 ether));
        uint256 remainder = token.walletTokenLimit() - token.receivedDuringProtection(BUYER);
        _swap(true, int256(remainder));
        uint256 bought = hook.boughtDuringProtection(BUYER);
        uint256 balance = token.balanceOf(BUYER);
        vm.prank(BUYER);
        token.transfer(CREATOR, balance);
        assertEq(token.receivedDuringProtection(BUYER), token.walletTokenLimit());
        assertEq(hook.boughtDuringProtection(BUYER), bought);
        _swapExpect(true, int256(1 ether), true);
    }

    function test_startCannotRestartAndLpCannotWithdraw() public {
        _launch();
        vm.prank(address(initializer));
        vm.expectRevert(ClausLaunchTokenV1.AlreadyStarted.selector);
        token.start();
        (bool ok,) = address(initializer).call(abi.encodeWithSignature("withdraw(uint256)", 1));
        assertFalse(ok);
        (ok,) = address(hook).call(abi.encodeWithSignature("upgradeTo(address)", address(this)));
        assertFalse(ok);
    }

    function test_capExpiresWithoutReset() public {
        _launch();
        _swapExpect(true, -int256(500 ether), true);
        vm.warp(token.startedAt() + 300);
        _swap(true, -int256(500 ether));
        assertGt(token.balanceOf(BUYER), SUPPLY / 50);
    }

    function test_roundingDustAndExactOutputCap() public {
        policy.set(0, 147_000);
        (uint256 gross, uint256 platform, uint256 creator) = hook.quoteFees(7, false, true);
        assertEq(gross, 7);
        assertEq(platform + creator, 1);
        (gross, platform, creator) = hook.quoteFees(6, true, false);
        assertEq(gross - platform - creator, 6);
        assertLe(platform + creator, gross * 150_000 / 1_000_000);
        vm.expectRevert(ClausQuoteHookV1.InvalidSwap.selector);
        hook.quoteFees(2, false, true);
    }

    function testFuzz_feeAndInverseStayWithinHardCap(uint128 raw, uint24 rate) public {
        uint256 amount = bound(uint256(raw), 7, 1e30);
        uint256 creatorRate = bound(uint256(rate), 0, 147_000);
        policy.set(0, creatorRate);
        (uint256 gross, uint256 platform, uint256 creator) = hook.quoteFees(amount, false, true);
        assertEq(gross, amount);
        assertLe(platform + creator, gross * 150_000 / 1_000_000);
        assertEq(platform, (gross * 3000 + 999_999) / 1_000_000);
        (gross, platform, creator) = hook.quoteFees(amount, true, false);
        assertEq(gross - platform - creator, amount);
        assertLe(platform + creator, gross * 150_000 / 1_000_000);
    }
}

contract ClausQuoteReverseV1Test is ClausQuoteV1Test {
    function _below() internal pure override returns (bool) {
        return true;
    }
}
