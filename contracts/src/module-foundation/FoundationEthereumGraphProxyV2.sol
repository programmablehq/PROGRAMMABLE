// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Proxy } from "@openzeppelin/contracts/proxy/Proxy.sol";

interface IFoundationStampedGraphInitializerV2 {
    function GRAPH_FACTORY() external view returns (address);
    function initializeStampedGraphWallet(address launchWallet, bytes32 routeNonce) external;
}

/// @notice Immutable launch account whose constructor proves the canonical Router's CREATE2 salt.
contract FoundationEthereumGraphProxyV2 is Proxy {
    address public immutable implementation;
    bytes32 public immutable implementationCodeHash;

    error InvalidImplementation();

    constructor(address target, bytes32 expectedCodeHash, address launchWallet, bytes32 routeNonce) {
        if (
            target.code.length == 0 || target.codehash != expectedCodeHash
                || msg.sender != IFoundationStampedGraphInitializerV2(target).GRAPH_FACTORY()
        ) revert InvalidImplementation();
        implementation = target;
        implementationCodeHash = expectedCodeHash;
        (bool success, bytes memory result) = target.delegatecall(
            abi.encodeCall(
                IFoundationStampedGraphInitializerV2.initializeStampedGraphWallet, (launchWallet, routeNonce)
            )
        );
        if (!success) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
    }

    function _implementation() internal view override returns (address) {
        return implementation;
    }

    receive() external payable {
        _fallback();
    }
}
