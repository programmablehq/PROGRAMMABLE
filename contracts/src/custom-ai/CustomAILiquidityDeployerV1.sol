// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { CustomAILiquidityVaultV1 } from "./CustomAILiquidityVaultV1.sol";

/// @notice Separate creation code keeps the immutable factory within EIP-170's deployment limit.
contract CustomAILiquidityDeployerV1 {
    function deploy(IPoolManager manager, address token) external returns (CustomAILiquidityVaultV1) {
        return new CustomAILiquidityVaultV1(manager, msg.sender, token);
    }
}
