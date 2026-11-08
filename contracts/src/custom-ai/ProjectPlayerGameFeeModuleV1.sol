// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProjectPlayerGameEventsV1 } from "./ProjectPlayerGameEventsV1.sol";
import { ICustomAIFeeModuleV1 } from "./ICustomAIFeeModuleV1.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";

interface IProjectPlayerGameRouterV1 {
    function msgSender() external view returns (address);
}

/// @notice An individual bonus based on signed scores and a pinned router's active initiator.
/// @dev The hook must supply the actual callback sender. Unsupported identity paths keep regular fees.
contract ProjectPlayerGameFeeModuleV1 is ICustomAIFeeModuleV1 {
    ProjectPlayerGameEventsV1 public immutable game;
    bytes32 public immutable gameCodeHash;
    address public immutable router;
    bytes32 public immutable routerCodeHash;
    bytes32 public immutable configurationHash;
    uint256 public immutable threshold;
    uint16 public immutable regularBps;
    uint16 public immutable bonusBps;

    error InvalidConfiguration();

    constructor(
        ProjectPlayerGameEventsV1 game_,
        address router_,
        uint256 scoreThreshold,
        uint16 regular,
        uint16 bonus
    ) {
        if (
            address(game_).code.length == 0 || router_.code.length == 0 || scoreThreshold == 0
                || regular > T.MAX_ADDITIONAL_BPS || bonus > regular
        ) revert InvalidConfiguration();
        try game_.PLAYER_POLICY() returns (bytes32 policy) {
            if (policy != keccak256("programmable.game.unique-player.v1")) revert InvalidConfiguration();
        } catch {
            revert InvalidConfiguration();
        }
        game = game_;
        gameCodeHash = address(game_).codehash;
        router = router_;
        routerCodeHash = router_.codehash;
        threshold = scoreThreshold;
        regularBps = regular;
        bonusBps = bonus;
        configurationHash = keccak256(
            abi.encode(
                T.VERSION_ID,
                "programmable.player-game-fee.v1",
                address(game_),
                gameCodeHash,
                game_.bindingId(),
                game_.issuer(),
                game_.maxAge(),
                game_.maximumScore(),
                router_,
                routerCodeHash,
                scoreThreshold,
                regular,
                bonus
            )
        );
    }

    function quoteFee(T.SwapContext calldata context) external view returns (bytes4, uint16, uint64, bytes32) {
        uint16 fee = regularBps;
        if (context.router == router && router.codehash == routerCodeHash && address(game).codehash == gameCodeHash) {
            address player = _activePlayer();
            if (player != address(0) && game.playerScore(player) >= threshold) fee = bonusBps;
        }
        return (this.quoteFee.selector, fee, type(uint64).max, configurationHash);
    }

    function _activePlayer() private view returns (address) {
        uint256 selector = uint32(IProjectPlayerGameRouterV1.msgSender.selector);
        address target = router;
        uint256 result;
        bool valid;
        // Bound both execution and copied return data, including for a malformed configured router.
        assembly ("memory-safe") {
            let buffer := mload(0x40)
            mstore(buffer, shl(224, selector))
            valid := staticcall(20000, target, buffer, 4, buffer, 32)
            valid := and(valid, eq(returndatasize(), 32))
            result := mload(buffer)
        }
        return valid && result <= type(uint160).max ? address(uint160(result)) : address(0);
    }
}
