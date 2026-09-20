// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FoundationHookV2 } from "./FoundationHookV2.sol";
import { FoundationTypesV1 as T } from "./FoundationTypesV1.sol";

/// @notice Dedicated CREATE2 deployer keeps hook creation code outside the launch factory's runtime.
contract FoundationHookDeployerV2 {
    function deploy(
        IPoolManager manager,
        address token,
        address quote,
        address creator,
        int24 tick,
        uint16 creatorBuyBps,
        uint16 creatorSellBps,
        T.ModuleSelection[] calldata modules,
        bytes32 salt
    ) external returns (FoundationHookV2) {
        return new FoundationHookV2{ salt: salt }(
            manager, msg.sender, token, quote, creator, tick, creatorBuyBps, creatorSellBps, modules
        );
    }

    function initCodeHash(
        IPoolManager manager,
        address initializer,
        address token,
        address quote,
        address creator,
        int24 tick,
        uint16 creatorBuyBps,
        uint16 creatorSellBps,
        T.ModuleSelection[] calldata modules
    ) external pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                type(FoundationHookV2).creationCode,
                abi.encode(manager, initializer, token, quote, creator, tick, creatorBuyBps, creatorSellBps, modules)
            )
        );
    }
}
