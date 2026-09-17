// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
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
import { FoundationFactoryV2, IFoundationUniversalRouterV2 } from "../../src/module-foundation/FoundationFactoryV2.sol";
import { FoundationHookDeployerV1 } from "../../src/module-foundation/FoundationHookDeployerV1.sol";
import { FoundationHookV1 } from "../../src/module-foundation/FoundationHookV1.sol";
import { FoundationLedgerV1 } from "../../src/module-foundation/FoundationLedgerV1.sol";
import { FoundationTokenV1 } from "../../src/module-foundation/FoundationTokenV1.sol";
import { FoundationLaunchTypesV2 as L } from "../../src/module-foundation/FoundationLaunchTypesV2.sol";
import { FoundationFactoryV1, IFoundationUniversalRouterV1 } from "../../src/module-foundation/FoundationFactoryV1.sol";
import { PoolDonateTest } from "@uniswap/v4-core/src/test/PoolDonateTest.sol";
import { Pool } from "@uniswap/v4-core/src/libraries/Pool.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { FoundationDonationFactoryFixtureV2 } from "./FoundationCustodyFixturesV2.sol";
import {
    FoundationQuoteFixture,
    FoundationStatefulFixture,
    FoundationFixtureFactory
} from "./FoundationFixturesV1.sol";

