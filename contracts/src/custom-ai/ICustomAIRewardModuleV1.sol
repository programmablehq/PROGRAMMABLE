// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ICustomAIRewardModuleV1 {
    /// @notice A proposal can spend only the vault's unallocated reward budget, once per actionId.
    /// @dev The module must bind external evidence to this vault, chain and action. No stateful callback occurs.
    function quoteReward(bytes32 actionId, address vault, address asset, uint256 available)
        external
        view
        returns (bytes4 selector, address beneficiary, uint256 amount, uint64 validUntil, bytes32 configurationHash);
}
