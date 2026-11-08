// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ProjectPlayerGameEventsV1 } from "../../src/custom-ai/ProjectPlayerGameEventsV1.sol";
import { ProjectGameEventsV1 as LegacyGameEvents } from "../../src/custom-ai/ProjectGameEventsV1.sol";
import { ProjectPlayerGameFeeModuleV1 } from "../../src/custom-ai/ProjectPlayerGameFeeModuleV1.sol";
import { CustomAITypesV1 as T } from "../../src/custom-ai/CustomAITypesV1.sol";
import { CustomAIModuleCallV1 as M } from "../../src/custom-ai/CustomAIModuleCallV1.sol";

contract PlayerGameRouterFixture {
    address public actor;
    uint8 public mode;

    function configure(address account, uint8 behavior) external {
        actor = account;
        mode = behavior;
    }

    function msgSender() external view returns (address) {
        uint8 behavior = mode;
        address value = actor;
        if (behavior == 1) revert("unavailable");
        if (behavior == 2) {
            assembly ("memory-safe") { return(0, 0) }
        }
        if (behavior == 3) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(0, 31)
            }
        }
        if (behavior == 4) {
            assembly ("memory-safe") {
                mstore(0, or(shl(160, 1), value))
                return(0, 32)
            }
        }
        if (behavior == 5) {
            assembly ("memory-safe") {
                mstore(0, value)
                return(0, 64)
            }
        }
        if (behavior == 6) {
            assembly ("memory-safe") { for { } 1 { } { } }
        }
        return actor;
    }
}