/// @notice Local fork execution against canonical Core/PM/UR bytecode. No mocked periphery or broadcast.
/// Set FOUNDATION_RPC_URL and FOUNDATION_FORK_BLOCK explicitly; recorded local genesis is sufficient.
abstract contract FoundationForkBaseV2 is Test {
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
    FoundationFactoryV2 internal factory;
    FoundationHookDeployerV1 internal deployer;
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
        deployer = FoundationHookDeployerV1(deployCode("FoundationHookDeployerV1.sol:FoundationHookDeployerV1"));
        bytes32[5] memory hashes =
            [MANAGER.codehash, POSM.codehash, ROUTER.codehash, PERMIT2.codehash, address(deployer).codehash];
        factory = FoundationFactoryV2(
            deployCode(
                "FoundationFactoryV2.sol:FoundationFactoryV2",
                abi.encode(manager, positions, IFoundationUniversalRouterV2(ROUTER), permits, deployer, hashes)
            )
        );
        quote = new FoundationQuoteFixture(18);
        quote.mint(ALICE, 1_000_000 ether);
        vm.prank(ALICE);
        quote.approve(address(factory), type(uint256).max);
    }

    function _params(bool quote0, uint16 creatorBps, uint128 extra, uint128 initial)
        internal
        returns (T.LaunchParams memory p)
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
        p.creatorFeeBps = creatorBps;
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

    function _mine(T.LaunchParams memory p) internal view {
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

    function _launch(T.LaunchParams memory p) internal returns (L.LaunchResultV2 memory r) {
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
        FoundationHookV1 hook = FoundationHookV1(r.hook);
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
        assertEq(creator, (gross * hook.creatorFeeBps() + carryC) / 10_000);
        assertEq(
            manager.balanceOf(r.ledger, uint256(uint160(address(quote)))),
            FoundationLedgerV1(r.ledger).outstandingBacking()
        );
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

contract FoundationCustodyV2Test is FoundationForkBaseV2 {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    function test_launchCustodyFundingAndInitialBuyMatrix() public {
        for (uint256 order; order < 2; ++order) {
            for (uint256 extra; extra < 2; ++extra) {
                for (uint256 initial; initial < 2; ++initial) {
                    this.checkLaunchExample(order == 0, extra == 0 ? 0 : 2 ether, initial == 0 ? 0 : 1 ether);
                }
            }
        }
    }

    function checkLaunchExample(bool quote0, uint128 extra, uint128 initial) external {
        T.LaunchParams memory p = _params(quote0, 100, extra, initial);
        address predicted = factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata);
        uint256 aliceBefore = quote.balanceOf(ALICE);
        uint256 managerQuoteBefore = quote.balanceOf(MANAGER);
        L.LaunchResultV2 memory r = _launch(p);
        assertEq(r.token, predicted);
        assertEq(r.hook, factory.predictHookAddress(ALICE, predicted, p));
        assertEq(FoundationTokenV1(r.token).totalSupply(), T.TOKEN_SUPPLY);
        assertEq(FoundationTokenV1(r.token).metadataHash(), keccak256(abi.encode(p.metadata)));
        assertEq(IERC20(r.token).balanceOf(ALICE), r.initialBuyTokenAmount);
        if (initial == 0) assertEq(r.initialBuyTokenAmount, 0);
        else assertGt(r.initialBuyTokenAmount, 0);
        assertEq(r.basePositionOwner, DEAD);
        assertEq(r.roundingInventoryRecipient, DEAD);
        assertEq(IERC721(POSM).ownerOf(r.basePositionId), DEAD);
        assertEq(IERC721(POSM).getApproved(r.basePositionId), address(0));
        assertGt(positions.getPositionLiquidity(r.basePositionId), 0);
        assertEq(uint256(r.baseTokenPrincipal) + r.baseTokenRounding, T.TOKEN_SUPPLY);
        assertEq(IERC20(r.token).balanceOf(DEAD), r.baseTokenRounding);
        assertEq(IERC20(r.token).balanceOf(MANAGER) + r.initialBuyTokenAmount, r.baseTokenPrincipal);
        assertEq(quote.balanceOf(MANAGER) - managerQuoteBefore, uint256(r.creatorQuotePrincipal) + initial);
        assertEq(aliceBefore - quote.balanceOf(ALICE), uint256(extra) + initial - r.actualQuoteRefund);
        assertEq(r.actualQuoteRefund, uint256(extra) - r.creatorQuotePrincipal);
        if (extra == 0) {
            assertEq(r.creatorPositionId, 0);
            assertEq(r.creatorPositionOwner, address(0));
            assertEq(r.creatorQuotePrincipal, 0);
        } else {
            assertEq(r.creatorPositionOwner, DEAD);
            assertEq(IERC721(POSM).ownerOf(r.creatorPositionId), DEAD);
            assertEq(IERC721(POSM).getApproved(r.creatorPositionId), address(0));
            assertGt(positions.getPositionLiquidity(r.creatorPositionId), 0);
            assertGt(r.creatorQuotePrincipal, 0);
        }
        FoundationHookV1 host = FoundationHookV1(r.hook);
        assertEq(host.poolKey().fee, 0);
        assertEq(host.moduleCount(), 0);
        assertEq(FoundationLedgerV1(r.ledger).platformReceived(), uint256(initial) * 30 / 10_000);
        assertEq(FoundationLedgerV1(r.ledger).creatorReceived(), uint256(initial) * 100 / 10_000);
        assertEq(keccak256(abi.encode(factory.launchOf(r.token))), keccak256(abi.encode(r)));
        _assertClean(r);
    }

    function test_realURFourExactnessDirectionsBothOrdersAndCreatorFeeExtremesWithPayout() public {
        for (uint256 order; order < 2; ++order) {
            for (uint256 fee; fee < 3; ++fee) {
                this.checkFourDirections(order == 0, fee == 0 ? 0 : fee == 1 ? 100 : 1000);
            }
        }
    }

    function checkFourDirections(bool quote0, uint16 fee) external {
        L.LaunchResultV2 memory r = _launch(_params(quote0, fee, 2 ether, 0));
        uint256 bought = _trade(r, true, true, 1 ether);
        uint256 exactTokens = bought / 4;
        assertGt(_trade(r, true, false, exactTokens), 0);
        uint256 soldQuote = _trade(r, false, true, bought / 3);
        assertGt(soldQuote, 0);
        assertGt(_trade(r, false, false, soldQuote / 3), 0);
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
        _assertClean(r);
    }

    function test_partialFillExactInputAndOutputRollbackIncludingCarries() public {
        L.LaunchResultV2 memory r = _launch(_params(true, 1000, 0, 0));
        FoundationHookV1 hook = FoundationHookV1(r.hook);
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

    function test_tokenBurnOwnershipAndMetadataNoMintAuthority() public {
        L.LaunchResultV2 memory r = _launch(_params(false, 0, 0, 1 ether));
        FoundationTokenV1 token = FoundationTokenV1(r.token);
        uint256 amount = token.balanceOf(ALICE) / 2;
        vm.prank(ALICE);
        token.burn(amount);
        assertEq(token.totalSupply(), T.TOKEN_SUPPLY - amount);
        vm.prank(BOB);
        vm.expectRevert();
        token.burn(1);
        (bool ok,) = r.token.call(abi.encodeWithSignature("mint(address,uint256)", BOB, 1));
        assertFalse(ok);
        (ok,) = r.token.call(abi.encodeWithSignature("burnFrom(address,uint256)", ALICE, 1));
        assertFalse(ok);
        (ok,) = r.token.call(abi.encodeWithSignature("setMetadata(string)", "changed"));
        assertFalse(ok);
    }

    function test_bothDeadNFTsRejectManagementFromEveryApplicationRole() public {
        T.LaunchParams memory p = _params(false, 1000, 2 ether, 1 ether);
        p.modules = _selections(false, 0, 0);
        _mine(p);
        L.LaunchResultV2 memory r = _launch(p);
        address[7] memory actors = [
            ALICE,
            BOB,
            address(factory),
            address(deployer),
            r.hook,
            r.ledger,
            FoundationHookV1(r.hook).moduleAt(0).instance
        ];
        uint256[2] memory ids = [r.basePositionId, r.creatorPositionId];
        for (uint256 i; i < ids.length; ++i) {
            uint128 liquidity = positions.getPositionLiquidity(ids[i]);
            for (uint256 j; j < actors.length; ++j) {
                _assertNoPositionRights(ids[i], actors[j]);
            }
            assertEq(positions.getPositionLiquidity(ids[i]), liquidity);
            assertEq(IERC721(POSM).ownerOf(ids[i]), DEAD);
        }
        _assertClean(r);
    }

    function _assertNoPositionRights(uint256 id, address actor) internal {
        assertFalse(IERC721(POSM).isApprovedForAll(DEAD, actor));
        vm.startPrank(actor);
        vm.expectRevert();
        IERC721(POSM).transferFrom(DEAD, actor, id);
        vm.expectRevert();
        IERC721(POSM).safeTransferFrom(DEAD, actor, id);
        vm.expectRevert();
        IERC721(POSM).approve(actor, id);
        vm.expectRevert();
        positions.permit(actor, id, block.timestamp, 0, hex"00");
        vm.expectRevert();
        positions.permitForAll(DEAD, actor, true, block.timestamp, 0, hex"00");
        bytes[] memory params = new bytes[](1);
        for (uint256 amount; amount < 2; ++amount) {
            params[0] = abi.encode(id, amount, uint128(0), uint128(0), bytes(""));
            vm.expectRevert();
            positions.modifyLiquidities(
                abi.encode(abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY)), params), block.timestamp
            );
            vm.expectRevert();
            positions.modifyLiquidities(
                abi.encode(abi.encodePacked(uint8(Actions.INCREASE_LIQUIDITY)), params), block.timestamp
            );
        }
        params[0] = abi.encode(id, uint128(0), uint128(0), bytes(""));
        vm.expectRevert();
        positions.modifyLiquidities(abi.encode(abi.encodePacked(uint8(Actions.BURN_POSITION)), params), block.timestamp);
        vm.stopPrank();
        assertEq(IERC721(POSM).getApproved(id), address(0));
    }

    function test_taxedFundingAndSlippageDeadlineRollbackBeforeAnyLaunch() public {
        T.LaunchParams memory p = _params(true, 1000, 2 ether, 1 ether);
        address token = factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata);
        address hook = factory.predictHookAddress(ALICE, token, p);
        uint256 next = positions.nextTokenId();
        uint256 beforeCreator = quote.balanceOf(ALICE);
        quote.setTax(true);
        vm.prank(ALICE);
        vm.expectRevert(FoundationFactoryV2.InvalidSettlement.selector);
        factory.launch(p);
        quote.setTax(false);
        p.initialBuyMinimumTokenAmount = uint128(T.TOKEN_SUPPLY);
        vm.prank(ALICE);
        vm.expectRevert();
        factory.launch(p);
        p.deadline = uint64(block.timestamp - 1);
        vm.prank(ALICE);
        vm.expectRevert(FoundationFactoryV2.DeadlineExpired.selector);
        factory.launch(p);
        assertEq(token.code.length, 0);
        assertEq(hook.code.length, 0);
        assertEq(positions.nextTokenId(), next);
        assertEq(quote.balanceOf(address(factory)), 0);
        assertEq(quote.balanceOf(ALICE), beforeCreator);
        assertEq(factory.launchOf(token).token, address(0));
    }

    function test_statefulCompatibleCompositionBudgetsAndLaunchIsolation() public {
        T.LaunchParams memory p = _params(true, 1000, 0, 0);
        p.modules = _selections(false, 0, 0);
        _mine(p);
        L.LaunchResultV2 memory r = _launch(p);
        _trade(r, true, true, 1 ether);
        FoundationHookV1 host = FoundationHookV1(r.hook);
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
        p = _params(false, 1000, 0, 0);
        p.modules = _selections(false, 0, 0);
        _mine(p);
        L.LaunchResultV2 memory other = _launch(p);
        address otherFirst = FoundationHookV1(other.hook).moduleAt(0).instance;
        assertTrue(first != otherFirst);
        assertEq(FoundationStatefulFixture(otherFirst).beforeCount(), 0);
        assertEq(FoundationLedgerV1(other.ledger).moduleCredited(otherFirst), 0);
        ledger.claimPlatform();
        assertEq(ledger.platformClaimed(), platform);
        _assertClean(r);
    }

    function test_conflictNestedSwapAndFailurePolicies() public {
        T.LaunchParams memory p = _params(true, 100, 0, 0);
        p.modules = _selections(true, 0, 0);
        _mine(p);
        vm.prank(ALICE);
        vm.expectRevert();
        factory.launch(p);
        p = _params(true, 100, 0, 0);
        p.modules = _selections(false, 3, 0);
        _mine(p);
        L.LaunchResultV2 memory nested = _launch(p);
        vm.expectRevert();
        this.tradeExternal(nested, true, true, 1 ether);
        assertEq(FoundationLedgerV1(nested.ledger).platformReceived(), 0);
        p = _params(true, 100, 0, 0);
        p.modules = _selections(false, 0, 2);
        _mine(p);
        L.LaunchResultV2 memory openAfter = _launch(p);
        _trade(openAfter, true, true, 1 ether);
        address failed = FoundationHookV1(openAfter.hook).moduleAt(1).instance;
        assertEq(FoundationStatefulFixture(failed).afterCount(), 0, "failed CALL state reverted");
        FoundationLedgerV1(openAfter.ledger).claimPlatform();
        FoundationLedgerV1(openAfter.ledger).claimCreator();
    }

    function test_actionOwnBudgetURCyclePaysFeesAndFailedTradeRollsBackClaim() public {
        T.LaunchParams memory p = _params(true, 1000, 0, 0);
        p.modules = _selections(false, 0, 0);
        _mine(p);
        L.LaunchResultV2 memory r = _launch(p);
        _trade(r, true, true, 1 ether);
        FoundationHookV1 host = FoundationHookV1(r.hook);
        FoundationLedgerV1 ledger = FoundationLedgerV1(r.ledger);
        address module = host.moduleAt(0).instance;
        address other = host.moduleAt(1).instance;
        uint256 budget = ledger.moduleCredited(module);
        uint256 beforeOther = ledger.moduleCredited(other);
        uint256 beforePlatform = ledger.platformReceived();
        bytes memory bad = abi.encode(budget, ROUTER, PERMIT2, uint128(T.TOKEN_SUPPLY));
        vm.prank(ALICE);
        vm.expectRevert();
        host.executeModuleAction(0, bad);
        assertEq(ledger.moduleClaimed(module), 0);
        assertEq(ledger.platformReceived(), beforePlatform);
        assertEq(ledger.moduleCredited(other), beforeOther);
        assertEq(FoundationStatefulFixture(module).actionCount(), 0);
        bytes memory good = abi.encode(budget, ROUTER, PERMIT2, uint128(1));
        vm.prank(ALICE);
        host.executeModuleAction(0, good);
        assertGt(IERC20(r.token).balanceOf(module), 0);
        assertEq(quote.balanceOf(module), 0);
        assertEq(ledger.moduleClaimed(module), budget);
        assertGt(ledger.platformReceived(), beforePlatform);
        assertGe(ledger.moduleCredited(other), beforeOther);
        assertEq(FoundationStatefulFixture(module).beforeCount(), 2);
        assertEq(FoundationStatefulFixture(module).afterCount(), 2);
        assertEq(FoundationStatefulFixture(module).actionCount(), 1);
        assertFalse(host.isModuleAction(module));
        _trade(r, true, true, 1 ether); // Action phase returned to idle.
        ledger.claimPlatform();
        _assertClean(r);
    }

    function test_sixDecimalQuoteBothSortOrdersWithGrossFeeAccounting() public {
        quote = new FoundationQuoteFixture(6);
        quote.mint(ALICE, 1_000_000_000);
        vm.prank(ALICE);
        quote.approve(address(factory), type(uint256).max);
        for (uint256 order; order < 2; ++order) {
            L.LaunchResultV2 memory r = _launch(_params(order == 0, 100, 0, 0));
            uint256 bought = _trade(r, true, true, 1_000_000);
            _trade(r, false, true, bought / 2);
            FoundationLedgerV1(r.ledger).claimPlatform();
            FoundationLedgerV1(r.ledger).claimCreator();
        }
    }

    function test_malformedOrBombReturnIsFatalAndCannotPersistFailOpenEffects() public {
        for (uint8 fault = 5; fault <= 6; ++fault) {
            T.LaunchParams memory p = _params(true, 100, 0, 0);
            p.modules = _selections(false, 0, fault);
            _mine(p);
            L.LaunchResultV2 memory r = _launch(p);
            vm.expectRevert();
            this.tradeExternal(r, true, true, 1 ether);
            address failed = FoundationHookV1(r.hook).moduleAt(1).instance;
            assertEq(FoundationStatefulFixture(failed).afterCount(), 0);
            assertEq(FoundationLedgerV1(r.ledger).platformReceived(), 0);
            _assertClean(r);
        }
    }

    function test_externalPositionManagerLPRetainsOwnNFTOwnershipAndPlatformFee() public {
        L.LaunchResultV2 memory r = _launch(_params(false, 0, 2 ether, 1 ether));
        uint256 id = _mintExternal(r, BOB);
        assertEq(IERC721(POSM).ownerOf(id), BOB);
        assertEq(IERC721(POSM).ownerOf(r.basePositionId), DEAD);
        assertEq(IERC721(POSM).ownerOf(r.creatorPositionId), DEAD);
        (PoolKey memory observed,) = positions.getPoolAndPositionInfo(id);
        assertEq(PoolId.unwrap(observed.toId()), r.poolId);
        vm.prank(BOB);
        IERC721(POSM).transferFrom(BOB, ALICE, id);
        assertEq(IERC721(POSM).ownerOf(id), ALICE);
        _trade(r, true, true, 1 ether);
    }

    function _mintExternal(L.LaunchResultV2 memory r, address recipient) internal returns (uint256 id) {
        (PoolKey memory key, PositionInfo base) = positions.getPoolAndPositionInfo(r.basePositionId);
        id = positions.nextTokenId();
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key,
            base.tickLower(),
            base.tickUpper(),
            uint256(1e15),
            uint128(r.token < address(quote) ? T.TOKEN_SUPPLY : 10 ether),
            uint128(r.token < address(quote) ? 10 ether : T.TOKEN_SUPPLY),
            recipient,
            bytes("")
        );
        params[1] = abi.encode(key.currency0, key.currency1);
        vm.startPrank(ALICE);
        IERC20(r.token).approve(PERMIT2, type(uint256).max);
        quote.approve(PERMIT2, type(uint256).max);
        permits.approve(r.token, POSM, type(uint160).max, uint48(block.timestamp + 60));
        permits.approve(address(quote), POSM, type(uint160).max, uint48(block.timestamp + 60));
        positions.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR)), params),
            block.timestamp
        );
        vm.stopPrank();
    }

    function test_transferToDeadRetainsCoreLiquidityButBurnPositionRemovesIt() public {
        L.LaunchResultV2 memory r = _launch(_params(false, 0, 2 ether, 1 ether));
        uint256 transferred = _mintExternal(r, BOB);
        (PoolKey memory key, PositionInfo info) = positions.getPoolAndPositionInfo(transferred);
        uint128 beforeLiquidity = positions.getPositionLiquidity(transferred);
        uint256 managerTokenBefore = IERC20(r.token).balanceOf(MANAGER);
        uint256 managerQuoteBefore = quote.balanceOf(MANAGER);
        vm.prank(BOB);
        IERC721(POSM).transferFrom(BOB, DEAD, transferred);
        assertEq(IERC721(POSM).ownerOf(transferred), DEAD);
        assertEq(positions.getPositionLiquidity(transferred), beforeLiquidity);
        (uint128 coreLiquidity,,) =
            manager.getPositionInfo(key.toId(), POSM, info.tickLower(), info.tickUpper(), bytes32(transferred));
        assertEq(coreLiquidity, beforeLiquidity);
        assertEq(IERC20(r.token).balanceOf(MANAGER), managerTokenBefore);
        assertEq(quote.balanceOf(MANAGER), managerQuoteBefore);

        uint256 burned = _mintExternal(r, BOB);
        uint256 bobTokenBefore = IERC20(r.token).balanceOf(BOB);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(burned, uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, BOB);
        vm.prank(BOB);
        positions.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(Actions.BURN_POSITION), uint8(Actions.TAKE_PAIR)), params),
            block.timestamp
        );
        vm.expectRevert();
        IERC721(POSM).ownerOf(burned);
        (coreLiquidity,,) =
            manager.getPositionInfo(key.toId(), POSM, info.tickLower(), info.tickUpper(), bytes32(burned));
        assertEq(coreLiquidity, 0);
        assertGt(IERC20(r.token).balanceOf(BOB), bobTokenBefore);
        assertEq(IERC721(POSM).ownerOf(transferred), DEAD);
        assertEq(positions.getPositionLiquidity(transferred), beforeLiquidity);
        assertEq(IERC721(POSM).ownerOf(r.basePositionId), DEAD);
        assertEq(IERC721(POSM).ownerOf(r.creatorPositionId), DEAD);
        _assertClean(r);
    }

    function test_zeroLPFeeStillForfeitsDonationFeesWhileHookClaimsRemainPayable() public {
        L.LaunchResultV2 memory r = _launch(_params(false, 1000, 2 ether, 1 ether));
        assertEq(factory.LP_FEE(), 0);
        (PoolKey memory key, PositionInfo info) = positions.getPoolAndPositionInfo(r.basePositionId);
        assertEq(key.fee, 0);
        FoundationLedgerV1 ledger = FoundationLedgerV1(r.ledger);
        uint256 beforePlatform = ledger.platformReceived();
        uint256 beforeCreator = ledger.creatorReceived();
        uint128 beforeLiquidity = positions.getPositionLiquidity(r.basePositionId);
        (uint256 before0, uint256 before1) = manager.getFeeGrowthInside(key.toId(), info.tickLower(), info.tickUpper());
        PoolDonateTest donor = new PoolDonateTest(manager);
        uint256 managerQuoteBefore = quote.balanceOf(MANAGER);
        vm.startPrank(ALICE);
        quote.approve(address(donor), 1 ether);
        donor.donate(key, address(quote) < r.token ? 1 ether : 0, address(quote) < r.token ? 0 : 1 ether, "");
        vm.stopPrank();
        (uint256 after0, uint256 after1) = manager.getFeeGrowthInside(key.toId(), info.tickLower(), info.tickUpper());
        if (address(quote) < r.token) assertGt(after0, before0);
        else assertGt(after1, before1);
        assertEq(quote.balanceOf(MANAGER) - managerQuoteBefore, 1 ether);
        assertEq(ledger.platformReceived(), beforePlatform);
        assertEq(ledger.creatorReceived(), beforeCreator);
        _assertNoPositionRights(r.basePositionId, ALICE);
        ledger.claimPlatform();
        ledger.claimCreator();
        assertEq(ledger.platformClaimed(), beforePlatform);
        assertEq(ledger.creatorClaimed(), beforeCreator);
        assertEq(positions.getPositionLiquidity(r.basePositionId), beforeLiquidity);
        _assertClean(r);
    }

    function test_actualRefundIncludesConstructionDonationAndPreservesPreexistingFactoryQuote() public {
        quote.mint(address(factory), 7 ether);
        uint256 beforeCreator = quote.balanceOf(ALICE);
        FoundationDonationFactoryFixtureV2 donating = new FoundationDonationFactoryFixtureV2(address(factory), 3 ether);
        quote.mint(address(donating), 3 ether);
        T.LaunchParams memory p = _params(true, 1000, 2 ether, 1 ether);
        p.modules = _selections(false, 0, 0);
        p.modules[0].factory = address(donating);
        p.modules[0].factoryCodeHash = address(donating).codehash;
        _mine(p);
        L.LaunchResultV2 memory r = _launch(p);
        assertEq(r.actualQuoteRefund, 3 ether + uint256(p.additionalQuoteAmount) - r.creatorQuotePrincipal);
        assertEq(quote.balanceOf(ALICE), beforeCreator - p.initialBuyQuoteAmount - r.creatorQuotePrincipal + 3 ether);
        assertEq(quote.balanceOf(address(factory)), 7 ether);
        assertEq(quote.balanceOf(address(donating)), 0);
        assertEq(IERC721(POSM).ownerOf(r.basePositionId), DEAD);
        assertEq(IERC721(POSM).ownerOf(r.creatorPositionId), DEAD);
        _assertClean(r);
    }

    function test_sharedTickLimitRejectsIndividuallyValidLiquidityBeforeAnyPersistentLaunch() public {
        T.LaunchParams memory p = _params(true, 0, 0, 0);
        uint160 start = TickMath.getSqrtPriceAtTick(p.initialTick);
        uint160 lower = TickMath.getSqrtPriceAtTick(TickMath.minUsableTick(T.TICK_SPACING));
        uint160 upper = TickMath.getSqrtPriceAtTick(TickMath.maxUsableTick(T.TICK_SPACING));
        uint128 baseLiquidity = LiquidityAmounts.getLiquidityForAmount1(lower, start, T.TOKEN_SUPPLY);
        uint128 maximum = Pool.tickSpacingToMaxLiquidityPerTick(T.TICK_SPACING);
        uint128 desiredAdditional = maximum - baseLiquidity + 1;
        uint256 funding = SqrtPriceMath.getAmount0Delta(start, upper, desiredAdditional, true);
        assertLe(funding, uint256(uint128(type(int128).max)));
        p.additionalQuoteAmount = uint128(funding);
        uint128 extraLiquidity = LiquidityAmounts.getLiquidityForAmount0(start, upper, funding);
        assertLt(baseLiquidity, maximum);
        assertLt(extraLiquidity, maximum);
        assertGt(uint256(baseLiquidity) + extraLiquidity, maximum);
        quote.mint(ALICE, funding);
        uint256 aliceBefore = quote.balanceOf(ALICE);
        address token = factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata);
        address hook = factory.predictHookAddress(ALICE, token, p);
        uint256 next = positions.nextTokenId();
        vm.prank(ALICE);
        vm.expectRevert(FoundationFactoryV2.InvalidConfiguration.selector);
        factory.launch(p);
        assertEq(quote.balanceOf(ALICE), aliceBefore);
        assertEq(quote.balanceOf(address(factory)), 0);
        assertEq(token.code.length, 0);
        assertEq(hook.code.length, 0);
        assertEq(positions.nextTokenId(), next);
        assertEq(factory.launchOf(token).token, address(0));
    }

    function test_registryEventAndDirectMintIdentity() public {
        T.LaunchParams memory p = _params(true, 100, 2 ether, 1 ether);
        vm.recordLogs();
        L.LaunchResultV2 memory r = _launch(p);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 launched = keccak256(
            "FoundationLaunchedV2(address,address,bytes32,address,address,address,bytes32,bytes32,bytes32,uint256,(address,address,address,bytes32,address,address,address,uint256,uint256,uint256,uint128,uint128,uint128,uint256))"
        );
        uint256 events;
        uint256 directMints;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == POSM && logs[i].topics[0] == keccak256("Transfer(address,address,uint256)")) {
                ++directMints;
                assertEq(logs[i].topics.length, 4);
                assertEq(logs[i].topics[1], bytes32(0));
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(DEAD))));
                assertTrue(
                    uint256(logs[i].topics[3]) == r.basePositionId || uint256(logs[i].topics[3]) == r.creatorPositionId
                );
            }
            if (logs[i].emitter != address(factory) || logs[i].topics[0] != launched) continue;
            ++events;
            assertEq(logs[i].topics.length, 4);
            assertEq(logs[i].topics[1], bytes32(uint256(uint160(r.token))));
            assertEq(logs[i].topics[2], bytes32(uint256(uint160(ALICE))));
            assertEq(logs[i].topics[3], r.poolId);
            assertEq(
                logs[i].data,
                abi.encode(
                    r.hook,
                    r.ledger,
                    p.quote,
                    keccak256(abi.encode(p.metadata)),
                    keccak256(abi.encode(T.ABI_ID, p.modules)),
                    factory.LP_CUSTODY_ID(),
                    uint256(p.initialBuyQuoteAmount),
                    r
                )
            );
        }
        assertEq(events, 1);
        assertEq(directMints, 2);
        assertEq(keccak256(abi.encode(factory.launchOf(r.token))), keccak256(abi.encode(r)));
        L.LaunchResultV2 memory empty;
        assertEq(keccak256(abi.encode(factory.launchOf(address(0x1234)))), keccak256(abi.encode(empty)));
    }

    function test_versionsAndSharedHookDeployerBindEachFactorySeparately() public {
        assertEq(factory.VERSION_ID(), keccak256("programmable.module-foundation.factory.v2"));
        assertEq(factory.MODULE_ABI_ID(), T.ABI_ID);
        assertEq(factory.LP_CUSTODY_ID(), keccak256("programmable.module-foundation.launch-nfts.dead.v1"));
        assertEq(factory.LP_RECIPIENT(), DEAD);
        assertEq(factory.ROUNDING_INVENTORY_RECIPIENT(), DEAD);
        bytes32[5] memory hashes =
            [MANAGER.codehash, POSM.codehash, ROUTER.codehash, PERMIT2.codehash, address(deployer).codehash];
        FoundationFactoryV1 v1 = FoundationFactoryV1(
            deployCode(
                "FoundationFactoryV1.sol:FoundationFactoryV1",
                abi.encode(manager, positions, IFoundationUniversalRouterV1(ROUTER), permits, deployer, hashes)
            )
        );
        T.LaunchParams memory p = _params(true, 100, 0, 0);
        address token = factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata);
        bytes32 v2Hash = keccak256(
            abi.encodePacked(
                type(FoundationHookV1).creationCode,
                abi.encode(manager, address(factory), token, p.quote, ALICE, p.initialTick, p.creatorFeeBps, p.modules)
            )
        );
        assertEq(factory.hookInitCodeHash(ALICE, token, p), v2Hash);
        L.LaunchResultV2 memory r = _launch(p);
        assertEq(FoundationHookV1(r.hook).initializer(), address(factory));
        address oldToken = v1.predictTokenAddress(ALICE, p.tokenSalt, p.metadata);
        assertTrue(oldToken != token);
        bytes32 v1Hash = v1.hookInitCodeHash(ALICE, oldToken, p);
        assertTrue(v1Hash != v2Hash);
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        for (uint256 i;; ++i) {
            p.hookSalt = bytes32(i);
            address predicted = vm.computeCreate2Address(p.hookSalt, v1Hash, address(deployer));
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == flags) break;
        }
        vm.prank(ALICE);
        T.LaunchResult memory old = v1.launch(p);
        assertEq(FoundationHookV1(old.hook).initializer(), address(v1));
        assertEq(address(v1.hookDeployer()), address(factory.hookDeployer()));
        assertEq(IERC721(POSM).ownerOf(old.basePositionId), old.baseVault);
        assertEq(IERC721(POSM).ownerOf(r.basePositionId), DEAD);
    }
}
