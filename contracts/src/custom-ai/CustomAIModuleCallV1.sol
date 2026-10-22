// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
import { ICustomAIFeeModuleV1 } from "./ICustomAIFeeModuleV1.sol";

/// @notice Bounded, read-only fee evaluation. No module state changes survive because none are permitted.
library CustomAIModuleCallV1 {
    uint256 internal constant MODULE_GAS = 100_000;
    uint256 internal constant CALLER_RESERVE = 50_000;

    enum Status {
        Applied,
        NoModule,
        CodeChanged,
        CallFailed,
        InvalidResponse,
        Expired,
        ConfigurationChanged,
        FeeCapExceeded
    }

    error InsufficientEvaluationGas();

    function evaluate(T.ModuleBinding memory binding, T.SwapContext memory context)
        internal
        view
        returns (uint16 additionalBps, Status status)
    {
        if (binding.instance == address(0)) return (0, Status.NoModule);
        address instance = binding.instance;
        if (instance.code.length == 0 || instance.codehash != binding.runtimeHash) return (0, Status.CodeChanged);
        bytes memory input = abi.encodeCall(ICustomAIFeeModuleV1.quoteFee, (context));
        uint256[4] memory output;
        bool success;
        uint256 size;
        // Reserve enough for EIP-150 and response handling. Insufficient caller gas must not silently lower fees.
        if (gasleft() < MODULE_GAS + MODULE_GAS / 63 + CALLER_RESERVE) revert InsufficientEvaluationGas();
        assembly ("memory-safe") {
            success := staticcall(MODULE_GAS, instance, add(input, 32), mload(input), output, 128)
            size := returndatasize()
        }
        if (!success) return (0, Status.CallFailed);
        // Inspect words before narrowing instead of abi.decode, which could revert on malicious ABI padding.
        if (
            size != 128 || output[0] != uint256(bytes32(ICustomAIFeeModuleV1.quoteFee.selector))
                || output[1] > type(uint16).max || output[2] > type(uint64).max
        ) return (0, Status.InvalidResponse);
        if (bytes32(output[3]) != binding.configurationHash) return (0, Status.ConfigurationChanged);
        if (output[2] < block.timestamp) return (0, Status.Expired);
        if (output[1] > T.MAX_ADDITIONAL_BPS) return (0, Status.FeeCapExceeded);
        return (uint16(output[1]), Status.Applied);
    }
}