contract ProjectPlayerGameFeeModuleV1Test is Test {
    uint256 private constant ISSUER_KEY = 101;
    uint256 private constant ALICE_KEY = 202;
    uint256 private constant BOB_KEY = 303;
    bytes32 private constant BINDING = keccak256("individual-game");
    ProjectPlayerGameEventsV1 private game;
    PlayerGameRouterFixture private router;
    ProjectPlayerGameFeeModuleV1 private module;
    address private alice;
    address private bob;

    function setUp() public {
        vm.warp(1000);
        alice = vm.addr(ALICE_KEY);
        bob = vm.addr(BOB_KEY);
        game = new ProjectPlayerGameEventsV1(BINDING, vm.addr(ISSUER_KEY), 300, 1);
        router = new PlayerGameRouterFixture();
        module = new ProjectPlayerGameFeeModuleV1(game, address(router), 3, 200, 100);
        _link(ALICE_KEY);
        _link(BOB_KEY);
    }

    function _signature(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _link(uint256 key) private {
        address player = vm.addr(key);
        bytes32 playerId = keccak256(abi.encode(player));
        bytes32 nonce = keccak256(abi.encode("link", player));
        bytes32 digest = game.walletDigest(player, playerId, nonce, 1100);
        game.bindPlayer(player, playerId, nonce, 1100, _signature(key, digest), _signature(ISSUER_KEY, digest));
    }

    function _event(address player, uint64 sequence) private view returns (ProjectPlayerGameEventsV1.GameEvent memory) {
        return ProjectPlayerGameEventsV1.GameEvent(
            BINDING,
            keccak256(abi.encode(player, sequence)),
            keccak256(abi.encode(player)),
            player,
            sequence,
            1,
            uint64(block.timestamp),
            uint64(block.timestamp + 120)
        );
    }

    function _win(address player, uint64 sequence) private {
        ProjectPlayerGameEventsV1.GameEvent memory item = _event(player, sequence);
        game.submitEvent(item, _signature(ISSUER_KEY, game.eventDigest(item)));
    }

    function _fee(address sender) private view returns (uint16) {
        T.SwapContext memory context;
        context.router = sender;
        (uint16 fee, M.Status status) = M.evaluate(
            T.ModuleBinding(address(module), address(module).codehash, module.configurationHash()), context
        );
        assertEq(uint8(status), uint8(M.Status.Applied));
        return fee;
    }

    function test_onlyThePlayerWithThreeSignedWinsReceivesTheBonus() public {
        router.configure(alice, 0);
        assertEq(_fee(address(router)), 200);
        _win(alice, 1);
        _win(alice, 2);
        assertEq(_fee(address(router)), 200);
        _win(alice, 3);
        assertEq(_fee(address(router)), 100);
        _win(bob, 1);
        _win(bob, 2);
        router.configure(bob, 0);
        assertEq(game.totalScore(), 5);
        assertEq(_fee(address(router)), 200);
    }

    function test_cannotPoolWinsFromDifferentGamePlayersIntoOneWalletBonus() public {
        _win(alice, 1);
        _win(alice, 2);
        bytes32 otherPlayer = keccak256("another game identity");
        bytes32 nonce = keccak256("second identity link");
        bytes32 digest = game.walletDigest(alice, otherPlayer, nonce, 1100);
        bytes memory playerSigned = _signature(ALICE_KEY, digest);
        bytes memory issuerSigned = _signature(ISSUER_KEY, digest);
        vm.expectRevert(ProjectPlayerGameEventsV1.InvalidWallet.selector);
        game.bindPlayer(alice, otherPlayer, nonce, 1100, playerSigned, issuerSigned);
        assertEq(game.walletForPlayer(otherPlayer), address(0));
        assertEq(game.playerIdForWallet(alice), keccak256(abi.encode(alice)));
        assertFalse(game.usedWalletNonce(nonce));
        router.configure(alice, 0);
        assertEq(_fee(address(router)), 200, "No individual game player has three wins");
        _win(alice, 3);
        assertEq(_fee(address(router)), 100);
    }

    function test_duplicateForgedAndStaleWinsCannotCreateEligibility() public {
        _win(alice, 1);
        _win(alice, 2);
        ProjectPlayerGameEventsV1.GameEvent memory item = _event(alice, 2);
        bytes memory duplicate = _signature(ISSUER_KEY, game.eventDigest(item));
        vm.expectRevert(ProjectPlayerGameEventsV1.InvalidEvent.selector);
        game.submitEvent(item, duplicate);
        item = _event(alice, 3);
        bytes32 digest = game.eventDigest(item);
        bytes memory forged = _signature(ALICE_KEY, digest);
        vm.expectRevert(ProjectPlayerGameEventsV1.InvalidEvent.selector);
        game.submitEvent(item, forged);
        bytes memory signed = _signature(ISSUER_KEY, digest);
        vm.warp(1400);
        vm.expectRevert(ProjectPlayerGameEventsV1.InvalidEvent.selector);
        game.submitEvent(item, signed);
        router.configure(alice, 0);
        assertEq(_fee(address(router)), 200);
        assertEq(game.playerScore(alice), 2);
    }

    function test_lookalikeRouterDirectWalletAndMissingActorKeepRegularFee() public {
        _win(alice, 1);
        _win(alice, 2);
        _win(alice, 3);
        PlayerGameRouterFixture fake = new PlayerGameRouterFixture();
        fake.configure(alice, 0);
        assertEq(_fee(address(fake)), 200);
        assertEq(_fee(alice), 200);
        router.configure(address(0), 0);
        assertEq(_fee(address(router)), 200);
    }

    function test_malformedRevertingAndGasBurningActorRepliesKeepRegularFee() public {
        _win(alice, 1);
        _win(alice, 2);
        _win(alice, 3);
        for (uint8 mode = 1; mode <= 6; mode++) {
            router.configure(alice, mode);
            assertEq(_fee(address(router)), 200);
        }
    }

    function test_changedRouterOrReceiverCodeKeepsRegularFee() public {
        _win(alice, 1);
        _win(alice, 2);
        _win(alice, 3);
        router.configure(alice, 0);
        assertEq(_fee(address(router)), 100);
        bytes memory original = address(router).code;
        vm.etch(address(router), hex"00");
        assertEq(_fee(address(router)), 200);
        vm.etch(address(router), original);
        vm.etch(address(game), hex"00");
        assertEq(_fee(address(router)), 200);
    }

    function test_earnedBonusPersistsWhileOldNewlySubmittedResultsAreRejected() public {
        _win(alice, 1);
        _win(alice, 2);
        _win(alice, 3);
        router.configure(alice, 0);
        vm.warp(1 days);
        assertEq(_fee(address(router)), 100);
    }

    function test_rejectsInvalidConfiguration() public {
        vm.expectRevert(ProjectPlayerGameFeeModuleV1.InvalidConfiguration.selector);
        new ProjectPlayerGameFeeModuleV1(ProjectPlayerGameEventsV1(address(0)), address(router), 3, 200, 100);
        vm.expectRevert(ProjectPlayerGameFeeModuleV1.InvalidConfiguration.selector);
        new ProjectPlayerGameFeeModuleV1(game, address(0), 3, 200, 100);
        vm.expectRevert(ProjectPlayerGameFeeModuleV1.InvalidConfiguration.selector);
        new ProjectPlayerGameFeeModuleV1(game, address(router), 0, 200, 100);
        vm.expectRevert(ProjectPlayerGameFeeModuleV1.InvalidConfiguration.selector);
        new ProjectPlayerGameFeeModuleV1(game, address(router), 3, 200, 201);
        vm.expectRevert(ProjectPlayerGameFeeModuleV1.InvalidConfiguration.selector);
        new ProjectPlayerGameFeeModuleV1(game, address(router), 3, 1500, 100);
        LegacyGameEvents legacy = new LegacyGameEvents(BINDING, vm.addr(ISSUER_KEY), 300, 1);
        vm.expectRevert(ProjectPlayerGameFeeModuleV1.InvalidConfiguration.selector);
        new ProjectPlayerGameFeeModuleV1(ProjectPlayerGameEventsV1(address(legacy)), address(router), 3, 200, 100);
    }

    function test_configurationBindsRouterAndStaysStableAcrossWins() public {
        bytes32 beforeHash = module.configurationHash();
        _win(alice, 1);
        _win(alice, 2);
        _win(alice, 3);
        assertEq(module.configurationHash(), beforeHash);
        PlayerGameRouterFixture other = new PlayerGameRouterFixture();
        ProjectPlayerGameFeeModuleV1 otherModule = new ProjectPlayerGameFeeModuleV1(game, address(other), 3, 200, 100);
        assertNotEq(otherModule.configurationHash(), beforeHash);
    }
}
