// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "./FoundationTypesV1.sol";

interface IFoundationModuleV1 {
    function context() external view returns (T.ModuleContext memory);
    function configurationHash() external view returns (bytes32);
    function descriptor() external view returns (T.Descriptor memory);
    function onBeforeSwap(T.SwapContext calldata context_) external returns (bytes4);
    function onAfterSwap(T.SwapContext calldata context_) external returns (bytes4);
    function onAction(address actor, bytes calldata data) external returns (bytes4);
}

interface IFoundationModuleFactoryV1 {
    function createModule(T.ModuleContext calldata context_, bytes calldata configuration)
        external
        returns (address module);
}
