// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IProgrammablePlatformFeeRouterV1 {
    function TEAM_WALLET() external view returns (address);
    function BUYBACK_SHARE_BPS() external view returns (uint16);
    function SUPPORTED_CHAIN_ID() external view returns (uint256);
    function POLICY_ID() external view returns (bytes32);
}
