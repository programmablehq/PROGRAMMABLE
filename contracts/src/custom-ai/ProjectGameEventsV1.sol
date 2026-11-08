// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice A project-owned game issuer attests results. This contract holds no funds or platform keys.
/// @dev Player identity is authenticated by the game service. Both issuer and player approve the wallet link.
contract ProjectGameEventsV1 is EIP712 {
    struct GameEvent {
        bytes32 bindingId;
        bytes32 eventId;
        bytes32 playerIdHash;
        address player;
        uint64 sequence;
        uint256 score;
        uint64 observedAt;
        uint64 validUntil;
    }
    bytes32 public constant EVENT_TYPEHASH = keccak256(
        "GameEvent(bytes32 bindingId,bytes32 eventId,bytes32 playerIdHash,address player,uint64 sequence,uint256 score,uint64 observedAt,uint64 validUntil)"
    );
    bytes32 public constant WALLET_TYPEHASH = keccak256(
        "WalletLink(bytes32 bindingId,address player,bytes32 playerIdHash,bytes32 nonce,uint64 validUntil)"
    );
    bytes32 public immutable bindingId;
    address public immutable issuer;
    uint64 public immutable maxAge;
    uint256 public immutable maximumScore;
    mapping(bytes32 => address) public walletForPlayer;
    mapping(bytes32 => bool) public usedWalletNonce;
    mapping(bytes32 => bool) public consumed;
    mapping(bytes32 => uint64) public sequence;
    mapping(address => uint256) public playerScore;
    uint256 public totalScore;
    uint64 public observedAt;
    uint64 public validUntil;

    error InvalidConfiguration();
    error InvalidWallet();
    error InvalidEvent();
    event WalletBound(bytes32 indexed playerIdHash, address indexed player);
    event ResultAccepted(bytes32 indexed eventId, address indexed player, uint64 sequence, uint256 score);

    constructor(bytes32 binding, address signer, uint64 age, uint256 maximum)
        EIP712("Programmable Project Events", "1")
    {
        if (binding == 0 || signer == address(0) || age == 0 || age > 86_400 || maximum == 0 || maximum > 1e9) {
            revert InvalidConfiguration();
        }
        bindingId = binding;
        issuer = signer;
        maxAge = age;
        maximumScore = maximum;
    }

    function walletDigest(address player, bytes32 playerIdHash, bytes32 nonce, uint64 expires)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(WALLET_TYPEHASH, bindingId, player, playerIdHash, nonce, expires)));
    }

    function bindPlayer(
        address player,
        bytes32 playerIdHash,
        bytes32 nonce,
        uint64 expires,
        bytes calldata playerSignature,
        bytes calldata issuerSignature
    ) external {
        if (
            player == address(0) || playerIdHash == 0 || nonce == 0 || usedWalletNonce[nonce]
                || expires < block.timestamp || expires > block.timestamp + 600
                || walletForPlayer[playerIdHash] != address(0) && walletForPlayer[playerIdHash] != player
        ) {
            revert InvalidWallet();
        }
        bytes32 digest = walletDigest(player, playerIdHash, nonce, expires);
        if (!_signedBy(digest, playerSignature, player) || !_signedBy(digest, issuerSignature, issuer)) {
            revert InvalidWallet();
        }
        usedWalletNonce[nonce] = true;
        walletForPlayer[playerIdHash] = player;
        emit WalletBound(playerIdHash, player);
    }

    function eventDigest(GameEvent memory item) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    EVENT_TYPEHASH,
                    item.bindingId,
                    item.eventId,
                    item.playerIdHash,
                    item.player,
                    item.sequence,
                    item.score,
                    item.observedAt,
                    item.validUntil
                )
            )
        );
    }

    /// @dev Any relayer may carry an authorized result; it cannot change the player or repeat its effect.
    function submitEvent(GameEvent calldata item, bytes calldata signature) external {
        if (
            item.bindingId != bindingId || item.eventId == 0 || consumed[item.eventId] || item.player == address(0)
                || walletForPlayer[item.playerIdHash] != item.player || item.sequence == 0
                || item.sequence != uint256(sequence[item.playerIdHash]) + 1 || item.score > maximumScore
                || item.observedAt > block.timestamp || block.timestamp - item.observedAt > maxAge
                || item.validUntil < block.timestamp || uint256(item.validUntil) > uint256(item.observedAt) + maxAge
                || !_signedBy(eventDigest(item), signature, issuer)
        ) revert InvalidEvent();
        consumed[item.eventId] = true;
        sequence[item.playerIdHash] = item.sequence;
        playerScore[item.player] += item.score;
        totalScore += item.score;
        if (item.observedAt >= observedAt) {
            observedAt = item.observedAt;
            validUntil = item.validUntil;
        }
        emit ResultAccepted(item.eventId, item.player, item.sequence, item.score);
    }

    function latest() external view returns (uint256 score, bool fresh) {
        return (totalScore, observedAt != 0 && block.timestamp <= validUntil && block.timestamp - observedAt <= maxAge);
    }

    function _signedBy(bytes32 digest, bytes calldata signature, address signer) private pure returns (bool) {
        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(digest, signature);
        return error == ECDSA.RecoverError.NoError && recovered == signer;
    }
}
