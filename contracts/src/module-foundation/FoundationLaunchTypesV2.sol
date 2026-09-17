// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice V2 factory results. Launch inputs and the module ABI remain FoundationTypesV1.
/// @dev Principal fields are actual amounts paid at launch, not current withdrawable amounts.
library FoundationLaunchTypesV2 {
    struct LaunchResultV2 {
        address token;
        address hook;
        address ledger;
        bytes32 poolId;
        address basePositionOwner;
        address creatorPositionOwner;
        address roundingInventoryRecipient;
        uint256 basePositionId;
        uint256 creatorPositionId;
        uint256 initialBuyTokenAmount;
        uint128 baseTokenPrincipal;
        uint128 baseTokenRounding;
        uint128 creatorQuotePrincipal;
        uint256 actualQuoteRefund;
    }
}
