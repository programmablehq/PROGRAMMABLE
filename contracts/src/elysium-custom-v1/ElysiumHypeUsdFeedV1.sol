// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice HYPE/USD observations authenticated by Elysium's canonical parent-chain inbox.
/// @dev The source timestamp is retained. Delivery never makes an old price fresh.
contract ElysiumHypeUsdFeedV1 {
    uint8 public constant decimals = 18;
    uint256 public constant MAX_FEED_AGE = 24 hours + 120 seconds;
    address public immutable parentRelay;
    address public immutable aliasedParentRelay;
    uint80 private _round;
    int256 private _answer;
    uint256 private _updatedAt;

    error InvalidConfiguration();
    error Unauthorized();
    error InvalidPrice();
    error NoPrice();

    event PriceReceived(uint80 indexed roundId, int256 answer, uint256 sourceUpdatedAt);

    constructor(address parentRelay_) {
        if (block.chainid != 99901 || parentRelay_ == address(0)) revert InvalidConfiguration();
        parentRelay = parentRelay_;
        unchecked {
            aliasedParentRelay = address(uint160(parentRelay_) + uint160(0x1111000000000000000000000000000000001111));
        }
    }

    function receivePrice(uint80 roundId, int256 answer, uint256 sourceUpdatedAt) external {
        if (msg.sender != aliasedParentRelay) revert Unauthorized();
        if (
            roundId <= _round || answer <= 0 || sourceUpdatedAt == 0 || sourceUpdatedAt < _updatedAt
                || sourceUpdatedAt > block.timestamp || block.timestamp - sourceUpdatedAt > MAX_FEED_AGE
        ) revert InvalidPrice();
        _round = roundId;
        _answer = answer;
        _updatedAt = sourceUpdatedAt;
        emit PriceReceived(roundId, answer, sourceUpdatedAt);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        if (_round == 0) revert NoPrice();
        return (_round, _answer, _updatedAt, _updatedAt, _round);
    }
}
