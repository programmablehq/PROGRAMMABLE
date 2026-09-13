// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PathKey } from "@uniswap/v4-periphery/src/libraries/PathKey.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { ClassicModuleLaunchPolicyV1 } from "../../../src/classic-modules/ClassicModuleLaunchPolicyV1.sol";
import { ModuleNativeRegistryV1 } from "../../../src/module-mode/engine/ModuleNativeRegistryV1.sol";
import { ModuleEngineTypesV1 as T } from "../../../src/module-engine/ModuleEngineTypesV1.sol";
import {
    ModuleEngineAnyQuoteHostV1 as Host
} from "../../../src/module-engine/any-quote/ModuleEngineAnyQuoteHostV1.sol";
import {
    AnyQuoteNativeRouteGuardV1 as Guard
} from "../../../src/module-engine/any-quote/AnyQuoteNativeRouteGuardV1.sol";
import { AnyQuoteSharedHookV1 } from "../../../src/module-engine/any-quote/AnyQuoteSharedHookV1.sol";
import { AnyQuoteLPModuleV1 } from "../../../src/module-engine/any-quote/AnyQuoteLPModuleV1.sol";
import { AnyQuoteLedgerV1 } from "../../../src/module-engine/any-quote/AnyQuoteLedgerV1.sol";
import { AnyQuoteTypesV1 as A } from "../../../src/module-engine/any-quote/AnyQuoteTypesV1.sol";

interface PairTokenUniversalRouterPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
    function allowance(address owner, address token, address spender) external view returns (uint160, uint48, uint48);
}

