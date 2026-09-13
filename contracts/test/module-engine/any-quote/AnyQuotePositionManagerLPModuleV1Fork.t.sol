// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Position } from "@uniswap/v4-core/src/libraries/Position.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { ModuleEngineBaseV1 } from "../../../src/module-engine/ModuleEngineBaseV1.sol";
import { ModuleEngineTypesV1 as T } from "../../../src/module-engine/ModuleEngineTypesV1.sol";
import { AnyQuoteTypesV1 as A } from "../../../src/module-engine/any-quote/AnyQuoteTypesV1.sol";
import { AnyQuoteSharedHookV1 } from "../../../src/module-engine/any-quote/AnyQuoteSharedHookV1.sol";
import { AnyQuoteLedgerV1 } from "../../../src/module-engine/any-quote/AnyQuoteLedgerV1.sol";
import {
    AnyQuotePositionManagerLPModuleV1 as Engine
} from "../../../src/module-engine/any-quote/AnyQuotePositionManagerLPModuleV1.sol";

/// @dev Adversarial ERC20 fixture only. Successful paths reuse unchanged canonical periphery;
/// the separately labelled dependency-failure test injects and restores invalid code only to assert rejection.
contract AnyQuotePositionManagerLPModuleV1TestToken is ERC20 {
    uint8 private _decimals;
    bool public taxed;
    address public taxedSender;

    constructor(uint8 decimals_) ERC20("Fork quote fixture", "QFIX") {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function setDecimals(uint8 value) external {
        _decimals = value;
    }

    function setTax(bool value) external {
        taxed = value;
    }

    function setTaxOnlyFrom(address sender) external {
        taxed = true;
        taxedSender = sender;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        uint256 tax = taxed && from != address(0) && to != address(0)
            && (taxedSender == address(0) || from == taxedSender)
            ? amount / 100
            : 0;
        super._update(from, to, amount - tax);
        if (tax != 0) super._update(from, address(0), tax);
    }
}

/// @dev Lifecycle/funding harness only. Production host admission is covered by a separate host test.
contract AnyQuotePositionManagerLPModuleV1TestHost {
    using SafeERC20 for IERC20;
    AnyQuoteSharedHookV1 public hook;

    function deployHook(bytes memory creation, bytes32 salt) external returns (AnyQuoteSharedHookV1) {
        require(address(hook) == address(0));
        address deployed;
        assembly ("memory-safe") { deployed := create2(0, add(creation, 32), mload(creation), salt) }
        require(deployed != address(0));
        hook = AnyQuoteSharedHookV1(deployed);
        return hook;
    }

    function createPrimary(bytes32 salt) external returns (IERC20) {
        return IERC20(
            UERC20Factory(0x754e8c1ADe3C6C4c863590a91F2ED020baF8E779)
                .createToken(
                    "Position custody fork fixture",
                    "PCFIX",
                    18,
                    A.TOKEN_SUPPLY,
                    address(this),
                    abi.encode(UERC20Metadata("", "", "", "")),
                    salt
                )
        );
    }

    function deploy(T.Context memory context_, bytes memory configuration) external returns (Engine) {
        return new Engine(context_, configuration);
    }

    function register(A.PoolRegistration memory registration, address creator) external {
        address[] memory wallets = new address[](1);
        uint16[] memory shares = new uint16[](1);
        wallets[0] = creator;
        shares[0] = 10_000;
        hook.registerPool(registration, wallets, shares);
    }

    function initialize(Engine engine) external returns (bytes32) {
        IERC20(engine.context().token).safeTransfer(address(engine), A.TOKEN_SUPPLY);
        return engine.initialize("");
    }

    function execute(Engine engine, T.Operation calldata op) external returns (bytes memory) {
        IERC20 input = IERC20(op.inputAsset);
        uint256 beforeBalance = input.balanceOf(address(engine));
        input.safeTransferFrom(msg.sender, address(engine), op.inputAmount);
        require(input.balanceOf(address(engine)) == beforeBalance + op.inputAmount, "exact host funding");
        return engine.execute(op);
    }

    function executePrefunded(Engine engine, T.Operation calldata op) external returns (bytes memory) {
        return engine.execute(op);
    }
}

/// @dev Fixed-block fork simulation with real, runtime-pinned canonical periphery and factory UERC20.
/// Quote fixtures and test funding are local to the fork; this suite sends no transactions to the chain.
contract AnyQuotePositionManagerLPModuleV1ForkTest is Test {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    uint256 private constant SNAPSHOT_BLOCK = 61_917_458;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant CREATOR = address(0xC4EA704);
    address private constant MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address private constant POSM = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address private constant ROUTER = 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    IPoolManager private manager;
    IPositionManager private positions;
    IAllowanceTransfer private permits;
    AnyQuotePositionManagerLPModuleV1TestHost private host;
    AnyQuoteSharedHookV1 private hook;
    AnyQuoteLedgerV1 private ledger;
    uint256 private serial;

    struct Fixture {
        Engine engine;
        IERC20 token;
        AnyQuotePositionManagerLPModuleV1TestToken quote;
        T.Context context;
        bytes configuration;
        bool quote0;
    }

    struct QuoteSwap {
        bool buy;
        bool exactInput;
        uint256 gross;
        uint256 platform;
        uint256 creator;
        int128 amount0;
        int128 amount1;
    }

    function setUp() public {
        string memory rpc = vm.envOr("POSITION_MANAGER_ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        assertEq(block.chainid, 4663);
        assertEq(block.timestamp, 1_789_298_494);
        assertEq(MANAGER.codehash, bytes32(0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626));
        assertEq(POSM.codehash, bytes32(0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2));
        assertEq(ROUTER.codehash, bytes32(0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5));
        assertEq(PERMIT2.codehash, bytes32(0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca));
        manager = IPoolManager(MANAGER);
        positions = IPositionManager(POSM);
        permits = IAllowanceTransfer(PERMIT2);
        host = new AnyQuotePositionManagerLPModuleV1TestHost();
        bytes memory creation = bytes.concat(
            vm.getCode("AnyQuoteSharedHookV1.sol:AnyQuoteSharedHookV1"),
            abi.encode(manager, address(host), address(this))
        );
        bytes32 initHash = keccak256(creation);
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        bytes32 salt;
        for (uint256 i;; ++i) {
            salt = bytes32(i);
            if (uint160(vm.computeCreate2Address(salt, initHash, address(host))) & Hooks.ALL_HOOK_MASK == flags) break;
        }
        hook = host.deployHook(creation, salt);
        ledger = AnyQuoteLedgerV1(hook.ledger());
    }

    function test_factoryUERC20PositionBothSortDirectionsAndQuoteDecimals() public {
        uint8[3] memory decimals_ = [uint8(6), uint8(18), uint8(36)];
        for (uint256 order; order < 2; ++order) {
            for (uint256 i; i < decimals_.length; ++i) {
                Fixture memory f = _fixture(order == 0, decimals_[i]);
                assertEq(f.token.allowance(address(f.engine), PERMIT2), type(uint256).max);
                vm.recordLogs();
                bytes32 resource = host.initialize(f.engine);
                _assertPosition(f, resource);
                _assertMintLogs(f, vm.getRecordedLogs());
                _assertAllowances(f);
                assertEq(f.quote.balanceOf(MANAGER), 0, "exactly zero quote supplied to initial LP");
                assertEq(f.quote.allowance(address(f.engine), PERMIT2), 0);
                assertEq(f.token.balanceOf(address(host)), 0);
            }
        }
    }

    function test_firstBuyAndAcquiredInventoryMaxSellFeesAndDirectClaimsBothSortDirections() public {
        for (uint256 order; order < 2; ++order) {
            Fixture memory f = _fixture(order == 0, 18);
            host.initialize(f.engine);
            uint256 lpBefore = positions.getPositionLiquidity(f.engine.positionTokenId());
            uint256 acquired = _trade(f, true, 1 ether, ALICE);
            assertEq(f.token.balanceOf(ALICE), acquired);
            uint256 received = _trade(f, false, acquired, ALICE);
            assertGt(received, 0);
            assertEq(f.token.balanceOf(ALICE), 0, "all and only acquired inventory sold");
            assertEq(positions.getPositionLiquidity(f.engine.positionTokenId()), lpBefore);
            _assertAllowances(f);
            uint256 platform = ledger.claimableQuote(address(f.quote), A.PLATFORM_RECIPIENT);
            uint256 creator = ledger.claimableQuote(address(f.quote), CREATOR);
            assertGt(platform, 0);
            assertGt(creator, platform);
            uint256 creatorBefore = f.quote.balanceOf(CREATOR);
            uint256 platformBefore = f.quote.balanceOf(A.PLATFORM_RECIPIENT);
            vm.prank(CREATOR);
            assertEq(ledger.claimQuoteTo(address(f.quote), CREATOR), creator);
            assertEq(ledger.claimQuoteFor(address(f.quote), A.PLATFORM_RECIPIENT), platform);
            assertEq(f.quote.balanceOf(CREATOR) - creatorBefore, creator);
            assertEq(f.quote.balanceOf(A.PLATFORM_RECIPIENT) - platformBefore, platform);
            assertEq(ledger.totalReceived(address(f.quote)), ledger.totalClaimed(address(f.quote)));
            assertEq(manager.balanceOf(address(ledger), uint256(uint160(address(f.quote)))), 0);
        }
    }

    function test_nftCustodyRejectsTransferApprovalLiquidityWithdrawalAndSignedTheft() public {
        Fixture memory f = _fixture(true, 18);
        host.initialize(f.engine);
        uint256 id = f.engine.positionTokenId();
        vm.startPrank(BOB);
        vm.expectRevert();
        IERC721(POSM).transferFrom(address(f.engine), BOB, id);
        vm.expectRevert();
        IERC721(POSM).approve(BOB, id);
        vm.expectRevert();
        positions.permit(BOB, id, block.timestamp + 60, 0, new bytes(65));
        vm.expectRevert();
        positions.permitForAll(address(f.engine), BOB, true, block.timestamp + 60, 0, new bytes(65));
        bytes[] memory params = new bytes[](1);
        params[0] = abi.encode(id, uint256(1), uint128(0), uint128(0), bytes(""));
        vm.expectRevert();
        positions.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY)), params), block.timestamp
        );
        params[0] = abi.encode(id, uint128(0), uint128(0), bytes(""));
        vm.expectRevert();
        positions.modifyLiquidities(abi.encode(abi.encodePacked(uint8(Actions.BURN_POSITION)), params), block.timestamp);
        vm.expectRevert();
        permits.transferFrom(address(f.engine), BOB, 1, address(f.token));
        IAllowanceTransfer.PermitSingle memory signed = IAllowanceTransfer.PermitSingle(
            IAllowanceTransfer.PermitDetails(address(f.token), 1, uint48(block.timestamp + 60), 0),
            BOB,
            block.timestamp + 60
        );
        vm.expectRevert();
        permits.permit(address(f.engine), signed, new bytes(65));
        vm.stopPrank();
        assertEq(IERC721(POSM).ownerOf(id), address(f.engine));
        assertEq(IERC721(POSM).getApproved(id), address(0));
        assertFalse(IERC721(POSM).isApprovedForAll(address(f.engine), BOB));
        assertEq(positions.getPositionLiquidity(id), f.engine.lockedLiquidity());
        _assertAllowances(f);
    }

    function test_engineHasNoAdminGenericCallERC1271OrUnlockCallbackSurface() public {
        Fixture memory f = _fixture(true, 18);
        host.initialize(f.engine);
        bytes[10] memory calls = [
            abi.encodeWithSignature("withdraw(address,uint256)", address(f.token), 1),
            abi.encodeWithSignature("rescue(address,address,uint256)", address(f.token), BOB, 1),
            abi.encodeWithSignature("approve(address,uint256)", BOB, f.engine.positionTokenId()),
            abi.encodeWithSignature("setApprovalForAll(address,bool)", BOB, true),
            abi.encodeWithSignature(
                "transferFrom(address,address,uint256)", address(f.engine), BOB, f.engine.positionTokenId()
            ),
            abi.encodeWithSignature("execute(address,bytes)", POSM, bytes("")),
            abi.encodeWithSignature("multicall(bytes[])", new bytes[](0)),
            abi.encodeWithSignature("upgradeTo(address)", BOB),
            abi.encodeWithSignature("isValidSignature(bytes32,bytes)", bytes32(0), new bytes(65)),
            abi.encodeWithSignature("unlockCallback(bytes)", bytes(""))
        ];
        for (uint256 i; i < calls.length; ++i) {
            vm.prank(address(host));
            (bool success,) = address(f.engine).call(calls[i]);
            assertFalse(success);
        }
        T.Operation memory unprivileged = _operation(f, true, 1 ether, ALICE);
        vm.prank(BOB);
        vm.expectRevert(ModuleEngineBaseV1.UnauthorizedHost.selector);
        f.engine.execute(unprivileged);
        vm.prank(address(host));
        vm.expectRevert(ModuleEngineBaseV1.AlreadyInitialized.selector);
        f.engine.initialize("");
    }

    function test_buySellPreserveForeignDonationsAndLockedRoundingDust() public {
        Fixture memory f = _fixture(false, 18);
        host.initialize(f.engine);
        uint256 acquired = _trade(f, true, 1 ether, ALICE);
        vm.prank(ALICE);
        f.token.transfer(address(f.engine), 11);
        f.quote.mint(address(f.engine), 17);
        f.quote.mint(POSM, 19);
        f.quote.mint(ROUTER, 23);
        uint256 beforePrimary = f.token.balanceOf(address(f.engine));
        uint256 bought = _trade(f, true, 2 ether, ALICE);
        _trade(f, false, bought + acquired - 11, ALICE);
        assertEq(f.token.balanceOf(address(f.engine)), beforePrimary);
        assertEq(f.quote.balanceOf(address(f.engine)), 17);
        assertEq(f.quote.balanceOf(POSM), 19);
        assertEq(f.quote.balanceOf(ROUTER), 23);
        T.Operation memory op = _operation(f, false, beforePrimary, ALICE);
        vm.expectRevert(Engine.InvalidSettlement.selector);
        host.executePrefunded(f.engine, op);
        assertEq(f.token.balanceOf(address(f.engine)), beforePrimary);
        _assertAllowances(f);
    }

    function test_expiryMinimumOutputAndUnsupportedPriceLimitRollback() public {
        Fixture memory f = _fixture(true, 18);
        host.initialize(f.engine);
        uint256 aliceBefore = f.quote.balanceOf(ALICE);
        T.Operation memory op = _operation(f, true, 1 ether, ALICE);
        op.deadline = block.timestamp - 1;
        vm.prank(ALICE);
        vm.expectRevert(Engine.DeadlineExpired.selector);
        host.execute(f.engine, op);
        op.deadline = block.timestamp + 60;
        op.data = abi.encode(uint160(TickMath.MIN_SQRT_PRICE + 1));
        vm.prank(ALICE);
        vm.expectRevert(Engine.UnsupportedPriceLimit.selector);
        host.execute(f.engine, op);
        op.data = abi.encode(uint160(0));
        op.minimumOutput = A.TOKEN_SUPPLY;
        vm.prank(ALICE);
        vm.expectRevert();
        host.execute(f.engine, op);
        assertEq(f.quote.balanceOf(ALICE), aliceBefore);
        assertEq(ledger.totalReceived(address(f.quote)), 0);
        assertEq(f.token.balanceOf(address(f.engine)), f.engine.lockedTokenDust());
        _assertAllowances(f);
        _assertNoTransientDebt(f);
    }

    function test_taxedQuoteFundingAndOutputRevertWithoutFeeOrAllowanceResidue() public {
        Fixture memory f = _fixture(true, 18);
        host.initialize(f.engine);
        uint256 acquired = _trade(f, true, 1 ether, ALICE);
        uint256 feesBefore = ledger.totalReceived(address(f.quote));
        uint256 aliceBefore = f.quote.balanceOf(ALICE);
        f.quote.setTax(true);
        T.Operation memory buy = _operation(f, true, 1 ether, ALICE);
        vm.prank(ALICE);
        vm.expectRevert();
        host.execute(f.engine, buy);
        T.Operation memory sell = _operation(f, false, acquired, ALICE);
        vm.prank(ALICE);
        vm.expectRevert(Engine.InvalidSettlement.selector);
        host.execute(f.engine, sell);
        assertEq(f.quote.balanceOf(ALICE), aliceBefore);
        assertEq(f.token.balanceOf(ALICE), acquired);
        assertEq(ledger.totalReceived(address(f.quote)), feesBefore);
        _assertAllowances(f);
        _assertNoTransientDebt(f);
    }

    function test_selectivePoolManagerOutputTaxRevertsWithUntaxedRecipientLeg() public {
        Fixture memory f = _fixture(true, 18);
        host.initialize(f.engine);
        uint256 acquired = _trade(f, true, 1 ether, ALICE);
        uint256 feesBefore = ledger.totalReceived(address(f.quote));
        uint256 aliceQuoteBefore = f.quote.balanceOf(ALICE);
        uint256 managerQuoteBefore = f.quote.balanceOf(MANAGER);
        (uint160 priceBefore,,,) = manager.getSlot0(PoolId.wrap(f.engine.poolId()));
        f.quote.setTaxOnlyFrom(MANAGER);
        // This fixture taxes only core -> engine. The engine -> recipient transfer would be exact.
        assertEq(f.quote.taxedSender(), MANAGER);
        T.Operation memory sell = _operation(f, false, acquired, ALICE);
        vm.prank(ALICE);
        vm.expectRevert(Engine.InvalidSettlement.selector);
        host.execute(f.engine, sell);
        assertEq(f.quote.balanceOf(ALICE), aliceQuoteBefore);
        assertEq(f.quote.balanceOf(MANAGER), managerQuoteBefore);
        assertEq(f.token.balanceOf(ALICE), acquired);
        assertEq(f.quote.balanceOf(address(f.engine)), 0);
        assertEq(ledger.totalReceived(address(f.quote)), feesBefore);
        (uint160 priceAfter,,,) = manager.getSlot0(PoolId.wrap(f.engine.poolId()));
        assertEq(priceAfter, priceBefore);
        _assertAllowances(f);
        _assertNoTransientDebt(f);
    }

    function test_taxedInitialPrimaryRevertsAtomicallyBeforeLPExists() public {
        Fixture memory f = _fixture(false, 18);
        AnyQuotePositionManagerLPModuleV1TestToken taxed = new AnyQuotePositionManagerLPModuleV1TestToken(18);
        taxed.mint(address(host), A.TOKEN_SUPPLY);
        f.context.token = address(taxed);
        f.context.launchId = keccak256("taxed primary");
        Engine bad = host.deploy(f.context, f.configuration);
        _register(bad, f.context);
        taxed.setTax(true);
        uint256 next = positions.nextTokenId();
        vm.expectRevert(Engine.InvalidConfiguration.selector);
        host.initialize(bad);
        assertEq(positions.nextTokenId(), next);
        assertEq(taxed.balanceOf(address(host)), A.TOKEN_SUPPLY);
        assertEq(taxed.balanceOf(address(bad)), 0);
        assertFalse(bad.initialized());
    }

    function test_wrongPeripheryCodeAndWiringRejectedAtConstructionAndExecution() public {
        Fixture memory f = _fixture(true, 18);
        host.initialize(f.engine);
        address[4] memory dependencies = [MANAGER, POSM, ROUTER, PERMIT2];
        T.Operation memory op = _operation(f, true, 1 ether, ALICE);
        for (uint256 i; i < dependencies.length; ++i) {
            bytes memory code = dependencies[i].code;
            // Negative fault injection only. No successful test path replaces canonical periphery bytecode.
            vm.etch(dependencies[i], hex"00");
            vm.expectRevert(Engine.InvalidConfiguration.selector);
            host.deploy(f.context, f.configuration);
            vm.expectRevert(Engine.InvalidConfiguration.selector);
            host.executePrefunded(f.engine, op);
            vm.etch(dependencies[i], code);
        }
        A.Configuration memory config = abi.decode(f.configuration, (A.Configuration));
        config.poolManager = POSM;
        vm.expectRevert(Engine.InvalidConfiguration.selector);
        host.deploy(f.context, abi.encode(config));
        config.poolManager = MANAGER;
        config.poolManagerCodeHash = bytes32(uint256(1));
        vm.expectRevert(Engine.InvalidConfiguration.selector);
        host.deploy(f.context, abi.encode(config));
        _assertAllowances(f);
    }

    function test_initializationGuardRequiresEngineAndDependencyMetadataCannotDrift() public {
        Fixture memory f = _fixture(true, 6);
        int24 tick = f.engine.initialTick();
        PoolKey memory key = f.engine.poolKey();
        assertEq(positions.initializePool(key, TickMath.getSqrtPriceAtTick(tick)), type(int24).max);
        vm.expectRevert();
        manager.initialize(key, TickMath.getSqrtPriceAtTick(tick));
        host.initialize(f.engine);
        f.quote.setDecimals(18);
        T.Operation memory op = _operation(f, true, 1 ether, ALICE);
        vm.expectRevert(Engine.InvalidConfiguration.selector);
        host.executePrefunded(f.engine, op);
        _assertAllowances(f);
    }

    function test_configurationDeadlineAndQuoteDecimalRangeRejected() public {
        Fixture memory f = _fixture(true, 18);
        A.Configuration memory config = abi.decode(f.configuration, (A.Configuration));
        config.validUntil = uint64(block.timestamp - 1);
        vm.expectRevert(Engine.DeadlineExpired.selector);
        host.deploy(f.context, abi.encode(config));
        f.quote.setDecimals(37);
        vm.expectRevert(Engine.InvalidConfiguration.selector);
        host.deploy(f.context, f.configuration);
        vm.chainId(1);
        vm.expectRevert(Engine.WrongChain.selector);
        host.deploy(f.context, f.configuration);
    }

    function _fixture(bool quote0, uint8 decimals_) private returns (Fixture memory f) {
        ++serial;
        f.token = host.createPrimary(bytes32(serial));
        do {
            f.quote = new AnyQuotePositionManagerLPModuleV1TestToken(decimals_);
        } while ((address(f.quote) < address(f.token)) != quote0);
        f.quote0 = quote0;
        f.quote.mint(ALICE, 1e30);
        f.context = T.Context(
            address(host),
            keccak256(abi.encode("position fork", serial)),
            address(f.token),
            CREATOR,
            address(f.quote),
            address(ledger)
        );
        f.configuration = abi.encode(
            A.Configuration(
                A.SCHEMA_ID,
                MANAGER,
                MANAGER.codehash,
                address(hook),
                address(f.quote),
                quote0 ? int24(120_000) : int24(-120_000),
                uint64(block.timestamp + 180),
                bytes32("fixture raw price")
            )
        );
        f.engine = host.deploy(f.context, f.configuration);
        _register(f.engine, f.context);
        vm.startPrank(ALICE);
        f.quote.approve(address(host), type(uint256).max);
        f.token.approve(address(host), type(uint256).max);
        vm.stopPrank();
    }

    function _register(Engine engine, T.Context memory context_) private {
        host.register(
            A.PoolRegistration(
                context_.launchId,
                bytes32("position revision"),
                bytes32("reviewed family"),
                engine.configurationHash(),
                context_.token,
                context_.quoteAsset,
                address(engine),
                engine.initialTick(),
                100,
                300
            ),
            CREATOR
        );
    }

    function _operation(Fixture memory f, bool buy, uint256 amount, address recipient)
        private
        view
        returns (T.Operation memory)
    {
        return T.Operation({
            operationId: buy ? f.engine.BUY() : f.engine.SELL(),
            actor: ALICE,
            recipient: recipient,
            inputAsset: buy ? address(f.quote) : address(f.token),
            inputAmount: amount,
            outputAsset: buy ? address(f.token) : address(f.quote),
            minimumOutput: 1,
            deadline: block.timestamp + 60,
            nonce: 0,
            data: abi.encode(uint160(0))
        });
    }

    function _trade(Fixture memory f, bool buy, uint256 amount, address recipient) private returns (uint256 output) {
        T.Operation memory op = _operation(f, buy, amount, recipient);
        uint256 inputBefore = IERC20(op.inputAsset).balanceOf(ALICE);
        uint256 outputBefore = IERC20(op.outputAsset).balanceOf(recipient);
        uint256 feesBefore = ledger.totalReceived(address(f.quote));
        (uint16 platformCarry, uint16 creatorCarry) = hook.feeCarry(f.engine.poolId(), buy);
        vm.recordLogs();
        vm.prank(ALICE);
        output = abi.decode(host.execute(f.engine, op), (uint256));
        assertGt(output, 0);
        assertEq(inputBefore - IERC20(op.inputAsset).balanceOf(ALICE), amount);
        assertEq(IERC20(op.outputAsset).balanceOf(recipient) - outputBefore, output);
        QuoteSwap memory observed = _assertSwapLogs(f, vm.getRecordedLogs(), buy);
        assertEq(observed.platform, (observed.gross * 30 + platformCarry) / 10_000);
        assertEq(observed.creator, (observed.gross * (buy ? 100 : 300) + creatorCarry) / 10_000);
        assertEq(ledger.totalReceived(address(f.quote)) - feesBefore, observed.platform + observed.creator);
        assertEq(
            manager.balanceOf(address(ledger), uint256(uint160(address(f.quote)))),
            ledger.totalReceived(address(f.quote))
        );
        assertEq(manager.balanceOf(address(ledger), 0), 0, "no native fee conversion");
        _assertAllowances(f);
        _assertNoTransientDebt(f);
    }

    function _assertPosition(Fixture memory f, bytes32 resource) private view {
        Engine engine = f.engine;
        uint256 id = engine.positionTokenId();
        assertGt(id, 0);
        assertEq(address(engine.positionManager()), POSM);
        assertEq(IERC721(POSM).ownerOf(id), address(engine));
        assertEq(IERC721(POSM).getApproved(id), address(0));
        assertEq(positions.getPositionLiquidity(id), engine.lockedLiquidity());
        (PoolKey memory key, PositionInfo info) = positions.getPoolAndPositionInfo(id);
        assertEq(PoolId.unwrap(key.toId()), engine.poolId());
        assertEq(info.tickLower(), engine.tickLower());
        assertEq(info.tickUpper(), engine.tickUpper());
        assertFalse(info.hasSubscriber());
        assertEq(
            manager.getPositionLiquidity(
                PoolId.wrap(engine.poolId()),
                Position.calculatePositionKey(POSM, engine.tickLower(), engine.tickUpper(), bytes32(id))
            ),
            engine.lockedLiquidity()
        );
        assertEq(
            manager.getPositionLiquidity(
                PoolId.wrap(engine.poolId()),
                Position.calculatePositionKey(address(engine), engine.tickLower(), engine.tickUpper(), bytes32(id))
            ),
            0
        );
        assertEq(f.token.balanceOf(MANAGER) + engine.lockedTokenDust(), A.TOKEN_SUPPLY);
        assertEq(f.token.balanceOf(address(engine)), engine.lockedTokenDust());
        assertEq(
            resource,
            keccak256(
                abi.encode(
                    engine.LP_CUSTODY_SCHEMA_ID(),
                    POSM,
                    id,
                    engine.poolId(),
                    engine.tickLower(),
                    engine.tickUpper(),
                    engine.lockedLiquidity(),
                    engine.lockedTokenDust(),
                    engine.quoteDecimals()
                )
            )
        );
        _assertNoTransientDebt(f);
    }

    function _assertMintLogs(Fixture memory f, Vm.Log[] memory logs) private view {
        uint256 minted;
        uint256 modified;
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory entry = logs[i];
            if (entry.emitter == POSM && entry.topics[0] == keccak256("Transfer(address,address,uint256)")) {
                assertEq(entry.topics[1], bytes32(0));
                assertEq(address(uint160(uint256(entry.topics[2]))), address(f.engine));
                assertEq(uint256(entry.topics[3]), f.engine.positionTokenId());
                ++minted;
            }
            if (
                entry.emitter == MANAGER
                    && entry.topics[0] == keccak256("ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)")
            ) {
                assertEq(entry.topics[1], f.engine.poolId());
                assertEq(address(uint160(uint256(entry.topics[2]))), POSM);
                (int24 lower, int24 upper, int256 liquidity, bytes32 salt) =
                    abi.decode(entry.data, (int24, int24, int256, bytes32));
                assertEq(lower, f.engine.tickLower());
                assertEq(upper, f.engine.tickUpper());
                assertEq(liquidity, int256(uint256(f.engine.lockedLiquidity())));
                assertEq(salt, bytes32(f.engine.positionTokenId()));
                ++modified;
            }
        }
        assertEq(minted, 1);
        assertEq(modified, 1);
    }

    function _assertSwapLogs(Fixture memory f, Vm.Log[] memory logs, bool buy)
        private
        view
        returns (QuoteSwap memory swap)
    {
        uint256 swaps;
        uint256 fees;
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory entry = logs[i];
            if (
                entry.emitter == MANAGER
                    && entry.topics[0] == keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
            ) {
                assertEq(entry.topics[1], f.engine.poolId());
                assertEq(address(uint160(uint256(entry.topics[2]))), ROUTER);
                ++swaps;
            }
            if (
                entry.emitter == address(hook)
                    && entry.topics[0]
                        == keccak256(
                            "QuotePoolSwap(bytes32,bytes32,address,bool,bool,uint256,uint256,uint256,int128,int128)"
                        )
            ) {
                assertEq(entry.topics[1], f.engine.poolId());
                assertEq(address(uint160(uint256(entry.topics[3]))), ROUTER);
                swap = abi.decode(entry.data, (QuoteSwap));
                assertEq(swap.buy, buy);
                assertTrue(swap.exactInput);
                ++fees;
            }
        }
        assertEq(swaps, 1);
        assertEq(fees, 1);
    }

    function _assertAllowances(Fixture memory f) private view {
        address[2] memory assets = [address(f.token), address(f.quote)];
        address[2] memory spenders = [POSM, ROUTER];
        for (uint256 a; a < assets.length; ++a) {
            for (uint256 s; s < spenders.length; ++s) {
                (uint160 amount,,) = permits.allowance(address(f.engine), assets[a], spenders[s]);
                assertEq(amount, 0, "no spendable scoped Permit2 allowance");
            }
        }
        assertEq(f.token.allowance(address(f.engine), PERMIT2), type(uint256).max, "canonical UERC20 default retained");
        assertEq(f.quote.allowance(address(f.engine), PERMIT2), 0, "temporary generic ERC20 allowance revoked");
    }

    function _assertNoTransientDebt(Fixture memory f) private view {
        address[5] memory actors = [POSM, ROUTER, address(f.engine), address(hook), address(ledger)];
        for (uint256 i; i < actors.length; ++i) {
            assertEq(manager.currencyDelta(actors[i], Currency.wrap(address(f.token))), 0);
            assertEq(manager.currencyDelta(actors[i], Currency.wrap(address(f.quote))), 0);
        }
    }
}
