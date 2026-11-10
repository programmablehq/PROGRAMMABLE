// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IHyperEvmHypeUsdFeedV1 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

interface IElysiumInboxV1 {
    function bridge() external view returns (address);
    function calculateRetryableSubmissionFee(uint256 dataLength, uint256 baseFee) external view returns (uint256);
    function createRetryableTicket(
        address to,
        uint256 l2CallValue,
        uint256 maxSubmissionCost,
        address excessFeeRefundAddress,
        address callValueRefundAddress,
        uint256 gasLimit,
        uint256 maxFeePerGas,
        bytes calldata data
    ) external payable returns (uint256);
}

/// @notice Permissionless delivery of the existing HyperEVM HYPE/USD feed to Elysium.
/// @dev Callers fund delivery and cannot supply a price, timestamp, source or recipient.
contract ElysiumHypeUsdRelayV1 {
    address public constant SOURCE_FEED = 0x2b25BC41D55de29F3A2e163F8Eebf63966B25b57;
    bytes32 public constant SOURCE_CODE_HASH = 0xbd6f524cdc4268b6bd1bb6f77a8821faeea9c52ee9e0afa0b6d948ce82c966c2;
    IElysiumInboxV1 public constant INBOX = IElysiumInboxV1(0xce59f8B65ad41C9DAE4c07A0571a39824bD92cff);
    address public constant BRIDGE = 0x503D572157113fAaaD4DbeD2647Bb10b949216B6;
    uint256 public constant MAX_FEED_AGE = 24 hours + 120 seconds;
    address public immutable destinationFeed;
    uint80 public lastRelayedRound;
    uint256 public lastTicketId;
    uint256 public lastSourceUpdatedAt;

    error InvalidConfiguration();
    error InvalidPrice();
    error RoundOutOfOrder();
    error InsufficientDeliveryFee();

    event PriceRelayed(uint80 indexed roundId, uint256 indexed ticketId, int256 answer, uint256 sourceUpdatedAt);

    constructor(address destinationFeed_) {
        if (
            block.chainid != 999 || destinationFeed_ == address(0) || SOURCE_FEED.codehash != SOURCE_CODE_HASH
                || IHyperEvmHypeUsdFeedV1(SOURCE_FEED).decimals() != 18 || INBOX.bridge() != BRIDGE
        ) revert InvalidConfiguration();
        destinationFeed = destinationFeed_;
    }

    function quote(uint256 gasLimit, uint256 maxFeePerGas) public view returns (uint256) {
        // receivePrice(uint80,int256,uint256): selector plus three static words.
        return INBOX.calculateRetryableSubmissionFee(100, 0) * 2 + gasLimit * maxFeePerGas;
    }

    function relay(uint256 gasLimit, uint256 maxFeePerGas) external payable returns (uint256 ticketId) {
        if (SOURCE_FEED.codehash != SOURCE_CODE_HASH || IHyperEvmHypeUsdFeedV1(SOURCE_FEED).decimals() != 18) {
            revert InvalidConfiguration();
        }
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            IHyperEvmHypeUsdFeedV1(SOURCE_FEED).latestRoundData();
        if (
            answer <= 0 || roundId == 0 || answeredInRound < roundId || updatedAt == 0 || updatedAt > block.timestamp
                || block.timestamp - updatedAt > MAX_FEED_AGE
        ) revert InvalidPrice();
        // Re-sending the current round is intentional: a failed or underpriced
        // retryable must never let a permissionless caller block later delivery.
        if (roundId < lastRelayedRound) revert RoundOutOfOrder();
        if (gasLimit < 100_000 || gasLimit > 500_000 || maxFeePerGas == 0 || msg.value < quote(gasLimit, maxFeePerGas))
        {
            revert InsufficientDeliveryFee();
        }
        lastRelayedRound = roundId;
        lastSourceUpdatedAt = updatedAt;
        ticketId = INBOX.createRetryableTicket{ value: msg.value }(
            destinationFeed,
            0,
            INBOX.calculateRetryableSubmissionFee(100, 0) * 2,
            msg.sender,
            msg.sender,
            gasLimit,
            maxFeePerGas,
            abi.encodeWithSignature("receivePrice(uint80,int256,uint256)", roundId, answer, updatedAt)
        );
        lastTicketId = ticketId;
        emit PriceRelayed(roundId, ticketId, answer, updatedAt);
    }
}
