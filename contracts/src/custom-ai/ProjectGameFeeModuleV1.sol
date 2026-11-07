// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProjectGameEventsV1 } from "./ProjectGameEventsV1.sol";
import { ICustomAIFeeModuleV1 } from "./ICustomAIFeeModuleV1.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";

/// @notice Example: the game's verified cumulative score selects a community-wide extra fee.
/// @dev A router address is not a player's identity. This module makes no per-player fee claim.
contract ProjectGameFeeModuleV1 is ICustomAIFeeModuleV1 {
    ProjectGameEventsV1 public immutable game;
    bytes32 public immutable gameCodeHash;
    bytes32 public immutable configurationHash;
    uint256 public immutable threshold;
    uint16 public immutable belowBps;
    uint16 public immutable atOrAboveBps;
    error InvalidConfiguration();

    constructor(ProjectGameEventsV1 game_, uint256 scoreThreshold, uint16 below, uint16 above) {
        if (address(game_).code.length == 0 || below > T.MAX_ADDITIONAL_BPS || above > T.MAX_ADDITIONAL_BPS) {
            revert InvalidConfiguration();
        }
        game = game_;
        gameCodeHash = address(game_).codehash;
        threshold = scoreThreshold;
        belowBps = below;
        atOrAboveBps = above;
        configurationHash = keccak256(
            abi.encode(
                T.VERSION_ID,
                address(game_),
                gameCodeHash,
                game_.bindingId(),
                game_.issuer(),
                game_.maxAge(),
                game_.maximumScore(),
                scoreThreshold,
                below,
                above
            )
        );
    }

    function quoteFee(T.SwapContext calldata) external view returns (bytes4, uint16, uint64, bytes32) {
        if (address(game).codehash != gameCodeHash) return (this.quoteFee.selector, 0, 0, configurationHash);
        (uint256 score, bool fresh) = game.latest();
        return (
            this.quoteFee.selector,
            fresh ? (score < threshold ? belowBps : atOrAboveBps) : 0,
            game.validUntil(),
            configurationHash
        );
    }
}
