// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Verifies history-backed operator observations bound to one execution.
contract CustomAIExecutionPriceFeedV1 is EIP712 {
    struct Quote {
        address program;
        bytes32 poolId;
        bytes32 executionId;
        uint256 amount;
        uint160 sqrtPriceX96;
        uint64 observedAt;
        uint64 validUntil;
        uint64 blockNumber;
        bytes32 blockHash;
        uint32 observations;
        uint64 historySeconds;
    }
    bytes32 private constant TYPEHASH = keccak256(
        "ExecutionPrice(address program,bytes32 poolId,bytes32 executionId,uint256 amount,uint160 sqrtPriceX96,uint64 observedAt,uint64 validUntil,uint64 blockNumber,bytes32 blockHash,uint32 observations,uint64 historySeconds)"
    );
    address public immutable signer;
    error InvalidPrice();

    constructor(address reporter) EIP712("Programmable execution price", "1") {
        if (reporter == address(0)) revert InvalidPrice();
        signer = reporter;
    }

    function digest(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(TYPEHASH, q)));
    }

    function verify(
        Quote calldata q,
        bytes calldata signature,
        uint64 maxAge,
        uint32 minObservations,
        uint64 minHistory
    ) external view {
        if (
            q.program != msg.sender || q.executionId == 0 || q.amount == 0 || q.sqrtPriceX96 == 0
                || q.observedAt > block.timestamp || q.validUntil < block.timestamp
                || q.validUntil > uint256(q.observedAt) + maxAge || block.timestamp - q.observedAt > maxAge
                || q.blockNumber >= block.number || block.number - q.blockNumber > 256
                || blockhash(q.blockNumber) != q.blockHash || q.blockHash == 0 || q.observations < minObservations
                || q.historySeconds < minHistory || ECDSA.recover(digest(q), signature) != signer
        ) revert InvalidPrice();
    }
}
