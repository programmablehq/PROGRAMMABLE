// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IV4Router } from "@uniswap/v4-periphery-v211/src/interfaces/IV4Router.sol";
import { IUniversalRouter } from "@uniswap/universal-router/contracts/interfaces/IUniversalRouter.sol";
import { Commands } from "@uniswap/universal-router/contracts/libraries/Commands.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
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
import {
    AnyQuotePositionManagerLPModuleV1
} from "../../../src/module-engine/any-quote/AnyQuotePositionManagerLPModuleV1.sol";
import { AnyQuoteLedgerV1 } from "../../../src/module-engine/any-quote/AnyQuoteLedgerV1.sol";
import { AnyQuoteTypesV1 as A } from "../../../src/module-engine/any-quote/AnyQuoteTypesV1.sol";

/// @dev Fixed-block simulation with locally deployed production Host/hook/ledger/new engine and local ETH funding.
/// Canonical factory, PoolManager, PositionManager, Permit2, UR and the V4 quote market are reused unchanged.
contract AnyQuotePositionManagerLPModuleV1HostForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    uint256 private constant SNAPSHOT_BLOCK = 61_917_458;
    uint128 private constant ETH_INPUT = 0.0001 ether;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant AUTHOR = A.PLATFORM_RECIPIENT;
    address private constant MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address private constant POSM = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address private constant ROUTER = 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
    address private constant QUOTE = 0xC60bA256B44334A0Cd2C7242E98B88f031abB006;
    address private constant QUOTE_HOOK = 0x720e649549F7BC2118aCBA9F4C9ae6fCC7586080;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes32 private constant REVISION = keccak256("PositionManager custody canonical host fork");
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

    function setUp() public {
        string memory rpc = vm.envOr("POSITION_MANAGER_ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        assertEq(block.chainid, 4663);
        assertEq(block.timestamp, 1_789_298_494);
        vm.deal(BOB, 1 ether);
        vm.deal(ALICE, 1 ether);
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
    }

    function test_hostAdmitsVariantAtomicNativeInitialBuyAndPrefundedBuyMaxSell() public {
        Host.LaunchParameters memory p = _parameters();
        _setInitialNativeBuy(p);
        vm.recordLogs();
        vm.prank(ALICE);
        Host.Launch memory launched = host.launch{ value: ETH_INPUT }(p);
        _assertCustodyAndEventOrder(launched, vm.getRecordedLogs());
        assertGt(IERC20(launched.token).balanceOf(ALICE), 0, "atomic actual ETH -> V4 -> primary initial buy");
        assertGt(ledger.totalReceived(QUOTE), 0);
        uint256 grossQuote = _acquireQuote();
        vm.startPrank(BOB);
        IERC20(QUOTE).approve(address(host), grossQuote);
        T.Operation memory op = T.Operation(
            host.BUY(), BOB, BOB, QUOTE, grossQuote, launched.token, 1, block.timestamp + 60, 0, abi.encode(uint160(0))
        );
        uint256 feesBefore = ledger.totalReceived(QUOTE);
        uint256 bought = abi.decode(host.execute(launched.launchId, op), (uint256));
        assertGt(bought, 0);
        assertEq(IERC20(launched.token).balanceOf(BOB), bought);
        assertEq(IERC20(QUOTE).balanceOf(BOB), 0);
        IERC20(launched.token).approve(address(host), bought);
        op = T.Operation(
            host.SELL(), BOB, BOB, launched.token, bought, QUOTE, 1, block.timestamp + 60, 1, abi.encode(uint160(0))
        );
        uint256 sold = abi.decode(host.execute(launched.launchId, op), (uint256));
        vm.stopPrank();
        assertGt(sold, 0);
        assertEq(IERC20(QUOTE).balanceOf(BOB), sold);
        assertEq(IERC20(launched.token).balanceOf(BOB), 0);
        assertGt(ledger.totalReceived(QUOTE), feesBefore);
        AnyQuotePositionManagerLPModuleV1 engine = AnyQuotePositionManagerLPModuleV1(launched.engine);
        assertEq(IERC721(POSM).ownerOf(engine.positionTokenId()), launched.engine);
        assertEq(engine.positionManager().getPositionLiquidity(engine.positionTokenId()), engine.lockedLiquidity());
        assertEq(IERC20(launched.token).balanceOf(launched.engine), engine.lockedTokenDust());
        assertEq(IERC20(QUOTE).balanceOf(launched.engine), 0);
        address[2] memory assets = [launched.token, QUOTE];
        address[2] memory spenders = [POSM, ROUTER];
        for (uint256 a; a < 2; ++a) {
            for (uint256 s; s < 2; ++s) {
                (uint160 amount,,) = IAllowanceTransfer(PERMIT2).allowance(launched.engine, assets[a], spenders[s]);
                assertEq(amount, 0);
            }
        }
        assertEq(host.nonces(launched.launchId, BOB), 2);
    }

    function test_hostNativeInitialBuyMinimumRollsBackNFTPoolTokenAndFunding() public {
        Host.LaunchParameters memory p = _parameters();
        _setInitialNativeBuy(p);
        p.initialOperation.minimumOutput = A.TOKEN_SUPPLY;
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        uint256 next = IPositionManager(POSM).nextTokenId();
        uint256 nativeBefore = ALICE.balance;
        vm.prank(ALICE);
        vm.expectRevert();
        host.launch{ value: ETH_INPUT }(p);
        assertEq(token.code.length, 0);
        assertEq(ALICE.balance, nativeBefore);
        assertEq(IPositionManager(POSM).nextTokenId(), next);
        assertEq(ledger.totalReceived(QUOTE), 0);
    }

    function _acquireQuote() private returns (uint256 output) {
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(IV4Router.ExactInputSingleParams(market, true, ETH_INPUT, 1, 0, ""));
        params[1] = abi.encode(address(0), uint256(ETH_INPUT));
        params[2] = abi.encode(QUOTE, BOB, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0e", params);
        uint256 beforeBalance = IERC20(QUOTE).balanceOf(BOB);
        vm.prank(BOB);
        IUniversalRouter(ROUTER).execute{ value: ETH_INPUT }(hex"10", inputs, block.timestamp + 60);
        output = IERC20(QUOTE).balanceOf(BOB) - beforeBalance;
    }

    function _assertCustodyAndEventOrder(Host.Launch memory launched, Vm.Log[] memory logs) private view {
        AnyQuotePositionManagerLPModuleV1 engine = AnyQuotePositionManagerLPModuleV1(launched.engine);
        assertEq(
            launched.resourcesHash,
            keccak256(
                abi.encode(
                    engine.LP_CUSTODY_SCHEMA_ID(),
                    POSM,
                    engine.positionTokenId(),
                    engine.poolId(),
                    engine.tickLower(),
                    engine.tickUpper(),
                    engine.lockedLiquidity(),
                    engine.lockedTokenDust(),
                    engine.quoteDecimals()
                )
            )
        );
        uint256 minted = type(uint256).max;
        uint256 modified = type(uint256).max;
        uint256 launchedAt = type(uint256).max;
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory entry = logs[i];
            if (entry.emitter == POSM && entry.topics[0] == keccak256("Transfer(address,address,uint256)")) {
                assertEq(entry.topics[1], bytes32(0));
                assertEq(address(uint160(uint256(entry.topics[2]))), launched.engine);
                assertEq(uint256(entry.topics[3]), engine.positionTokenId());
                minted = i;
            }
            if (
                entry.emitter == MANAGER
                    && entry.topics[0] == keccak256("ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)")
            ) {
                assertEq(entry.topics[1], engine.poolId());
                assertEq(address(uint160(uint256(entry.topics[2]))), POSM);
                modified = i;
            }
            if (
                entry.emitter == address(host)
                    && entry.topics[0]
                        == keccak256(
                            "EngineLaunchBound(bytes32,address,address,address,address,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32)"
                        )
            ) launchedAt = i;
        }
        assertLt(minted, modified);
        assertLt(modified, launchedAt);
        assertLt(launchedAt, logs.length);
    }

    function _setInitialNativeBuy(Host.LaunchParameters memory p) private view {
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        bool quote0 = QUOTE < token;
        PoolKey memory primary = PoolKey(
            Currency.wrap(quote0 ? QUOTE : token), Currency.wrap(quote0 ? token : QUOTE), 0, 200, IHooks(address(hook))
        );
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(address(0), uint128(ETH_INPUT), false);
        params[1] = abi.encode(IV4Router.ExactInputSingleParams(market, true, ETH_INPUT, 1, 0, ""));
        params[2] = abi.encode(IV4Router.ExactInputSingleParams(primary, quote0, 0, 1, 0, ""));
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
        p.name = "PositionManager Custody Host Fork";
        p.symbol = "PMCUST";
        p.creatorSalt = bytes32(uint256(1));
        p.revisionId = REVISION;
        p.quoteAsset = QUOTE;
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        // Raw-price fork fixture only; independent USD price preparation remains API-owned.
        p.configuration = abi.encode(
            A.Configuration(
                A.SCHEMA_ID,
                MANAGER,
                MANAGER.codehash,
                address(hook),
                QUOTE,
                QUOTE < token ? int24(50_400) : int24(-50_400),
                uint64(block.timestamp + 180),
                keccak256("fixed-block V4 raw-price test fixture")
            )
        );
        p.creationCode = vm.getCode("AnyQuotePositionManagerLPModuleV1.sol:AnyQuotePositionManagerLPModuleV1");
        p.runtimeTemplate =
            vm.getDeployedCode("AnyQuotePositionManagerLPModuleV1.sol:AnyQuotePositionManagerLPModuleV1");
        p.creatorWallets = new address[](1);
        p.creatorWallets[0] = ALICE;
        p.creatorSharesBps = new uint16[](1);
        p.creatorSharesBps[0] = 10_000;
        p.buyCreatorFeeBps = 100;
        p.sellCreatorFeeBps = 200;
    }

    function _bindings() private {
        // Isolated builds pass only their compiled immutable-reference JSON through the environment.
        string memory json = vm.envOr("POSITION_MANAGER_LP_IMMUTABLE_REFERENCES", string(""));
        if (bytes(json).length == 0) {
            json = vm.readFile("out/AnyQuotePositionManagerLPModuleV1.sol/AnyQuotePositionManagerLPModuleV1.json");
        }
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
            keccak256(vm.getCode("AnyQuotePositionManagerLPModuleV1.sol:AnyQuotePositionManagerLPModuleV1")),
            keccak256(vm.getDeployedCode("AnyQuotePositionManagerLPModuleV1.sol:AnyQuotePositionManagerLPModuleV1")),
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

/// @dev Deterministic encoding check only; it does not claim a fork, quote or deployed execution.
contract AnyQuotePositionManagerLPModuleV1SdkTest is Test {
    function testSdkV211Encoding() public pure {
        PoolKey memory key = PoolKey(
            Currency.wrap(0x66989cfcf73cdBf27DB2CCA0154B5d15B95166A8),
            Currency.wrap(0xC60bA256B44334A0Cd2C7242E98B88f031abB006),
            0,
            200,
            IHooks(0xcF533f717b787f6EB591498411AEF8231366a0cc)
        );
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(IV4Router.ExactInputSingleParams(key, false, 1 ether, 1000, 0, ""));
        params[1] = abi.encode(key.currency1, uint256(1 ether));
        params[2] = abi.encode(key.currency0, uint256(1000));
        bytes memory actions =
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        bytes memory commands = abi.encodePacked(uint8(Commands.V4_SWAP));
        // Fixed outputs of official @uniswap/v4-sdk 2.3.1 + universal-router-sdk 5.11.1,
        // V4Planner/RoutePlanner with explicit URVersion.V2_1_1. Arbitrary encoding fixture only.
        assertEq(keccak256(params[0]), bytes32(0x8c632d0e5aefef152d6b9cbcb04d0dc7be559094da573fd901072785dd5c0690));
        assertEq(keccak256(inputs[0]), bytes32(0xdf3cea79759635a6a3b0b2a2e9452a1eeb154f14da40afabca32848ecc1060f7));
        assertEq(
            keccak256(abi.encodeCall(IUniversalRouter.execute, (commands, inputs, 1_789_298_554))),
            bytes32(0x60da9b1a61a28b09273babae3da9136455ce1dda66c34d1ee0e02adbb982b343)
        );
        bytes[] memory mintParams = new bytes[](2);
        mintParams[0] = abi.encode(
            key,
            int24(-120_000),
            int24(887_200),
            uint256(999_987_654_321),
            uint128(98_765),
            uint128(0),
            address(0x16280679F81F9B11DD6C5f78bd085a0b62099e67),
            bytes("")
        );
        mintParams[1] = abi.encode(key.currency0, key.currency1);
        assertEq(
            keccak256(
                abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR)), mintParams)
            ),
            bytes32(0x342fff1711783ad3caac87133300e9542eb64aa3e77243bbc4d05b41cec34727)
        );
    }
}
