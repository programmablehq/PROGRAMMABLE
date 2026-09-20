// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { IV4Router } from "@uniswap/v4-periphery-v211/src/interfaces/IV4Router.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { FoundationTypesV1 as T } from "../../src/module-foundation/FoundationTypesV1.sol";
import { FoundationFactoryV3 } from "../../src/module-foundation/FoundationFactoryV3.sol";
import { IFoundationUniversalRouterV2 } from "../../src/module-foundation/FoundationFactoryV2.sol";
import { FoundationHookDeployerV2 } from "../../src/module-foundation/FoundationHookDeployerV2.sol";
import { FoundationHookV2 } from "../../src/module-foundation/FoundationHookV2.sol";
import { FoundationLedgerV1 } from "../../src/module-foundation/FoundationLedgerV1.sol";
import { FoundationLaunchTypesV3 as P } from "../../src/module-foundation/FoundationLaunchTypesV3.sol";
import { FoundationFeeMathV1 as F } from "../../src/module-foundation/FoundationFeeMathV1.sol";
import { FoundationLaunchTypesV2 as L } from "../../src/module-foundation/FoundationLaunchTypesV2.sol";
import {
    FoundationQuoteFixture,
    FoundationStatefulFixture,
    FoundationFixtureFactory
} from "./FoundationFixturesV1.sol";

