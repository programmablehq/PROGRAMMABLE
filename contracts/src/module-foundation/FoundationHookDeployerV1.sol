// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FoundationHookV1 } from "./FoundationHookV1.sol";
import { FoundationTypesV1 as T } from "./FoundationTypesV1.sol";

/// @notice Dedicated CREATE2 deployer keeps hook creation code outside the launch factory's runtime.
contract FoundationHookDeployerV1 {
    function deploy(
        IPoolManager manager,
        address token,
        address quote,
        address creator,
        int24 tick,
        uint16 creatorBps,
        T.ModuleSelection[] calldata modules,
        bytes32 salt
    ) external returns (FoundationHookV1) {
        return new FoundationHookV1{ salt: salt }(manager, msg.sender, token, quote, creator, tick, creatorBps, modules);
    }

    function initCodeHash(
        IPoolManager manager,
        address initializer,
        address token,
        address quote,
        address creator,
        int24 tick,
        uint16 creatorBps,
        T.ModuleSelection[] calldata modules
    ) external pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                type(FoundationHookV1).creationCode,
                abi.encode(manager, initializer, token, quote, creator, tick, creatorBps, modules)
            )
        );
    }
}
