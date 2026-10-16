// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Initial fee module for the existing ClausReadonlyProject policy proxy.
/// @dev ClausApprovalExecutor controls the proxy configuration and implementation;
/// the token hook retains the immutable aggregate cap and fixed platform fee.
contract ClausBoundedFeePolicyV1 {
    error InvalidFeeConfiguration();

    function evaluate(bytes calldata configuration, bytes calldata input) external pure returns (bytes memory) {
        if (configuration.length != 64 || input.length != 32) revert InvalidFeeConfiguration();
        (uint24 buyCreatorPpm, uint24 sellCreatorPpm) = abi.decode(configuration, (uint24, uint24));
        if (buyCreatorPpm > 147_000 || sellCreatorPpm > 147_000) revert InvalidFeeConfiguration();
        return abi.encode(uint256(abi.decode(input, (bool)) ? buyCreatorPpm : sellCreatorPpm));
    }
}
