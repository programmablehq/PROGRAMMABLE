// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";

import { EthFirstMoverFeeHookV1 } from "./EthFirstMoverFeeHookV1.sol";
import { FeeSplitVaultFactoryV1 } from "./FeeSplitVaultFactoryV1.sol";

/// @title EthFirstMoverFeeHookFactoryV1
/// @notice Deterministically deploys the First Mover fee hook at a valid v4 hook address.
/// @dev Mirrors `EthCreatorFeeHookFactoryV3` and `EthLadderFeeHookFactoryV1` exactly. The required flags are
///      identical to both, since the ticker registry is observation inside the same `beforeSwap`/`afterSwap`
///      callbacks Classic already uses, not a new hook point.
contract EthFirstMoverFeeHookFactoryV1 {
    uint160 public constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    mapping(address hook => bytes32 configurationHash) public configurationHashOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error HookAlreadyDeployed(address hook);
    error InvalidHookAddress(address hook, uint160 actualFlags, uint160 requiredFlags);

    event EthFirstMoverFeeHookDeployed(
        address indexed hook,
        address indexed poolManager,
        address indexed builderFeeRecipient,
        address feeSplitVaultFactory,
        bytes32 salt,
        bytes32 configurationHash
    );

    function deploy(
        bytes32 salt,
        IPoolManager poolManager,
        address builderFeeRecipient,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory
    ) external returns (EthFirstMoverFeeHookV1 hook) {
        bytes memory code = initCode(poolManager, builderFeeRecipient, feeSplitVaultFactory);
        address predicted = Create2.computeAddress(salt, keccak256(code));
        uint160 actualFlags = uint160(predicted) & ALL_HOOK_MASK;
        if (actualFlags != REQUIRED_HOOK_FLAGS) {
            revert InvalidHookAddress(predicted, actualFlags, REQUIRED_HOOK_FLAGS);
        }
        if (predicted.code.length != 0) revert HookAlreadyDeployed(predicted);

        address deployed = Create2.deploy(0, salt, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        hook = EthFirstMoverFeeHookV1(deployed);

        bytes32 configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                deployed,
                address(poolManager),
                builderFeeRecipient,
                address(feeSplitVaultFactory)
            )
        );
        configurationHashOf[deployed] = configurationHash;
        emit EthFirstMoverFeeHookDeployed(
            deployed, address(poolManager), builderFeeRecipient, address(feeSplitVaultFactory), salt, configurationHash
        );
    }

    function predict(
        bytes32 salt,
        IPoolManager poolManager,
        address builderFeeRecipient,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory
    ) external view returns (address) {
        return Create2.computeAddress(salt, initCodeHash(poolManager, builderFeeRecipient, feeSplitVaultFactory));
    }

    function initCode(
        IPoolManager poolManager,
        address builderFeeRecipient,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory
    ) public pure returns (bytes memory) {
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(EthFirstMoverFeeHookV1).creationCode,
            abi.encode(poolManager, builderFeeRecipient, feeSplitVaultFactory)
        );
    }

    function initCodeHash(
        IPoolManager poolManager,
        address builderFeeRecipient,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory
    ) public pure returns (bytes32) {
        return keccak256(initCode(poolManager, builderFeeRecipient, feeSplitVaultFactory));
    }

    function isFactoryHook(address hook) external view returns (bool) {
        return configurationHashOf[hook] != bytes32(0);
    }
}
