// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";

/// @notice Read-only fee proposal. The core owns custody, settlement and all fee limits.
interface ICustomAIFeeModuleV1 {
    /// @dev selector must equal quoteFee.selector. validUntil is an inclusive expiry timestamp.
    /// configurationHash commits the launch-bound rules, not the changing input data.
    function quoteFee(T.SwapContext calldata context)
        external
        view
        returns (bytes4 selector, uint16 additionalBps, uint64 validUntil, bytes32 configurationHash);
}
