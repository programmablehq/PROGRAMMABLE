// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "./FoundationTypesV1.sol";

/// @notice Explicit directional creator fees for new launches. The metadata and module ABI remain V1.
/// @dev Custody results remain FoundationLaunchTypesV2.LaunchResultV2. Existing launch ABIs are unchanged.
library FoundationLaunchTypesV3 {
    struct LaunchParamsV3 {
        T.Metadata metadata;
        address quote;
        uint8 quoteDecimals;
        int24 initialTick;
        uint16 creatorBuyFeeBps;
        uint16 creatorSellFeeBps;
        uint128 additionalQuoteAmount;
        uint128 initialBuyQuoteAmount;
        uint128 initialBuyMinimumTokenAmount;
        uint64 deadline;
        bytes32 tokenSalt;
        bytes32 hookSalt;
        T.ModuleSelection[] modules;
    }
}
