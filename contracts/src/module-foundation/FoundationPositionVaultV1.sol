// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice Permanent custody of this one canonical launch NFT and unused fixed-supply rounding inventory.
/// @dev Only a zero-liquidity decrease for LP fees exists. No principal removal, NFT transfer/approval,
/// generic execution, signature validator, delegation, administrator or upgrade path exists.
contract FoundationPositionVaultV1 is ReentrancyGuardTransient {
    IPositionManager public immutable positionManager;
    bytes32 public immutable positionManagerCodeHash;
    address public immutable beneficiary;
    uint256 public immutable positionId;
    PoolKey private _key;

    error InvalidConfiguration();
    event PositionFeesCollected(uint256 indexed positionId, address indexed beneficiary);

    constructor(IPositionManager manager, uint256 id, address recipient, PoolKey memory key) {
        if (address(manager).code.length == 0 || id == 0 || recipient == address(0)) revert InvalidConfiguration();
        positionManager = manager;
        positionManagerCodeHash = address(manager).codehash;
        positionId = id;
        beneficiary = recipient;
        _key = key;
    }

    function collectFees(uint256 deadline) external nonReentrant {
        if (address(positionManager).codehash != positionManagerCodeHash) revert InvalidConfiguration();
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(positionId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(_key.currency0, _key.currency1, beneficiary);
        positionManager.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR)), params), deadline
        );
        emit PositionFeesCollected(positionId, beneficiary);
    }
}