/// @notice Local fork execution against canonical Core/PM/UR bytecode. No mocked periphery or broadcast.
/// Set FOUNDATION_RPC_URL and FOUNDATION_FORK_BLOCK explicitly; recorded local genesis is sufficient.
abstract contract FoundationForkBaseV3 is Test {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    address internal constant MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant POSM = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address internal constant ROUTER = 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    uint256 public constant SNAPSHOT_BLOCK = 63_704_585;
    IPoolManager internal manager = IPoolManager(MANAGER);
    IPositionManager internal positions = IPositionManager(POSM);
    IAllowanceTransfer internal permits = IAllowanceTransfer(PERMIT2);
    FoundationFactoryV3 internal factory;
    FoundationHookDeployerV2 internal deployer;
    FoundationQuoteFixture internal quote;
    uint256 internal serial;

    function setUp() public virtual {
        string memory rpc = vm.envOr("FOUNDATION_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, vm.envOr("FOUNDATION_FORK_BLOCK", SNAPSHOT_BLOCK));
        assertEq(block.chainid, 4663);
        assertEq(MANAGER.codehash, bytes32(0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626));
        assertEq(POSM.codehash, bytes32(0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2));
        assertEq(ROUTER.codehash, bytes32(0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5));
        assertEq(PERMIT2.codehash, bytes32(0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca));
        deployer = FoundationHookDeployerV2(deployCode("FoundationHookDeployerV2.sol:FoundationHookDeployerV2"));
        bytes32[5] memory hashes =
            [MANAGER.codehash, POSM.codehash, ROUTER.codehash, PERMIT2.codehash, address(deployer).codehash];
        factory = FoundationFactoryV3(
            deployCode(
                "FoundationFactoryV3.sol:FoundationFactoryV3",
                abi.encode(manager, positions, IFoundationUniversalRouterV2(ROUTER), permits, deployer, hashes)
            )
        );
        quote = new FoundationQuoteFixture(18);
        quote.mint(ALICE, 1_000_000 ether);
        vm.prank(ALICE);
        quote.approve(address(factory), type(uint256).max);
    }

    function _params(bool quote0, uint16 creatorBuyBps, uint16 creatorSellBps, uint128 extra, uint128 initial)
        internal
        returns (P.LaunchParamsV3 memory p)
    {
        p.metadata = T.Metadata(
            "Foundation technical fixture",
            "MFIX",
            "Real onchain metadata fixture",
            "ipfs://bafy-test-fixture-image",
            "https://example.com",
            bytes('{"version":1,"twitter":"https://x.com/example"}')
        );
        p.quote = address(quote);
        p.quoteDecimals = quote.decimals();
        p.initialTick = quote0 ? int24(120_000) : int24(-120_000);
        p.creatorBuyFeeBps = creatorBuyBps;
        p.creatorSellFeeBps = creatorSellBps;
        p.additionalQuoteAmount = extra;
        p.initialBuyQuoteAmount = initial;
        p.initialBuyMinimumTokenAmount = initial == 0 ? 0 : 1;
        p.deadline = uint64(block.timestamp + 120);
        do {
            p.tokenSalt = bytes32(++serial);
        } while ((address(quote) < factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata)) != quote0);
        p.modules = new T.ModuleSelection[](0);
        _mine(p);
    }

    function _mine(P.LaunchParamsV3 memory p) internal view {
        address token = factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata);
        bytes32 initHash = factory.hookInitCodeHash(ALICE, token, p);
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        for (uint256 i;; ++i) {
            p.hookSalt = bytes32(i);
            address predicted = vm.computeCreate2Address(p.hookSalt, initHash, address(deployer));
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == flags) return;
        }
    }

    function _launch(P.LaunchParamsV3 memory p) internal returns (L.LaunchResultV2 memory r) {
        vm.prank(ALICE);
        r = factory.launch(p);
    }

    function tradeExternal(L.LaunchResultV2 memory r, bool buy, bool exactIn, uint256 amount)
        external
        returns (uint256)
    {
        return _trade(r, buy, exactIn, amount);
    }

    function _trade(L.LaunchResultV2 memory r, bool buy, bool exactIn, uint256 amount)
        internal
        returns (uint256 other)
    {
        FoundationHookV2 hook = FoundationHookV2(r.hook);
        address input = buy ? address(quote) : r.token;
        address output = buy ? r.token : address(quote);
        uint256 beforeInput = IERC20(input).balanceOf(ALICE);
        uint256 beforeOutput = IERC20(output).balanceOf(ALICE);
        uint256 beforePlatform = FoundationLedgerV1(r.ledger).platformReceived();
        uint256 beforeCreator = FoundationLedgerV1(r.ledger).creatorReceived();
        (uint16 carryP, uint16 carryC) = hook.feeCarry(buy);
        vm.startPrank(ALICE);
        IERC20(input).approve(PERMIT2, type(uint256).max);
        permits.approve(input, ROUTER, type(uint160).max, uint48(block.timestamp + 120));
        bytes[] memory params = new bytes[](3);
        params[0] = exactIn
            ? abi.encode(
                IV4Router.ExactInputSingleParams(hook.poolKey(), input < output, uint128(amount), 1, 0, bytes(""))
            )
            : abi.encode(
                IV4Router.ExactOutputSingleParams(
                    hook.poolKey(), input < output, uint128(amount), uint128(beforeInput), 0, bytes("")
                )
            );
        params[1] = abi.encode(Currency.wrap(input), exactIn ? amount : beforeInput);
        params[2] = abi.encode(Currency.wrap(output), exactIn ? uint256(1) : amount);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(
            abi.encodePacked(
                uint8(exactIn ? Actions.SWAP_EXACT_IN_SINGLE : Actions.SWAP_EXACT_OUT_SINGLE),
                uint8(Actions.SETTLE_ALL),
                uint8(Actions.TAKE_ALL)
            ),
            params
        );
        IFoundationUniversalRouterV2(ROUTER).execute(hex"10", inputs, block.timestamp + 120);
        vm.stopPrank();
        uint256 spent = beforeInput - IERC20(input).balanceOf(ALICE);
        uint256 received = IERC20(output).balanceOf(ALICE) - beforeOutput;
        if (exactIn) {
            assertEq(spent, amount);
            other = received;
        } else {
            assertEq(received, amount);
            other = spent;
        }
        uint256 platform = FoundationLedgerV1(r.ledger).platformReceived() - beforePlatform;
        uint256 creator = FoundationLedgerV1(r.ledger).creatorReceived() - beforeCreator;
        uint256 gross = buy ? spent : received + platform + creator;
        assertEq(platform, (gross * 30 + carryP) / 10_000);
        assertEq(creator, (gross * (buy ? hook.creatorBuyFeeBps() : hook.creatorSellFeeBps()) + carryC) / 10_000);
        assertEq(
            manager.balanceOf(r.ledger, uint256(uint160(address(quote)))),
            FoundationLedgerV1(r.ledger).outstandingBacking()
        );
        (uint16 nextP, uint16 nextC) = hook.feeCarry(buy);
        assertEq(nextP, (gross * 30 + carryP) % 10_000);
        assertEq(nextC, (gross * (buy ? hook.creatorBuyFeeBps() : hook.creatorSellFeeBps()) + carryC) % 10_000);
        _assertClean(r);
    }

    function _selections(bool conflict, uint8 firstFault, uint8 secondFault)
        internal
        returns (T.ModuleSelection[] memory s)
    {
        FoundationFixtureFactory f = new FoundationFixtureFactory();
        s = new T.ModuleSelection[](2);
        for (uint256 i; i < 2; ++i) {
            T.Descriptor memory d = T.Descriptor(
                bytes32(i + 1),
                1,
                7,
                1,
                100_000,
                100_000,
                1_500_000,
                i == 1,
                conflict ? bytes32(uint256(1)) : bytes32(0)
            );
            bytes memory config = abi.encode(d, i == 0 ? firstFault : secondFault);
            s[i] = T.ModuleSelection(
                address(f),
                address(f).codehash,
                keccak256(type(FoundationStatefulFixture).runtimeCode),
                keccak256(abi.encode(d)),
                config,
                2500
            );
        }
    }

    function _assertClean(L.LaunchResultV2 memory r) internal view {
        address[5] memory actors = [POSM, ROUTER, address(factory), r.hook, r.ledger];
        for (uint256 i; i < actors.length; ++i) {
            assertEq(manager.currencyDelta(actors[i], Currency.wrap(r.token)), 0);
            assertEq(manager.currencyDelta(actors[i], Currency.wrap(address(quote))), 0);
        }
        assertEq(IERC20(r.token).allowance(address(factory), PERMIT2), 0);
        assertEq(quote.allowance(address(factory), PERMIT2), 0);
        (uint160 allowance,,) = permits.allowance(address(factory), r.token, POSM);
        assertEq(allowance, 0);
        (allowance,,) = permits.allowance(address(factory), address(quote), POSM);
        assertEq(allowance, 0);
        (allowance,,) = permits.allowance(address(factory), address(quote), ROUTER);
        assertEq(allowance, 0);
    }
}

