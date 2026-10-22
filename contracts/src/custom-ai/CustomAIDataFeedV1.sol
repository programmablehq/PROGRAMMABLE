// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Optional immutable, bounded input for generated modules; a valid signature is not a truth oracle.
/// @dev No owner or fee authority. Each deployment fixes its source, data bounds and maximum age.
contract CustomAIDataFeedV1 is EIP712 {
    bytes32 public constant UPDATE_TYPEHASH =
        keccak256("DataUpdate(bytes32 feedId,uint64 sequence,int256 value,uint64 observedAt,uint64 validUntil)");
    bytes32 public immutable feedId;
    address public immutable signer;
    int256 public immutable minimum;
    int256 public immutable maximum;
    uint64 public immutable maxAge;
    uint64 public sequence;
    int256 public value;
    uint64 public observedAt;
    uint64 public validUntil;

    error InvalidConfiguration();
    error InvalidUpdate();
    event Updated(uint64 indexed sequence, int256 value, uint64 observedAt, uint64 validUntil);

    constructor(bytes32 id, address signer_, int256 min_, int256 max_, uint64 age)
        EIP712("Programmable Custom AI Data", "1")
    {
        if (id == 0 || signer_ == address(0) || min_ > max_ || age == 0 || age > 1 days) revert InvalidConfiguration();
        feedId = id;
        signer = signer_;
        minimum = min_;
        maximum = max_;
        maxAge = age;
    }

    function digest(uint64 seq, int256 val, uint64 observed, uint64 expires) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(UPDATE_TYPEHASH, feedId, seq, val, observed, expires)));
    }

    function update(uint64 seq, int256 val, uint64 observed, uint64 expires, bytes calldata signature) external {
        if (
            seq <= sequence || val < minimum || val > maximum || observed > block.timestamp || observed < observedAt
                || block.timestamp - observed > maxAge || expires < block.timestamp || expires < observed
                || uint256(expires) > uint256(observed) + maxAge
                || ECDSA.recover(digest(seq, val, observed, expires), signature) != signer
        ) revert InvalidUpdate();
        sequence = seq;
        value = val;
        observedAt = observed;
        validUntil = expires;
        emit Updated(seq, val, observed, expires);
    }

    /// @notice Modules must drop data-dependent additional fees when fresh is false.
    function latest() external view returns (int256 val, bool fresh) {
        return (
            value,
            sequence != 0 && block.timestamp <= validUntil && block.timestamp >= observedAt
                && block.timestamp - observedAt <= maxAge
        );
    }
}
