// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ProjectGameEventsV1 } from "../../src/custom-ai/ProjectGameEventsV1.sol";
import { ProjectGameFeeModuleV1 } from "../../src/custom-ai/ProjectGameFeeModuleV1.sol";
import { CustomAITypesV1 as T } from "../../src/custom-ai/CustomAITypesV1.sol";

contract ProjectGameEventsV1Test is Test {
    ProjectGameEventsV1 private game;
    ProjectGameFeeModuleV1 private module;
    uint256 private constant ISSUER_KEY = 101;
    uint256 private constant PLAYER_KEY = 202;
    bytes32 private constant BINDING = keccak256("owned-game-project-revision");
    bytes32 private constant PLAYER_ID = keccak256("game-player-1");
    address private player;

    function setUp() public {
        vm.warp(1000);
        player = vm.addr(PLAYER_KEY);
        game = new ProjectGameEventsV1(BINDING, vm.addr(ISSUER_KEY), 300, 1000);
        module = new ProjectGameFeeModuleV1(game, 50, 100, 300);
        bytes32 nonce = keccak256("wallet-link");
        bytes32 digest = game.walletDigest(player, PLAYER_ID, nonce, 1100);
        game.bindPlayer(player, PLAYER_ID, nonce, 1100, signature(PLAYER_KEY, digest), signature(ISSUER_KEY, digest));
    }

    function signature(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function eventData() private view returns (ProjectGameEventsV1.GameEvent memory) {
        return ProjectGameEventsV1.GameEvent(BINDING, keccak256("match-1"), PLAYER_ID, player, 1, 60, 1000, 1200);
    }

    function test_signedGameResultChangesHookFeeProposalOnce() public {
        T.SwapContext memory context;
        (, uint16 beforeFee,,) = module.quoteFee(context);
        assertEq(beforeFee, 0);
        ProjectGameEventsV1.GameEvent memory item = eventData();
        bytes memory signed = signature(ISSUER_KEY, game.eventDigest(item));
        game.submitEvent(item, signed);
        assertEq(game.totalScore(), 60);
        assertEq(game.playerScore(player), 60);
        (, uint16 afterFee,,) = module.quoteFee(context);
        assertEq(afterFee, 300);
        vm.expectRevert(ProjectGameEventsV1.InvalidEvent.selector);
        game.submitEvent(item, signed);
        assertEq(game.totalScore(), 60);
    }

    function test_rejectsWrongWalletIssuerOrderAndStaleEvents() public {
        ProjectGameEventsV1.GameEvent memory item = eventData();
        bytes memory signed = signature(PLAYER_KEY, game.eventDigest(item));
        vm.expectRevert(ProjectGameEventsV1.InvalidEvent.selector);
        game.submitEvent(item, signed);
        item.player = address(0x1234);
        signed = signature(ISSUER_KEY, game.eventDigest(item));
        vm.expectRevert(ProjectGameEventsV1.InvalidEvent.selector);
        game.submitEvent(item, signed);
        item = eventData();
        item.sequence = 2;
        signed = signature(ISSUER_KEY, game.eventDigest(item));
        vm.expectRevert(ProjectGameEventsV1.InvalidEvent.selector);
        game.submitEvent(item, signed);
        item = eventData();
        signed = signature(ISSUER_KEY, game.eventDigest(item));
        vm.warp(1201);
        vm.expectRevert(ProjectGameEventsV1.InvalidEvent.selector);
        game.submitEvent(item, signed);
    }

    function test_signaturesAreBoundToChainContractAndProject() public {
        ProjectGameEventsV1.GameEvent memory item = eventData();
        bytes memory signed = signature(ISSUER_KEY, game.eventDigest(item));
        vm.chainId(block.chainid + 1);
        vm.expectRevert(ProjectGameEventsV1.InvalidEvent.selector);
        game.submitEvent(item, signed);
        vm.chainId(block.chainid - 1);
        item.bindingId = keccak256("another-project");
        signed = signature(ISSUER_KEY, game.eventDigest(item));
        vm.expectRevert(ProjectGameEventsV1.InvalidEvent.selector);
        game.submitEvent(item, signed);
        assertEq(game.totalScore(), 0);
    }

    function test_walletBindingRequiresBothPlayerAndIssuerAndCannotReplay() public {
        bytes32 nonce = keccak256("link-2");
        bytes32 otherId = keccak256("player-2");
        bytes32 digest = game.walletDigest(player, otherId, nonce, 1100);
        vm.expectRevert(ProjectGameEventsV1.InvalidWallet.selector);
        game.bindPlayer(player, otherId, nonce, 1100, signature(PLAYER_KEY, digest), signature(PLAYER_KEY, digest));
        game.bindPlayer(player, otherId, nonce, 1100, signature(PLAYER_KEY, digest), signature(ISSUER_KEY, digest));
        vm.expectRevert(ProjectGameEventsV1.InvalidWallet.selector);
        game.bindPlayer(player, otherId, nonce, 1100, signature(PLAYER_KEY, digest), signature(ISSUER_KEY, digest));
    }

    function test_staleGameStateFallsBackToNoExtraFee() public {
        ProjectGameEventsV1.GameEvent memory item = eventData();
        game.submitEvent(item, signature(ISSUER_KEY, game.eventDigest(item)));
        vm.warp(1201);
        T.SwapContext memory context;
        (, uint16 fee,,) = module.quoteFee(context);
        assertEq(fee, 0);
    }
}