contract FoundationDirectionalFeesV3Test is FoundationForkBaseV3 {
    using StateLibrary for IPoolManager;

    function test_independentRatesAllSwapQuadrantsAndBothCurrencyOrders() public {
        for (uint256 order; order < 2; ++order) {
            this.checkFourDirections(order == 0, 0, 1000);
            this.checkFourDirections(order == 0, 1000, 0);
            this.checkFourDirections(order == 0, 100, 300);
        }
    }

    function checkFourDirections(bool quote0, uint16 buyBps, uint16 sellBps) external {
        P.LaunchParamsV3 memory p = _params(quote0, buyBps, sellBps, 0, 0);
        L.LaunchResultV2 memory r = _launch(p);
        FoundationHookV2 hook = FoundationHookV2(r.hook);
        assertEq(hook.creatorBuyFeeBps(), buyBps);
        assertEq(hook.creatorSellFeeBps(), sellBps);
        assertEq(hook.compositionHash(), keccak256(abi.encode(T.ABI_ID, p.modules)));
        assertEq(hook.previewGrossFees(true, 10_000).creator, buyBps);
        assertEq(hook.previewGrossFees(false, 10_000).creator, sellBps);
        (uint256 buyGross, F.Result memory buyPreview) = hook.previewNetFees(true, 10_000);
        (uint256 sellGross, F.Result memory sellPreview) = hook.previewNetFees(false, 10_000);
        assertEq(buyGross - buyPreview.creator - buyPreview.platform, 10_000);
        assertEq(sellGross - sellPreview.creator - sellPreview.platform, 10_000);
        assertEq(buyPreview.creator, buyGross * buyBps / 10_000);
        assertEq(sellPreview.creator, sellGross * sellBps / 10_000);
        uint256 bought = _trade(r, true, true, 1 ether + 37);
        (uint16 sellP, uint16 sellC) = hook.feeCarry(false);
        assertEq(sellP, 0);
        assertEq(sellC, 0);
        assertGt(_trade(r, true, false, bought / 4), 0);
        (uint16 buyP, uint16 buyC) = hook.feeCarry(true);
        uint256 soldQuote = _trade(r, false, true, bought / 3);
        assertGt(_trade(r, false, false, soldQuote / 3), 0);
        (uint16 finalBuyP, uint16 finalBuyC) = hook.feeCarry(true);
        assertEq(finalBuyP, buyP);
        assertEq(finalBuyC, buyC);
        FoundationLedgerV1 ledger = FoundationLedgerV1(r.ledger);
        uint256 platform = ledger.platformReceived();
        uint256 creator = ledger.creatorCredited();
        uint256 beforePlatform = quote.balanceOf(T.PLATFORM_RECIPIENT);
        ledger.claimPlatform();
        assertEq(quote.balanceOf(T.PLATFORM_RECIPIENT) - beforePlatform, platform);
        if (creator != 0) {
            uint256 beforeCreator = quote.balanceOf(ALICE);
            ledger.claimCreator();
            assertEq(quote.balanceOf(ALICE) - beforeCreator, creator);
        }
        assertEq(ledger.outstandingBacking(), 0);
        assertEq(manager.balanceOf(r.ledger, uint256(uint160(address(quote)))), 0);
        assertEq(IERC721(POSM).ownerOf(r.basePositionId), DEAD);
        assertEq(factory.VERSION_ID(), keccak256("programmable.module-foundation.factory.v3"));
        assertEq(factory.MODULE_ABI_ID(), T.ABI_ID);
        _assertClean(r);
    }

    function test_initialBuyUsesBuyRateAndPreservesV2Custody() public {
        P.LaunchParamsV3 memory p = _params(false, 100, 900, 2 ether, 1 ether + 73);
        L.LaunchResultV2 memory r = _launch(p);
        FoundationLedgerV1 ledger = FoundationLedgerV1(r.ledger);
        assertGt(r.initialBuyTokenAmount, 0);
        assertEq(ledger.creatorReceived(), uint256(p.initialBuyQuoteAmount) * 100 / 10_000);
        assertEq(ledger.platformReceived(), uint256(p.initialBuyQuoteAmount) * 30 / 10_000);
        assertEq(IERC721(POSM).ownerOf(r.basePositionId), DEAD);
        assertEq(IERC721(POSM).ownerOf(r.creatorPositionId), DEAD);
        (uint16 sellP, uint16 sellC) = FoundationHookV2(r.hook).feeCarry(false);
        assertEq(sellP, 0);
        assertEq(sellC, 0);
        _assertClean(r);
    }

    function test_eachRateRetainsWholePercentageRangeValidation() public {
        uint16[4] memory invalid = [uint16(1), 101, 1001, 1100];
        for (uint256 i; i < invalid.length; ++i) {
            for (uint256 side; side < 2; ++side) {
                P.LaunchParamsV3 memory p =
                    _params(true, side == 0 ? invalid[i] : 100, side == 1 ? invalid[i] : 300, 0, 0);
                address predicted = factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata);
                vm.prank(ALICE);
                vm.expectRevert(FoundationHookV2.InvalidConfiguration.selector);
                factory.launch(p);
                assertEq(predicted.code.length, 0);
                assertEq(factory.launchOf(predicted).token, address(0));
            }
        }
    }

    function test_partialFillExactInputAndOutputRollbackIncludingCarries() public {
        L.LaunchResultV2 memory r = _launch(_params(true, 100, 300, 0, 0));
        FoundationHookV2 hook = FoundationHookV2(r.hook);
        PoolSwapTest alternate = new PoolSwapTest(manager);
        vm.prank(ALICE);
        quote.approve(address(alternate), type(uint256).max);
        (uint160 start,,,) = manager.getSlot0(PoolId.wrap(r.poolId));
        PoolKey memory key = hook.poolKey();
        for (uint256 exactness; exactness < 2; ++exactness) {
            SwapParams memory s =
                SwapParams(true, exactness == 0 ? -int256(100 ether) : int256(T.TOKEN_SUPPLY / 2), start - 1);
            vm.prank(ALICE);
            vm.expectRevert();
            alternate.swap(key, s, PoolSwapTest.TestSettings(false, false), "");
            (uint160 afterPrice,,,) = manager.getSlot0(PoolId.wrap(r.poolId));
            assertEq(start, afterPrice);
            assertEq(FoundationLedgerV1(r.ledger).platformReceived(), 0);
            (uint16 a, uint16 b) = hook.feeCarry(true);
            assertEq(a, 0);
            assertEq(b, 0);
        }
        _assertClean(r);
    }

    function test_statefulCompatibleCompositionBudgetsAndLaunchIsolation() public {
        P.LaunchParamsV3 memory p = _params(true, 100, 300, 0, 0);
        p.modules = _selections(false, 0, 0);
        _mine(p);
        L.LaunchResultV2 memory r = _launch(p);
        _trade(r, true, true, 1 ether);
        FoundationHookV2 host = FoundationHookV2(r.hook);
        address first = host.moduleAt(0).instance;
        address second = host.moduleAt(1).instance;
        assertEq(FoundationStatefulFixture(first).beforeCount(), 1);
        assertEq(FoundationStatefulFixture(second).afterCount(), 1);
        FoundationLedgerV1 ledger = FoundationLedgerV1(r.ledger);
        uint256 platform = ledger.platformReceived();
        uint256 budget = ledger.moduleCredited(first);
        assertGt(budget, 0);
        vm.prank(BOB);
        vm.expectRevert();
        host.executeModuleAction(0, abi.encode(budget));
        vm.prank(ALICE);
        host.executeModuleAction(0, abi.encode(budget));
        assertEq(quote.balanceOf(first), budget);
        assertEq(quote.balanceOf(second), 0);
        assertEq(ledger.platformReceived(), platform);
        vm.prank(ALICE);
        vm.expectRevert();
        host.executeModuleAction(0, abi.encode(1));
        p = _params(false, 700, 0, 0, 0);
        p.modules = _selections(false, 0, 0);
        _mine(p);
        L.LaunchResultV2 memory other = _launch(p);
        address otherFirst = FoundationHookV2(other.hook).moduleAt(0).instance;
        assertTrue(first != otherFirst);
        assertEq(FoundationStatefulFixture(otherFirst).beforeCount(), 0);
        assertEq(FoundationLedgerV1(other.ledger).moduleCredited(otherFirst), 0);
        ledger.claimPlatform();
        assertEq(ledger.platformClaimed(), platform);
        _assertClean(r);
    }
}
