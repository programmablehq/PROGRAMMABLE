// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Fixed-source observations. Reporter identity authenticates a report, not the underlying fact.
contract CustomAIDataFeedV2 is EIP712 {
    bytes32 public constant UPDATE_TYPEHASH = keccak256(
        "DataUpdate(bytes32 feedId,bytes32 sourceVersion,uint64 sequence,int256 value,uint64 observedAt,uint64 validUntil)"
    );
    bytes32 public immutable feedId;
    bytes32 public immutable sourceVersion;
    address public immutable signer;
    int256 public immutable minimum;
    int256 public immutable maximum;
    uint64 public immutable maxAge;
    uint64 public sequence;
    uint64 public transitionSequence;
    uint64 public changedAt;
    uint64 public observedAt;
    uint64 public validUntil;
    int256 public value;
    int256 public previousValue;
    error InvalidUpdate();
    event Updated(uint64 indexed sequence, uint64 indexed transitionSequence, int256 value, uint64 observedAt);

    constructor(bytes32 id, bytes32 version_, address reporter, int256 min_, int256 max_, uint64 age)
        EIP712("Programmable Custom AI Data", "2")
    {
        if (id == 0 || version_ == 0 || reporter == address(0) || min_ > max_ || age == 0 || age > 1 days) {
            revert InvalidUpdate();
        }
        feedId = id;
        sourceVersion = version_;
        signer = reporter;
        minimum = min_;
        maximum = max_;
        maxAge = age;
    }

    function digest(uint64 seq, int256 val, uint64 observed, uint64 expires) public view returns (bytes32) {
        return
            _hashTypedDataV4(keccak256(abi.encode(UPDATE_TYPEHASH, feedId, sourceVersion, seq, val, observed, expires)));
    }

    function update(uint64 seq, int256 val, uint64 observed, uint64 expires, bytes calldata signature) external {
        if (
            seq <= sequence || val < minimum || val > maximum || observed > block.timestamp || observed < observedAt
                || (sequence != 0 && observed == observedAt && val != value) || block.timestamp - observed > maxAge
                || expires < block.timestamp || expires < observed || uint256(expires) > uint256(observed) + maxAge
                || ECDSA.recover(digest(seq, val, observed, expires), signature) != signer
        ) revert InvalidUpdate();
        if (sequence != 0 && val != value) {
            previousValue = value;
            changedAt = observed;
            transitionSequence++;
        }
        if (sequence == 0) previousValue = val;
        sequence = seq;
        value = val;
        observedAt = observed;
        validUntil = expires;
        emit Updated(seq, transitionSequence, val, observed);
    }

    function latestSnapshot() external view returns (uint64, uint64, int256, int256, uint64, uint64, uint64, bool) {
        return (
            sequence,
            transitionSequence,
            value,
            previousValue,
            changedAt,
            observedAt,
            validUntil,
            sequence != 0 && observedAt <= block.timestamp && block.timestamp <= validUntil
                && block.timestamp - observedAt <= maxAge
        );
    }
}
