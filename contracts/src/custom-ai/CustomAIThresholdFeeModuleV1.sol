// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
import { CustomAIDataFeedV1 } from "./CustomAIDataFeedV1.sol";
import { ICustomAIFeeModuleV1 } from "./ICustomAIFeeModuleV1.sol";

/// @notice Reference module: two fixed fee levels driven by a bounded, authenticated data feed.
/// @dev It has no setters or funds; stale data returns zero extra fee. Generated modules use the same narrow ABI.
contract CustomAIThresholdFeeModuleV1 is ICustomAIFeeModuleV1 {
    CustomAIDataFeedV1 public immutable feed;
    bytes32 public immutable feedCodeHash;
    bytes32 public immutable configurationHash;
    int256 public immutable threshold;
    uint16 public immutable belowBps;
    uint16 public immutable atOrAboveBps;

    error InvalidConfiguration();

    constructor(CustomAIDataFeedV1 feed_, int256 threshold_, uint16 below, uint16 atOrAbove) {
        if (address(feed_).code.length == 0 || below > T.MAX_ADDITIONAL_BPS || atOrAbove > T.MAX_ADDITIONAL_BPS) {
            revert InvalidConfiguration();
        }
        feed = feed_;
        feedCodeHash = address(feed_).codehash;
        threshold = threshold_;
        belowBps = below;
        atOrAboveBps = atOrAbove;
        configurationHash = keccak256(
            abi.encode(
                T.VERSION_ID,
                address(feed_),
                address(feed_).codehash,
                feed_.feedId(),
                feed_.signer(),
                feed_.minimum(),
                feed_.maximum(),
                feed_.maxAge(),
                threshold_,
                below,
                atOrAbove
            )
        );
    }

    function quoteFee(T.SwapContext calldata) external view returns (bytes4, uint16, uint64, bytes32) {
        if (address(feed).codehash != feedCodeHash) return (this.quoteFee.selector, 0, 0, configurationHash);
        (int256 value, bool fresh) = feed.latest();
        return (
            this.quoteFee.selector,
            fresh ? (value < threshold ? belowBps : atOrAboveBps) : 0,
            feed.validUntil(),
            configurationHash
        );
    }
}
