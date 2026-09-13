// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import { AnyQuoteTypesV1 as A } from "../../../src/module-engine/any-quote/AnyQuoteTypesV1.sol";
import { AnyQuoteSharedHookV1 } from "../../../src/module-engine/any-quote/AnyQuoteSharedHookV1.sol";
import { AnyQuoteLedgerV1 } from "../../../src/module-engine/any-quote/AnyQuoteLedgerV1.sol";

contract AnyQuoteHookTestToken is ERC20 {
    uint8 private immutable _decimals;
    address public rejectedRecipient;

    error RecipientRejected();

    constructor(string memory symbol_, uint8 decimals_) ERC20(symbol_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function rejectRecipient(address recipient) external {
        rejectedRecipient = recipient;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to == rejectedRecipient) revert RecipientRejected();
        super._update(from, to, amount);
    }
}

/// @dev Real V4 position fixture, separate from the fee hook. No quote seed or LP withdrawal entrypoint.
contract AnyQuoteHookTestPosition is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager private immutable _manager;

    constructor(IPoolManager manager) {
        _manager = manager;
    }

    function initialize(PoolKey memory key, address token, int24 tick) external {
        bool token0 = Currency.unwrap(key.currency0) == token;
        int24 lower = token0 ? tick : TickMath.minUsableTick(A.TICK_SPACING);
        int24 upper = token0 ? TickMath.maxUsableTick(A.TICK_SPACING) : tick;
        _initialize(key, token, tick, lower, upper);
    }

    /// @dev A finite one-sided range makes complete inventory exhaustion practical in the hook fixture.
    function initializeNarrowRange(PoolKey memory key, address token, int24 tick) external {
        bool token0 = Currency.unwrap(key.currency0) == token;
        _initialize(key, token, tick, token0 ? tick : tick - A.TICK_SPACING, token0 ? tick + A.TICK_SPACING : tick);
    }

    function _initialize(PoolKey memory key, address token, int24 tick, int24 lower, int24 upper) private {
        _manager.initialize(key, TickMath.getSqrtPriceAtTick(tick));
        bool token0 = Currency.unwrap(key.currency0) == token;
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(lower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(upper);
        uint128 liquidity = token0
            ? LiquidityAmounts.getLiquidityForAmount0(sqrtLower, sqrtUpper, A.TOKEN_SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount1(sqrtLower, sqrtUpper, A.TOKEN_SUPPLY);
        _manager.unlock(abi.encode(key, token, lower, upper, liquidity));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(_manager));
        (PoolKey memory key, address token, int24 lower, int24 upper, uint128 liquidity) =
            abi.decode(data, (PoolKey, address, int24, int24, uint128));
        (BalanceDelta delta,) = _manager.modifyLiquidity(
            key, ModifyLiquidityParams(lower, upper, int256(uint256(liquidity)), bytes32(0)), ""
        );
        bool token0 = Currency.unwrap(key.currency0) == token;
        require((token0 ? delta.amount1() : delta.amount0()) == 0, "requires quote seed");
        int128 debt = token0 ? delta.amount0() : delta.amount1();
        require(debt < 0);
        _manager.sync(Currency.wrap(token));
        IERC20(token).safeTransfer(address(_manager), uint256(-int256(debt)));
        require(_manager.settle() == uint256(-int256(debt)));
        return "";
    }
}

