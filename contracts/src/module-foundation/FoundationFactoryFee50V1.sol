// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { FoundationFactoryV3Native } from "./FoundationFactoryV3Native.sol";
import { FoundationHookDeployerV3 } from "./FoundationHookDeployerV3.sol";
import { IFoundationUniversalRouterV2 } from "./FoundationFactoryV2.sol";
import { FoundationHookDeployerV2 } from "./FoundationHookDeployerV2.sol";

/// @notice Robinhood native funding binding. The public constructor and launch ABI are unchanged.
contract FoundationFactoryFee50V1 is FoundationFactoryV3Native {
    uint16 public constant PLATFORM_FEE_BPS = 50;

    constructor(
        IPoolManager manager,
        IPositionManager positions,
        IFoundationUniversalRouterV2 router,
        IAllowanceTransfer permits,
        FoundationHookDeployerV2 deployer,
        bytes32[5] memory expectedCodeHashes
    ) FoundationFactoryV3Native(manager, positions, router, permits, deployer, expectedCodeHashes) {
        if (FoundationHookDeployerV3(address(deployer)).PLATFORM_FEE_BPS() != PLATFORM_FEE_BPS) {
            revert InvalidInfrastructure();
        }
    }
}