interface PairTokenUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @dev Historical fork simulation: local native funding and newly deployed quote-fee profile.
///      Live canonical router, Permit2, PGRAM token, factory, policy and PoolManager are reused unchanged.
contract PairTokenUniversalRouterForkV1Test is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    uint256 private constant SNAPSHOT_BLOCK = 60_166_703;
    uint128 private constant ETH_INPUT = 0.0001 ether;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant CAROL = address(0xCA401);
    address private constant AUTHOR = A.PLATFORM_RECIPIENT;
    address private constant MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address private constant ROUTER = 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
    address private constant QUOTE = 0xC60bA256B44334A0Cd2C7242E98B88f031abB006;
    address private constant QUOTE_HOOK = 0x720e649549F7BC2118aCBA9F4C9ae6fCC7586080;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes32 private constant REVISION = keccak256("pair token canonical router fork");
    Host private host;
    AnyQuoteSharedHookV1 private hook;
    AnyQuoteLedgerV1 private ledger;
    ModuleNativeRegistryV1 private registry;
    IPoolManager private manager;
    PoolKey private market;
    bytes32 private family;
    uint32[] private runtimeOffsets;
    uint32[] private constructorOffsets;

    struct Location {
        uint256 length;
        uint256 start;
    }

    // UR v2.1.1 exact-in/out multi-hop tuples have identical types and field order.
    // The currency is input for exact-in, output for exact-out; the limit is minimum output / maximum input.
    struct RouterMultihop {
        Currency currency;
        PathKey[] path;
        uint256[] minHopPriceX36;
        uint128 amount;
        uint128 limit;
    }

    struct RouterExactInputSingle {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    struct Trade {
        bool buy;
        bool exactOutput;
        bool nativeRoute;
        uint128 amount;
        uint128 limit;
        address payer;
        address recipient;
    }

    struct FeeBefore {
        uint256 received;
        uint16 platformCarry;
        uint16 creatorCarry;
    }

    struct TradeSnapshot {
        address input;
        address output;
        uint256 cap;
        uint256 inputBalance;
        uint256 outputBalance;
        uint256 gasUsed;
        FeeBefore fees;
    }

    struct SwapObservation {
        bool buy;
        bool exactInput;
        uint256 gross;
        uint256 platform;
        uint256 creator;
        int128 amount0;
        int128 amount1;
    }
    error LegacyNativeFeeMarketUnavailable();
    error NestedFeeCallerRejected();
    receive() external payable { }

    function setUp() public {
        string memory rpc = vm.envOr("PAIR_TOKEN_ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        assertEq(block.chainid, 4663);
        assertEq(block.timestamp, 1_789_120_505);
        vm.deal(BOB, 1 ether);
        manager = IPoolManager(MANAGER);
        assertEq(MANAGER.codehash, bytes32(0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626));
        market = PoolKey(Currency.wrap(address(0)), Currency.wrap(QUOTE), 8_388_608, 60, IHooks(QUOTE_HOOK));
        assertEq(
            PoolId.unwrap(market.toId()), bytes32(0x3df16f271060e4941c0386047def159f42e629dc0455db623c5b363eeacbcc1d)
        );
        assertGt(manager.getLiquidity(market.toId()), 0);
        registry = new ModuleNativeRegistryV1(address(this));
        family = registry.registerReviewedFamily(AUTHOR, bytes32("pair fee author"), AUTHOR, bytes32("fork review"));
        address predictedHost = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        bytes32 initHash = keccak256(
            bytes.concat(
                vm.getCode("AnyQuoteSharedHookV1.sol:AnyQuoteSharedHookV1"),
                abi.encode(manager, predictedHost, address(this))
            )
        );
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        bytes32 salt;
        for (uint256 i;; ++i) {
            salt = bytes32(i);
            if (uint160(vm.computeCreate2Address(salt, initHash, predictedHost)) & Hooks.ALL_HOOK_MASK == flags) break;
        }
        host = Host(
            deployCode(
                "ModuleEngineAnyQuoteHostV1.sol:ModuleEngineAnyQuoteHostV1",
                abi.encode(
                    UERC20Factory(0x754e8c1ADe3C6C4c863590a91F2ED020baF8E779),
                    ClassicModuleLaunchPolicyV1(0xF3FF250759A66EDc7893bbA9D34dAF4ba4Ae4caA),
                    registry,
                    manager,
                    address(this),
                    salt,
                    Guard(0x92C1D5735a89488a77841634c48d922cd3f2c0e4)
                )
            )
        );
        assertEq(address(host), predictedHost);
        assertEq(ROUTER.codehash, host.UNIVERSAL_ROUTER_CODE_HASH());
        hook = AnyQuoteSharedHookV1(address(host.sharedHook()));
        ledger = AnyQuoteLedgerV1(address(host.ledger()));
        _bindings();
        _approve(REVISION, bytes32(0));
        // Fault injection applies only to a hypothetical nested fee swap. Normal market routing stays real.
        vm.mockCallRevert(
            QUOTE_HOOK,
            abi.encodeWithSelector(IHooks.beforeSwap.selector, address(hook)),
            abi.encodeWithSelector(NestedFeeCallerRejected.selector)
        );
    }

    function test_pairTokenCanonicalExactInputAndAcquiredMaxSell() public {
        Host.Launch memory launched = _launch();
        (, uint256 bought) = _trade(launched, Trade(true, false, true, ETH_INPUT, 1, BOB, BOB));
        assertEq(IERC20(launched.token).balanceOf(BOB), bought);
        _trade(launched, Trade(false, false, true, uint128(bought), 1, BOB, CAROL));
        assertEq(IERC20(launched.token).balanceOf(BOB), 0, "sell exact acquired Max inventory");
        assertEq(IERC20(QUOTE).balanceOf(BOB), 0, "intermediate quote stays netted");
        _claimQuote(launched);
    }

    function test_pairTokenCanonicalExactOutputBuySellAndRefund() public {
        Host.Launch memory launched = _launch();
        _trade(launched, Trade(true, true, true, 10_000 ether, ETH_INPUT, BOB, CAROL));
        assertEq(IERC20(launched.token).balanceOf(CAROL), 10_000 ether);
        _trade(launched, Trade(false, true, true, 0.000_001 ether, 10_000 ether, CAROL, BOB));
        assertEq(IERC20(launched.token).balanceOf(BOB), 0, "buy output sent only to explicit recipient");
        _claimQuote(launched);
    }

    function test_pairTokenDirectTradingAndClaimsIgnoreUnavailableNativeFeeMarket() public {
        Host.Launch memory launched = _launch();
        uint256 quoteBought = _acquireQuote();
        assertGt(quoteBought, 0);
        // Local failure injection, not a claim that this historical market actually lost liquidity.
        vm.mockCallRevert(
            MANAGER,
            abi.encodeWithSelector(IPoolManager.swap.selector, market),
            abi.encodeWithSelector(LegacyNativeFeeMarketUnavailable.selector)
        );
        (, uint256 bought) = _trade(launched, Trade(true, false, false, uint128(quoteBought), 1, BOB, BOB));
        _trade(launched, Trade(false, false, false, uint128(bought), 1, BOB, CAROL));
        assertEq(IERC20(launched.token).balanceOf(BOB), 0);
        _claimQuote(launched);
    }

    function test_pairTokenAtomicNativeInitialBuyAndMinimumRollback() public {
        Host.LaunchParameters memory p = _parameters();
        _setInitialNativeBuy(p);
        address token = p.initialOperation.outputAsset;
        vm.deal(ALICE, 1 ether); // Local fork funding, no live wallet action.
        uint256 beforeEth = ALICE.balance;
        uint256 beforeQuote = IERC20(QUOTE).balanceOf(ALICE);
        p.initialOperation.minimumOutput = A.TOKEN_SUPPLY;
        vm.prank(ALICE);
        vm.expectRevert(Host.InsufficientOutput.selector);
        host.launch{ value: ETH_INPUT }(p);
        assertEq(token.code.length, 0, "failed initial buy rolls back token and launch");
        assertEq(ALICE.balance, beforeEth);
        assertEq(ledger.totalReceived(QUOTE), 0);
        p.initialOperation.minimumOutput = 1;
        vm.recordLogs();
        vm.prank(ALICE);
        uint256 beforeGas = gasleft();
        Host.Launch memory launched = host.launch{ value: ETH_INPUT }(p);
        uint256 gasUsed = beforeGas - gasleft();
        FeeBefore memory fees;
        uint256 totalFees = _assertSwapLogs(
            vm.getRecordedLogs(),
            host.poolIdOf(launched.launchId),
            Trade(true, false, true, ETH_INPUT, 1, ALICE, ALICE),
            fees
        );
        uint256 bought = IERC20(token).balanceOf(ALICE);
        assertGt(bought, 0);
        assertEq(beforeEth - ALICE.balance, ETH_INPUT);
        assertEq(IERC20(QUOTE).balanceOf(ALICE), beforeQuote, "no prior quote approval or user quote spend");
        assertEq(host.nonces(launched.launchId, ALICE), 1);
        assertEq(IERC20(token).totalSupply(), A.TOKEN_SUPPLY);
        assertEq(
            IERC20(token).balanceOf(MANAGER) + bought + AnyQuoteLPModuleV1(launched.engine).lockedTokenDust(),
            A.TOKEN_SUPPLY
        );
        assertEq(ledger.totalReceived(QUOTE), totalFees);
        _assertQuoteBacking(launched.launchId);
        _assertNoResidue(token);
        emit log_named_uint("atomic launch native input raw", ETH_INPUT);
        emit log_named_uint("atomic launch bought token raw", bought);
        emit log_named_uint("atomic launch and initial buy gas (fork)", gasUsed);
        _claimQuote(launched);
    }

    function _setInitialNativeBuy(Host.LaunchParameters memory p) private view {
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        bool quote0 = QUOTE < token;
        PoolKey memory primary = PoolKey(
            Currency.wrap(quote0 ? QUOTE : token), Currency.wrap(quote0 ? token : QUOTE), 0, 200, IHooks(address(hook))
        );
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(address(0), uint128(ETH_INPUT), false);
        params[1] = abi.encode(RouterExactInputSingle(market, true, ETH_INPUT, 1, 0, ""));
        params[2] = abi.encode(RouterExactInputSingle(primary, quote0, 0, 1, 0, ""));
        params[3] = abi.encode(token, ALICE, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"0b06060e", params);
        p.initialOperation = T.Operation(
            host.NATIVE_BUY(),
            ALICE,
            ALICE,
            address(0),
            ETH_INPUT,
            token,
            1,
            block.timestamp + 600,
            0,
            abi.encode(hex"10", inputs)
        );
    }

    function _parameters() private view returns (Host.LaunchParameters memory p) {
        p.name = "Pair Token Canonical Router";
        p.symbol = "PAIRUR";
        p.creatorSalt = bytes32(uint256(1));
        p.revisionId = REVISION;
        p.quoteAsset = QUOTE;
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        // Reused historical PGRAM quote-price fixture; independent USD price preparation remains API-owned.
        p.configuration = abi.encode(
            A.Configuration(
                A.SCHEMA_ID,
                MANAGER,
                MANAGER.codehash,
                address(hook),
                QUOTE,
                QUOTE < token ? int24(50_400) : int24(-50_400),
                uint64(block.timestamp + 180),
                keccak256("historical PGRAM market price fixture")
            )
        );
        p.creationCode = vm.getCode("AnyQuoteLPModuleV1.sol:AnyQuoteLPModuleV1");
        p.runtimeTemplate = vm.getDeployedCode("AnyQuoteLPModuleV1.sol:AnyQuoteLPModuleV1");
        p.creatorWallets = new address[](1);
        p.creatorWallets[0] = ALICE;
        p.creatorSharesBps = new uint16[](1);
        p.creatorSharesBps[0] = 10_000;
        p.buyCreatorFeeBps = 100;
        p.sellCreatorFeeBps = 200;
    }

    function _launch() private returns (Host.Launch memory launched) {
        Host.LaunchParameters memory p = _parameters();
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        uint256 quoteBefore = IERC20(QUOTE).balanceOf(MANAGER);
        vm.prank(ALICE);
        launched = host.launch(p);
        assertEq(IERC20(QUOTE).balanceOf(MANAGER), quoteBefore, "no quote supplied to initial LP");
        assertEq(IERC20(token).totalSupply(), A.TOKEN_SUPPLY);
        assertEq(
            IERC20(token).balanceOf(MANAGER) + AnyQuoteLPModuleV1(launched.engine).lockedTokenDust(), A.TOKEN_SUPPLY
        );
        assertEq(ledger.quoteAsset(launched.launchId), QUOTE);
        assertEq(ledger.platformFeeBps(launched.launchId), 30);
        assertEq(launched.buyCreatorFeeBps, 100);
        assertEq(launched.sellCreatorFeeBps, 200);
        assertEq(ledger.totalReceived(QUOTE), 0);
        _assertNoResidue(token);
    }

    function _trade(Host.Launch memory launched, Trade memory p) private returns (uint256 spent, uint256 received) {
        TradeSnapshot memory before;
        before.input = p.buy ? (p.nativeRoute ? address(0) : QUOTE) : launched.token;
        before.output = p.buy ? launched.token : (p.nativeRoute ? address(0) : QUOTE);
        before.cap = p.exactOutput ? p.limit : p.amount;
        before.inputBalance = _balance(before.input, p.payer);
        before.outputBalance = _balance(before.output, p.recipient);
        before.fees.received = ledger.totalReceived(QUOTE);
        (before.fees.platformCarry, before.fees.creatorCarry) = hook.feeCarry(host.poolIdOf(launched.launchId), p.buy);
        {
            bytes[] memory inputs = _inputs(launched.token, p);
            vm.startPrank(p.payer);
            if (before.input != address(0)) {
                if (IERC20(before.input).allowance(p.payer, PERMIT2) < before.cap) {
                    IERC20(before.input).approve(PERMIT2, before.cap);
                }
                PairTokenUniversalRouterPermit2(PERMIT2)
                    .approve(before.input, ROUTER, uint160(before.cap), uint48(block.timestamp + 600));
            }
            vm.recordLogs();
            uint256 beforeGas = gasleft();
            PairTokenUniversalRouter(ROUTER).execute{ value: before.input == address(0) ? before.cap : 0 }(
                before.input == address(0) && p.exactOutput ? bytes(hex"1004") : bytes(hex"10"),
                inputs,
                block.timestamp + 600
            );
            before.gasUsed = beforeGas - gasleft();
            vm.stopPrank();
        }
        uint256 expectedFees = _assertSwapLogs(vm.getRecordedLogs(), host.poolIdOf(launched.launchId), p, before.fees);
        spent = before.inputBalance - _balance(before.input, p.payer);
        received = _balance(before.output, p.recipient) - before.outputBalance;
        assertGt(spent, 0);
        assertGt(received, 0);
        if (p.exactOutput) {
            assertEq(received, p.amount);
            assertLt(spent, before.cap, "actual input bounded and refund retained by payer");
        } else {
            assertEq(spent, p.amount);
            assertGe(received, p.limit);
        }
        if (before.input != address(0)) {
            (uint160 remaining,,) = PairTokenUniversalRouterPermit2(PERMIT2).allowance(p.payer, before.input, ROUTER);
            assertEq(uint256(remaining), before.cap - spent);
        }
        assertEq(ledger.totalReceived(QUOTE), before.fees.received + expectedFees);
        _assertQuoteBacking(launched.launchId);
        _assertNoResidue(launched.token);
        emit log_named_uint(p.buy ? "BUY actual input raw" : "SELL actual input raw", spent);
        emit log_named_uint(p.buy ? "BUY output raw" : "SELL output raw", received);
        emit log_named_uint("composed canonical router gas (fork)", before.gasUsed);
        emit log_named_uint("backed pair-token fee raw", expectedFees);
    }

    function _inputs(address token, Trade memory p) private view returns (bytes[] memory inputs) {
        PoolKey memory primary = hook.poolKey(host.poolIdOf(host.launchIdOf(token)));
        address input = p.buy ? (p.nativeRoute ? address(0) : QUOTE) : token;
        address output = p.buy ? token : (p.nativeRoute ? address(0) : QUOTE);
        PathKey[] memory path = new PathKey[](p.nativeRoute ? 2 : 1);
        if (p.nativeRoute) {
            path[p.buy ? 0 : 1] = PathKey(
                Currency.wrap(p.exactOutput ? (p.buy ? address(0) : QUOTE) : (p.buy ? QUOTE : address(0))),
                market.fee,
                market.tickSpacing,
                market.hooks,
                ""
            );
            path[p.buy ? 1 : 0] = PathKey(
                Currency.wrap(p.exactOutput ? (p.buy ? QUOTE : token) : (p.buy ? token : QUOTE)),
                primary.fee,
                primary.tickSpacing,
                primary.hooks,
                ""
            );
        } else {
            path[0] = PathKey(
                Currency.wrap(p.exactOutput ? input : output), primary.fee, primary.tickSpacing, primary.hooks, ""
            );
        }
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            RouterMultihop(Currency.wrap(p.exactOutput ? output : input), path, new uint256[](0), p.amount, p.limit)
        );
        params[1] = abi.encode(input, uint256(p.exactOutput ? p.limit : p.amount));
        params[2] = abi.encode(output, p.recipient, uint256(0));
        bool refund = input == address(0) && p.exactOutput;
        inputs = new bytes[](refund ? 2 : 1);
        inputs[0] = abi.encode(
            abi.encodePacked(
                uint8(p.exactOutput ? Actions.SWAP_EXACT_OUT : Actions.SWAP_EXACT_IN),
                uint8(Actions.SETTLE_ALL),
                uint8(Actions.TAKE)
            ),
            params
        );
        if (refund) inputs[1] = abi.encode(address(0), p.payer, uint256(0));
    }

    function _assertSwapLogs(Vm.Log[] memory logs, bytes32 primaryId, Trade memory p, FeeBefore memory fees)
        private
        view
        returns (uint256 totalFees)
    {
        bytes32 swapSig = keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
        bytes32 quoteSig =
            keccak256("QuotePoolSwap(bytes32,bytes32,address,bool,bool,uint256,uint256,uint256,int128,int128)");
        uint256 primarySwaps;
        uint256 marketSwaps;
        uint256 quoteEvents;
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory entry = logs[i];
            if (entry.emitter == MANAGER && entry.topics.length == 3 && entry.topics[0] == swapSig) {
                address sender = address(uint160(uint256(entry.topics[2])));
                assertTrue(sender != address(hook), "quote-fee hook never swaps a conversion market");
                if (entry.topics[1] == primaryId && sender == ROUTER) ++primarySwaps;
                if (entry.topics[1] == PoolId.unwrap(market.toId()) && sender == ROUTER) ++marketSwaps;
            }
            if (entry.emitter == address(hook) && entry.topics.length == 4 && entry.topics[0] == quoteSig) {
                assertEq(entry.topics[1], primaryId);
                assertEq(address(uint160(uint256(entry.topics[3]))), ROUTER);
                SwapObservation memory s = abi.decode(entry.data, (SwapObservation));
                assertEq(s.buy, p.buy);
                assertEq(s.exactInput, !p.exactOutput);
                assertEq(s.platform, (s.gross * 30 + fees.platformCarry) / 10_000);
                assertEq(s.creator, (s.gross * (p.buy ? 100 : 200) + fees.creatorCarry) / 10_000);
                totalFees = s.platform + s.creator;
                ++quoteEvents;
            }
        }
        assertEq(primarySwaps, 1);
        assertEq(quoteEvents, 1);
        assertEq(marketSwaps, p.nativeRoute ? 1 : 0);
        assertGt(totalFees, 0);
    }

    function _acquireQuote() private returns (uint256 bought) {
        PathKey[] memory path = new PathKey[](1);
        path[0] = PathKey(Currency.wrap(QUOTE), market.fee, market.tickSpacing, market.hooks, "");
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(RouterMultihop(Currency.wrap(address(0)), path, new uint256[](0), ETH_INPUT, 1));
        params[1] = abi.encode(address(0), uint256(ETH_INPUT));
        params[2] = abi.encode(QUOTE, BOB, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"070c0e", params);
        uint256 before = IERC20(QUOTE).balanceOf(BOB);
        vm.prank(BOB);
        PairTokenUniversalRouter(ROUTER).execute{ value: ETH_INPUT }(hex"10", inputs, block.timestamp + 600);
        bought = IERC20(QUOTE).balanceOf(BOB) - before;
    }

    function _assertQuoteBacking(bytes32 launchId) private view {
        (uint256 platform, uint256 creator, uint256 credited) = ledger.accounting(launchId);
        assertEq(platform + creator, credited);
        assertEq(credited, ledger.totalReceived(QUOTE));
        assertEq(credited, ledger.totalCredited(QUOTE));
        assertEq(platform, ledger.contributionByLaunch(launchId, A.PLATFORM_RECIPIENT));
        assertEq(creator, ledger.contributionByLaunch(launchId, ALICE));
        assertEq(
            platform, ledger.claimableQuote(QUOTE, A.PLATFORM_RECIPIENT) + ledger.claimedBy(QUOTE, A.PLATFORM_RECIPIENT)
        );
        assertEq(creator, ledger.claimableQuote(QUOTE, ALICE) + ledger.claimedBy(QUOTE, ALICE));
        assertEq(manager.balanceOf(address(ledger), uint256(uint160(QUOTE))), credited - ledger.totalClaimed(QUOTE));
        assertEq(manager.balanceOf(address(ledger), 0), 0, "fees are pair-token claims, never ETH claims");
    }

    function _claimQuote(Host.Launch memory launched) private {
        uint256 creator = ledger.claimableQuote(QUOTE, ALICE);
        uint256 platform = ledger.claimableQuote(QUOTE, A.PLATFORM_RECIPIENT);
        uint256 creatorBefore = IERC20(QUOTE).balanceOf(ALICE);
        uint256 platformBefore = IERC20(QUOTE).balanceOf(A.PLATFORM_RECIPIENT);
        uint256 creatorEth = ALICE.balance;
        uint256 platformEth = A.PLATFORM_RECIPIENT.balance;
        vm.prank(ALICE);
        assertEq(ledger.claimQuoteTo(QUOTE, ALICE), creator);
        assertEq(ledger.claimQuoteFor(QUOTE, A.PLATFORM_RECIPIENT), platform);
        assertEq(IERC20(QUOTE).balanceOf(ALICE) - creatorBefore, creator);
        assertEq(IERC20(QUOTE).balanceOf(A.PLATFORM_RECIPIENT) - platformBefore, platform);
        assertEq(ALICE.balance, creatorEth);
        assertEq(A.PLATFORM_RECIPIENT.balance, platformEth);
        assertEq(ledger.totalReceived(QUOTE), ledger.totalClaimed(QUOTE));
        _assertQuoteBacking(launched.launchId);
        _assertNoResidue(launched.token);
        emit log_named_uint("creator directly claimed PGRAM raw", creator);
        emit log_named_uint("platform directly claimed PGRAM raw", platform);
    }

    function _assertNoResidue(address token) private view {
        address[4] memory actors = [ROUTER, address(host), address(hook), address(ledger)];
        for (uint256 i; i < actors.length; ++i) {
            assertEq(actors[i].balance, 0);
            assertEq(IERC20(QUOTE).balanceOf(actors[i]), 0);
            assertEq(IERC20(token).balanceOf(actors[i]), 0);
            assertEq(manager.currencyDelta(actors[i], Currency.wrap(address(0))), 0);
            assertEq(manager.currencyDelta(actors[i], Currency.wrap(QUOTE)), 0);
            assertEq(manager.currencyDelta(actors[i], Currency.wrap(token)), 0);
        }
        assertFalse(manager.isUnlocked());
    }

    function _balance(address asset, address who) private view returns (uint256) {
        return asset == address(0) ? who.balance : IERC20(asset).balanceOf(who);
    }

    function _bindings() private {
        // Isolated builds pass only their compiled immutable-reference JSON through the environment.
        string memory json = vm.envOr("PAIR_TOKEN_LP_IMMUTABLE_REFERENCES", string(""));
        if (bytes(json).length == 0) json = vm.readFile("out/AnyQuoteLPModuleV1.sol/AnyQuoteLPModuleV1.json");
        string memory root = ".deployedBytecode.immutableReferences";
        string[] memory keys = vm.parseJsonKeys(json, root);
        assertEq(keys.length, 4, "only direct constructor words may be immutable");
        for (uint256 i; i < keys.length; ++i) {
            for (uint256 j = i + 1; j < keys.length; ++j) {
                if (vm.parseUint(keys[j]) < vm.parseUint(keys[i])) (keys[i], keys[j]) = (keys[j], keys[i]);
            }
        }
        uint32[4] memory words = [uint32(288), uint32(352), uint32(320), uint32(416)];
        for (uint256 i; i < keys.length; ++i) {
            Location[] memory locations =
                abi.decode(vm.parseJson(json, string.concat(root, ".", keys[i])), (Location[]));
            for (uint256 j; j < locations.length; ++j) {
                assertEq(locations[j].length, 32);
                runtimeOffsets.push(uint32(locations[j].start));
                constructorOffsets.push(words[i]);
            }
        }
        for (uint256 i; i < runtimeOffsets.length; ++i) {
            for (uint256 j = i + 1; j < runtimeOffsets.length; ++j) {
                if (runtimeOffsets[j] < runtimeOffsets[i]) {
                    (runtimeOffsets[i], runtimeOffsets[j]) = (runtimeOffsets[j], runtimeOffsets[i]);
                    (constructorOffsets[i], constructorOffsets[j]) = (constructorOffsets[j], constructorOffsets[i]);
                }
            }
        }
    }

    function _approve(bytes32 revisionId, bytes32 fixedConfig) private {
        T.Revision memory revision = T.Revision(
            family,
            keccak256(vm.getCode("AnyQuoteLPModuleV1.sol:AnyQuoteLPModuleV1")),
            keccak256(vm.getDeployedCode("AnyQuoteLPModuleV1.sol:AnyQuoteLPModuleV1")),
            bytes32("source reviewed manifest"),
            address(0),
            fixedConfig,
            host.BUY(),
            10_000_000,
            3,
            0,
            true
        );
        T.Permission[] memory permissions = new T.Permission[](2);
        permissions[0] = T.Permission(host.BUY(), T.ROLE_QUOTE, T.ROLE_PRIMARY, T.AUTH_PUBLIC);
        permissions[1] = T.Permission(host.SELL(), T.ROLE_PRIMARY, T.ROLE_QUOTE, T.AUTH_PUBLIC);
        bytes32[] memory families = new bytes32[](1);
        families[0] = family;
        host.approveRevision(revisionId, revision, runtimeOffsets, constructorOffsets, permissions, families);
    }
}