contract AnyQuoteSharedHookV1Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    IPoolManager private manager;
    AnyQuoteSharedHookV1 private hook;
    AnyQuoteLedgerV1 private ledger;
    PoolSwapTest private router;
    address private alice;
    address private bob;
    address private creator;
    address private rewardAdmin;
    uint256 private serial;

    struct Fixture {
        AnyQuoteHookTestToken token;
        AnyQuoteHookTestToken quote;
        AnyQuoteHookTestPosition position;
        A.PoolRegistration registration;
        PoolKey key;
        bytes32 poolId;
        bool quote0;
    }

    struct BeforeTrade {
        uint256 platform;
        uint256 creator;
        uint16 platformRemainder;
        uint16 creatorRemainder;
        uint256 tokenBalance;
        uint256 quoteBalance;
        uint256 nativeBalance;
    }

    function setUp() public {
        vm.chainId(A.CHAIN_ID);
        alice = makeAddr("unprivileged-trader");
        bob = makeAddr("other-unprivileged-trader");
        creator = makeAddr("module-coin-creator");
        rewardAdmin = makeAddr("reward-admin");
        manager = IPoolManager(address(new PoolManager(address(this))));
        hook = _deployHook();
        ledger = AnyQuoteLedgerV1(hook.ledger());
        router = new PoolSwapTest(manager);
    }

    function test_allFourSwapFormsWithQuoteCurrency0() public {
        _fourForms(true);
    }

    function test_allFourSwapFormsWithQuoteCurrency1() public {
        _fourForms(false);
    }

    function test_firstBuyExactOutputWithNoQuoteReserveForBothOrders() public {
        for (uint256 i; i < 2; ++i) {
            Fixture memory f = _fixture(i == 0, 100, 300, true);
            assertEq(f.quote.balanceOf(address(manager)), 0);
            _assertTrade(f, true, int256(1 ether));
            assertGt(ledger.claimableQuote(address(f.quote), A.PLATFORM_RECIPIENT), 0);
            _assertBacking(f.quote);
        }
    }

    function test_registrationAndInitializationRequireAuthenticatedIdentities() public {
        Fixture memory f = _fixture(true, 100, 300, false);
        (address[] memory wallets, uint16[] memory shares) = _recipients();
        A.PoolRegistration memory untrusted = hook.poolConfig(f.poolId);
        untrusted.launchId = keccak256("untrusted");
        vm.prank(alice);
        vm.expectRevert(AnyQuoteSharedHookV1.UnauthorizedHost.selector);
        hook.registerPool(untrusted, wallets, shares);
        vm.expectRevert(AnyQuoteSharedHookV1.AlreadyRegistered.selector);
        hook.registerPool(f.registration, wallets, shares);

        vm.expectRevert();
        manager.initialize(f.key, TickMath.getSqrtPriceAtTick(f.registration.initialTick));
        vm.prank(address(f.position));
        vm.expectRevert();
        manager.initialize(f.key, TickMath.getSqrtPriceAtTick(f.registration.initialTick + 200));

        PoolKey memory impostor = PoolKey(f.key.currency0, f.key.currency1, 100, f.key.tickSpacing, f.key.hooks);
        vm.prank(address(f.position));
        vm.expectRevert();
        manager.initialize(impostor, TickMath.getSqrtPriceAtTick(f.registration.initialTick));
        f.position.initialize(f.key, address(f.token), f.registration.initialTick);
        _assertTrade(f, true, -int256(1 ether));
    }

    function test_registrationRejectsInvalidFeesTickAndDuplicateLaunch() public {
        Fixture memory f = _fixture(true, 100, 300, false);
        (address[] memory wallets, uint16[] memory shares) = _recipients();
        A.PoolRegistration memory r = hook.poolConfig(f.poolId);
        r.launchId = keccak256("invalid-registration");
        r.buyCreatorFeeBps = 1100;
        vm.expectRevert(AnyQuoteSharedHookV1.InvalidRegistration.selector);
        hook.registerPool(r, wallets, shares);
        r.buyCreatorFeeBps = 99;
        vm.expectRevert(AnyQuoteSharedHookV1.InvalidRegistration.selector);
        hook.registerPool(r, wallets, shares);
        r.buyCreatorFeeBps = 100;
        r.initialTick += 1;
        vm.expectRevert(AnyQuoteSharedHookV1.InvalidRegistration.selector);
        hook.registerPool(r, wallets, shares);
        r.initialTick -= 1;
        r.token = address(new AnyQuoteHookTestToken("OTHER", 18));
        r.launchId = f.registration.launchId;
        vm.expectRevert(AnyQuoteSharedHookV1.AlreadyRegistered.selector);
        hook.registerPool(r, wallets, shares);
    }

    function test_allPartialFillFormsRevertWithoutCarryOrFeeChanges() public {
        for (uint256 order; order < 2; ++order) {
            Fixture memory f = _fixture(order == 0, 100, 300, true);
            _assertTrade(f, true, -int256(10 ether));
            _assertPartial(f, true, -int256(1 ether));
            _assertPartial(f, true, int256(1 ether));
            _assertPartial(f, false, -int256(1 ether));
            _assertPartial(f, false, int256(0.001 ether));
        }
    }

    function test_poolAndDirectionCarryAreIsolatedAndMicroBuysAccumulateFees() public {
        Fixture memory a = _fixture(true, 100, 300, true);
        Fixture memory b = _fixture(false, 1000, 0, true);
        uint256 gross = 337;
        for (uint256 i; i < 40; ++i) {
            _assertTrade(a, true, -int256(gross));
        }
        assertEq(ledger.claimableQuote(address(a.quote), A.PLATFORM_RECIPIENT), (40 * gross * 30) / 10_000);
        (uint16 platform, uint16 author) = hook.feeCarry(b.poolId, true);
        assertEq(platform, 0);
        assertEq(author, 0);
        (platform, author) = hook.feeCarry(a.poolId, false);
        assertEq(platform, 0);
        assertEq(author, 0);
        assertEq(ledger.claimableQuote(address(b.quote), A.PLATFORM_RECIPIENT), 0);
        _assertTrade(b, true, -int256(1 ether));
        _assertTrade(b, false, -int256(1 ether));
        assertEq(ledger.claimableQuote(address(a.quote), A.PLATFORM_RECIPIENT), (40 * gross * 30) / 10_000);
    }

    function test_failedClaimDoesNotBlockTradingAndClaimsRedeemBacking() public {
        Fixture memory f = _fixture(true, 100, 300, true);
        _assertTrade(f, true, -int256(1 ether));
        uint256 firstFees = ledger.claimableQuote(address(f.quote), A.PLATFORM_RECIPIENT);
        vm.prank(A.PLATFORM_RECIPIENT);
        vm.expectRevert();
        ledger.claimQuoteTo(address(f.quote), address(0));
        assertEq(ledger.claimableQuote(address(f.quote), A.PLATFORM_RECIPIENT), firstFees);
        _assertTrade(f, true, -int256(1 ether));
        uint256 owed = ledger.claimableQuote(address(f.quote), A.PLATFORM_RECIPIENT);
        assertEq(ledger.claimQuoteFor(address(f.quote), A.PLATFORM_RECIPIENT), owed);
        assertEq(f.quote.balanceOf(A.PLATFORM_RECIPIENT), owed);
        _assertBacking(f.quote);
        _assertTrade(f, false, -int256(1 ether));
    }

    function test_anotherTraderCarryCanRejectTinyAmountWithoutChangingState() public {
        Fixture memory f = _fixture(true, 0, 0, true);
        uint256 snapshot = vm.snapshotState();
        _assertTrade(f, true, -int256(1));
        assertTrue(vm.revertToState(snapshot));
        _fundOtherTrader(f);
        _assertTradeFor(f, true, -int256(333), bob);
        (uint16 platform, uint16 author) = hook.feeCarry(f.poolId, true);
        assertEq(platform, 9990);
        assertEq(author, 0);
        bytes32 beforeState = _rollbackState(f);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                IHooks.beforeSwap.selector,
                abi.encodeWithSelector(AnyQuoteSharedHookV1.InvalidSwap.selector),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
        router.swap(
            f.key, SwapParams(f.quote0, -int256(1), _limit(f.quote0)), PoolSwapTest.TestSettings(false, false), ""
        );
        assertEq(_rollbackState(f), beforeState);
        _assertTrade(f, true, -int256(1 ether));
    }

    function test_exactMaxSellUsesAcquiredInventoryAfterAnotherTradersCarry() public {
        Fixture memory f = _fixture(true, 100, 300, true);
        _assertTrade(f, true, -int256(1 ether + 337));
        uint256 acquired = f.token.balanceOf(alice);
        _fundOtherTrader(f);
        _assertTradeFor(f, true, -int256(1 ether), bob);
        _assertTradeFor(f, false, int256(0.0001 ether + 337), bob);
        (uint16 platform, uint16 author) = hook.feeCarry(f.poolId, false);
        assertEq(platform, 6230);
        assertEq(author, 2300);
        uint256 bobQuote = f.quote.balanceOf(bob);
        uint256 bobToken = f.token.balanceOf(bob);
        uint256 quoteBefore = f.quote.balanceOf(alice);
        BalanceDelta delta = _assertTrade(f, false, -int256(acquired));
        assertEq(f.token.balanceOf(alice), 0);
        assertEq(f.quote.balanceOf(alice) - quoteBefore, uint256(int256(delta.amount0())));
        assertGt(f.quote.balanceOf(alice), quoteBefore);
        assertEq(f.quote.balanceOf(bob), bobQuote);
        assertEq(f.token.balanceOf(bob), bobToken);
        assertEq(
            ledger.totalReceived(address(f.quote)),
            manager.balanceOf(address(ledger), Currency.wrap(address(f.quote)).toId())
        );
    }

    function test_quoteClaimsRemainIndependentAfterPrimaryInventoryExhaustion() public {
        for (uint256 order; order < 2; ++order) {
            Fixture memory f = _fixture(order == 0, 100, 300, false);
            f.position.initializeNarrowRange(f.key, address(f.token), f.registration.initialTick);
            f.quote.mint(alice, 1_000_000 ether);
            f.quote.rejectRecipient(creator);
            // Core rounds the initial deposit up and the range's maximum swap output down.
            // The remaining raw unit is rounding dust, with no active liquidity left to execute a buy.
            _assertTrade(f, true, int256(f.token.balanceOf(address(manager)) - 1));
            assertEq(f.token.balanceOf(address(manager)), 1);
            assertEq(manager.getLiquidity(PoolId.wrap(f.poolId)), 0);
            bytes32 beforeState = _rollbackState(f);
            vm.prank(alice);
            vm.expectRevert();
            router.swap(
                f.key,
                SwapParams(f.quote0, -int256(1 ether), _limit(f.quote0)),
                PoolSwapTest.TestSettings(false, false),
                ""
            );
            assertEq(_rollbackState(f), beforeState);
            vm.expectRevert();
            ledger.claimQuoteFor(address(f.quote), creator);
            assertEq(_rollbackState(f), beforeState);

            bytes32 poolBefore = _poolState(f);
            uint256 platform = ledger.claimableQuote(address(f.quote), A.PLATFORM_RECIPIENT);
            uint256 author = ledger.claimableQuote(address(f.quote), creator);
            assertGt(platform, 0);
            assertGt(author, 0);
            uint256 lpQuote = f.quote.balanceOf(address(manager)) - platform - author;
            assertEq(ledger.claimQuoteFor(address(f.quote), A.PLATFORM_RECIPIENT), platform);
            assertEq(f.quote.balanceOf(A.PLATFORM_RECIPIENT), platform);
            vm.prank(creator);
            assertEq(ledger.claimQuoteTo(address(f.quote), alice), author);
            assertEq(ledger.claimableQuote(address(f.quote), creator), 0);
            assertEq(ledger.totalClaimed(address(f.quote)), platform + author);
            assertEq(f.quote.balanceOf(address(manager)), lpQuote);
            assertEq(f.quote.balanceOf(address(ledger)), 0);
            assertEq(f.quote.balanceOf(address(hook)), 0);
            assertEq(_poolState(f), poolBefore);
            _assertBacking(f.quote);
        }
    }

    function test_directCallbackCannotMintFees() public {
        Fixture memory f = _fixture(true, 100, 300, true);
        vm.prank(alice);
        vm.expectRevert();
        hook.beforeSwap(address(router), f.key, SwapParams(f.quote0, -int256(1 ether), _limit(f.quote0)), "");
        vm.prank(alice);
        vm.expectRevert();
        hook.afterSwap(
            address(router), f.key, SwapParams(f.quote0, -int256(1 ether), _limit(f.quote0)), BalanceDelta.wrap(0), ""
        );
        assertEq(manager.balanceOf(hook.ledger(), Currency.wrap(address(f.quote)).toId()), 0);
    }

    function _fourForms(bool quote0) private {
        Fixture memory f = _fixture(quote0, 100, 300, true);
        assertEq(f.quote.balanceOf(address(manager)), 0, "must not seed quote liquidity");
        _assertTrade(f, true, -int256(1 ether + 337));
        uint256 purchased = f.token.balanceOf(alice);
        _assertTrade(f, false, -int256(purchased / 3));
        _assertTrade(f, true, int256(2 ether));
        _assertTrade(f, false, int256(0.0001 ether + 337));
        _assertBacking(f.quote);
    }

    function _assertTrade(Fixture memory f, bool buy, int256 specified) private returns (BalanceDelta delta) {
        return _assertTradeFor(f, buy, specified, alice);
    }

    function _assertTradeFor(Fixture memory f, bool buy, int256 specified, address actor)
        private
        returns (BalanceDelta delta)
    {
        BeforeTrade memory before_;
        before_.platform = ledger.claimableQuote(address(f.quote), A.PLATFORM_RECIPIENT);
        before_.creator = ledger.claimableQuote(address(f.quote), creator);
        (before_.platformRemainder, before_.creatorRemainder) = hook.feeCarry(f.poolId, buy);
        before_.tokenBalance = f.token.balanceOf(actor);
        before_.quoteBalance = f.quote.balanceOf(actor);
        before_.nativeBalance = actor.balance;
        vm.prank(actor);
        delta = router.swap(
            f.key,
            SwapParams(buy == f.quote0, specified, _limit(buy == f.quote0)),
            PoolSwapTest.TestSettings(false, false),
            hex"deadbeef"
        );
        uint256 platform = ledger.claimableQuote(address(f.quote), A.PLATFORM_RECIPIENT) - before_.platform;
        uint256 creatorFee = ledger.claimableQuote(address(f.quote), creator) - before_.creator;
        int128 quoteDelta = f.quote0 ? delta.amount0() : delta.amount1();
        int128 tokenDelta = f.quote0 ? delta.amount1() : delta.amount0();
        assertTrue(buy ? quoteDelta < 0 && tokenDelta > 0 : quoteDelta > 0 && tokenDelta < 0);
        uint256 gross = buy ? uint256(-int256(quoteDelta)) : uint256(int256(quoteDelta)) + platform + creatorFee;
        {
            uint256 creatorBps = buy ? f.registration.buyCreatorFeeBps : f.registration.sellCreatorFeeBps;
            assertEq(platform, (gross * 30 + before_.platformRemainder) / 10_000);
            assertEq(creatorFee, (gross * creatorBps + before_.creatorRemainder) / 10_000);
            (uint16 nextP, uint16 nextC) = hook.feeCarry(f.poolId, buy);
            assertEq(nextP, (gross * 30 + before_.platformRemainder) % 10_000);
            assertEq(nextC, (gross * creatorBps + before_.creatorRemainder) % 10_000);
        }
        if (specified < 0) assertEq(buy ? int256(quoteDelta) : int256(tokenDelta), specified);
        else assertEq(buy ? int256(tokenDelta) : int256(quoteDelta), specified);
        _assertActorDelta(f.quote, actor, before_.quoteBalance, quoteDelta);
        _assertActorDelta(f.token, actor, before_.tokenBalance, tokenDelta);
        assertEq(actor.balance, before_.nativeBalance);
        assertEq(f.token.balanceOf(address(router)), 0);
        assertEq(f.quote.balanceOf(address(router)), 0);
        _assertBacking(f.quote);
    }

    function _assertPartial(Fixture memory f, bool buy, int256 specified) private {
        (uint160 price,,,) = manager.getSlot0(PoolId.wrap(f.poolId));
        bool zeroForOne = buy == f.quote0;
        uint160 limit = zeroForOne ? price - 1 : price + 1;
        bytes32 beforeState = _rollbackState(f);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                IHooks.afterSwap.selector,
                abi.encodeWithSelector(AnyQuoteSharedHookV1.PartialFillUnsupported.selector),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
        router.swap(f.key, SwapParams(zeroForOne, specified, limit), PoolSwapTest.TestSettings(false, false), "");
        assertEq(_rollbackState(f), beforeState);
    }

    function _fundOtherTrader(Fixture memory f) private {
        f.quote.mint(bob, 1000 ether);
        vm.startPrank(bob);
        f.quote.approve(address(router), type(uint256).max);
        f.token.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _assertActorDelta(AnyQuoteHookTestToken asset, address actor, uint256 beforeBalance, int128 delta)
        private
        view
    {
        assertEq(
            asset.balanceOf(actor),
            delta < 0 ? beforeBalance - uint256(-int256(delta)) : beforeBalance + uint256(int256(delta))
        );
    }

    function _rollbackState(Fixture memory f) private view returns (bytes32 state) {
        (uint16 buyP, uint16 buyC) = hook.feeCarry(f.poolId, true);
        (uint16 sellP, uint16 sellC) = hook.feeCarry(f.poolId, false);
        state = keccak256(
            abi.encode(
                _poolState(f),
                _ledgerState(f),
                buyP,
                buyC,
                sellP,
                sellC,
                f.token.totalSupply(),
                f.quote.totalSupply(),
                manager.isUnlocked(),
                manager.getNonzeroDeltaCount()
            )
        );
        address[9] memory accounts = [
            alice,
            bob,
            creator,
            A.PLATFORM_RECIPIENT,
            address(router),
            address(hook),
            address(ledger),
            address(f.position),
            address(manager)
        ];
        for (uint256 i; i < accounts.length; ++i) {
            state = keccak256(abi.encode(state, _accountState(f, accounts[i])));
        }
    }

    function _accountState(Fixture memory f, address account) private view returns (bytes32) {
        bytes32 balances = keccak256(
            abi.encode(
                f.token.balanceOf(account),
                f.quote.balanceOf(account),
                account.balance,
                ledger.claimableQuote(address(f.quote), account),
                ledger.claimedBy(address(f.quote), account),
                ledger.contributionByLaunch(f.registration.launchId, account)
            )
        );
        bytes32 claims = keccak256(
            abi.encode(
                manager.balanceOf(account, Currency.wrap(address(f.token)).toId()),
                manager.balanceOf(account, Currency.wrap(address(f.quote)).toId()),
                manager.balanceOf(account, 0)
            )
        );
        return keccak256(
            abi.encode(
                balances,
                claims,
                manager.currencyDelta(account, Currency.wrap(address(f.token))),
                manager.currencyDelta(account, Currency.wrap(address(f.quote))),
                manager.currencyDelta(account, Currency.wrap(address(0)))
            )
        );
    }

    function _ledgerState(Fixture memory f) private view returns (bytes32) {
        (uint256 platform, uint256 author, uint256 credited) = ledger.accounting(f.registration.launchId);
        return keccak256(
            abi.encode(
                platform,
                author,
                credited,
                ledger.totalReceived(address(f.quote)),
                ledger.totalCredited(address(f.quote)),
                ledger.totalClaimed(address(f.quote))
            )
        );
    }

    function _poolState(Fixture memory f) private view returns (bytes32) {
        (uint160 price, int24 tick, uint24 protocolFee, uint24 lpFee) = manager.getSlot0(PoolId.wrap(f.poolId));
        (uint256 fee0, uint256 fee1) = manager.getFeeGrowthGlobals(PoolId.wrap(f.poolId));
        return keccak256(
            abi.encode(price, tick, protocolFee, lpFee, fee0, fee1, manager.getLiquidity(PoolId.wrap(f.poolId)))
        );
    }

    function _fixture(bool quote0, uint16 buyBps, uint16 sellBps, bool initialize) private returns (Fixture memory f) {
        AnyQuoteHookTestToken x = new AnyQuoteHookTestToken("X", 18);
        AnyQuoteHookTestToken y = new AnyQuoteHookTestToken("Y", 18);
        f.quote0 = quote0;
        f.quote = (address(x) < address(y)) == quote0 ? x : y;
        f.token = address(f.quote) == address(x) ? y : x;
        f.position = new AnyQuoteHookTestPosition(manager);
        f.registration = A.PoolRegistration({
            launchId: keccak256(abi.encode("launch", ++serial)),
            revisionId: keccak256("reviewed-revision"),
            familyId: keccak256("original-author-family"),
            configurationHash: keccak256(abi.encode(address(f.quote), quote0, buyBps, sellBps)),
            token: address(f.token),
            quoteAsset: address(f.quote),
            initializer: address(f.position),
            initialTick: quote0 ? int24(100_000) : int24(-100_000),
            buyCreatorFeeBps: buyBps,
            sellCreatorFeeBps: sellBps
        });
        (address[] memory wallets, uint16[] memory shares) = _recipients();
        f.poolId = hook.registerPool(f.registration, wallets, shares);
        f.key = hook.poolKey(f.poolId);
        assertEq(PoolId.unwrap(f.key.toId()), f.poolId);
        assertEq(hook.poolIdOfLaunch(f.registration.launchId), f.poolId);
        assertEq(address(f.key.hooks), address(hook));
        assertEq(f.key.fee, 0);
        f.token.mint(address(f.position), A.TOKEN_SUPPLY);
        f.quote.mint(alice, 1000 ether);
        vm.startPrank(alice);
        f.quote.approve(address(router), type(uint256).max);
        f.token.approve(address(router), type(uint256).max);
        vm.stopPrank();
        if (initialize) f.position.initialize(f.key, address(f.token), f.registration.initialTick);
    }

    function _recipients() private view returns (address[] memory wallets, uint16[] memory shares) {
        wallets = new address[](1);
        wallets[0] = creator;
        shares = new uint16[](1);
        shares[0] = 10_000;
    }

    function _assertBacking(AnyQuoteHookTestToken quote) private view {
        uint256 owed = ledger.claimableQuote(address(quote), A.PLATFORM_RECIPIENT)
            + ledger.claimableQuote(address(quote), creator);
        assertEq(manager.balanceOf(hook.ledger(), Currency.wrap(address(quote)).toId()), owed);
    }

    function _limit(bool zeroForOne) private pure returns (uint160) {
        return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
    }

    function _deployHook() private returns (AnyQuoteSharedHookV1 deployed) {
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        bytes32 initHash = keccak256(
            abi.encodePacked(type(AnyQuoteSharedHookV1).creationCode, abi.encode(manager, address(this), rewardAdmin))
        );
        for (uint256 i; i < 160_444; ++i) {
            bytes32 salt = bytes32(i);
            address predicted =
                address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initHash)))));
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK != flags) continue;
            deployed = new AnyQuoteSharedHookV1{ salt: salt }(manager, address(this), rewardAdmin);
            assertEq(address(deployed), predicted);
            return deployed;
        }
        revert("hook salt not found");
    }
}
