// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
import { CustomAIHookV1 } from "./CustomAIHookV1.sol";

/// @notice Isolates hook creation code; the calling factory is always the initialization authority.
contract CustomAIHookDeployerV1 {
    uint160 public constant FLAGS = 8396;

    function deploy(
        IPoolManager manager,
        address token,
        address quote,
        int24 tick,
        T.ModuleBinding calldata module,
        T.Rewards calldata rewards,
        bytes32 salt
    ) external returns (CustomAIHookV1) {
        return new CustomAIHookV1{ salt: salt }(manager, msg.sender, token, quote, tick, module, rewards);
    }

    function initCodeHash(
        IPoolManager manager,
        address factory,
        address token,
        address quote,
        int24 tick,
        T.ModuleBinding calldata module,
        T.Rewards calldata rewards
    ) external pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                type(CustomAIHookV1).creationCode, abi.encode(manager, factory, token, quote, tick, module, rewards)
            )
        );
    }

    function predict(bytes32 hash, bytes32 salt) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, hash)))));
    }
}
