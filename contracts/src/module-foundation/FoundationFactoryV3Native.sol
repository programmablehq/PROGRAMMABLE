// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IV4Router } from "@uniswap/v4-periphery-v211/src/interfaces/IV4Router.sol";
import { Actions } from "@uniswap/v4-periphery-v211/src/libraries/Actions.sol";
import { PathKey } from "@uniswap/v4-periphery-v211/src/libraries/PathKey.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { FoundationFactoryV3 } from "./FoundationFactoryV3.sol";
import { IFoundationUniversalRouterV2 } from "./FoundationFactoryV2.sol";
import { FoundationHookDeployerV2 } from "./FoundationHookDeployerV2.sol";
import { FoundationLaunchTypesV3 as P } from "./FoundationLaunchTypesV3.sol";
import { FoundationLaunchTypesV2 as L } from "./FoundationLaunchTypesV2.sol";

import { IFoundationWrappedEth } from "./FoundationFactoryV2Native.sol";

/// @notice ETH funding, coin creation and initial buy are one reverting transaction.
/// @dev Retains V2 custody, directional creator fees and creator identity. No wallet allowance or delegated account is
/// required.
contract FoundationFactoryV3Native is FoundationFactoryV3 {
    // Constructor-only storage keeps the V3 runtime below EIP-170; no function can change this binding.
    bytes32 public NATIVE_FUNDING_ID = keccak256("programmable.module-foundation.native-funding.v2");
    address public wrappedEth;
    bytes32 public wrappedEthCodeHash = 0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353;

    constructor(
        IPoolManager manager,
        IPositionManager positions,
        IFoundationUniversalRouterV2 router,
        IAllowanceTransfer permits,
        FoundationHookDeployerV2 deployer,
        bytes32[5] memory expectedCodeHashes
    ) FoundationFactoryV3(manager, positions, router, permits, deployer, expectedCodeHashes) {
        wrappedEth = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
        if (wrappedEth.codehash != wrappedEthCodeHash) revert InvalidInfrastructure();
    }

    /// @param fundingPath ABI-encoded PathKey[] for official v4 exact-output swaps, in forward pool order.
    /// The first input is native ETH. An empty path is required when wrapping ETH directly to the WETH quote.
    /// @dev msg.value is the maximum ETH budget. Unspent ETH is refunded to the creator atomically.
    function launchWithEthRoute(P.LaunchParamsV3 calldata p, bytes calldata fundingPath)
        external
        payable
        nonReentrant
        returns (L.LaunchResultV2 memory result)
    {
        // PoolManager amounts must fit a positive int128.
        if (wrappedEth.codehash != wrappedEthCodeHash || msg.value >> 127 != 0 || fundingPath.length == 0) {
            revert InvalidConfiguration();
        }
        uint256 nativeBefore = address(this).balance - msg.value;
        result = _launch(p, fundingPath);
        uint256 refund = address(this).balance - nativeBefore;
        if (refund != 0) {
            (bool sent,) = msg.sender.call{ value: refund }("");
            if (!sent) revert InvalidSettlement();
        }
    }

    function _collectFunding(P.LaunchParamsV3 calldata p, uint256 funding, bytes memory data) internal override {
        if (data.length == 0) {
            super._collectFunding(p, funding, data);
            return;
        }
        PathKey[] memory path = abi.decode(data, (PathKey[]));
        if (p.quote == wrappedEth) {
            if (msg.value < funding || path.length != 0) revert InvalidConfiguration();
            IFoundationWrappedEth(wrappedEth).deposit{ value: funding }();
            return;
        }
        if (
            path.length > 4 || Currency.unwrap(path[0].intermediateCurrency) != address(0) || msg.value == 0
                || funding >> 127 != 0
        ) revert InvalidConfiguration();
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(
            IV4Router.ExactOutputParams(
                Currency.wrap(p.quote), path, new uint256[](0), uint128(funding), uint128(msg.value)
            )
        );
        // Settle the full transaction budget, then take only this unlock's excess credit.
        // This preserves pre-existing router ETH and needs neither a sweep nor a wallet approval.
        params[1] = abi.encode(Currency.wrap(address(0)), msg.value, false);
        params[2] = abi.encode(Currency.wrap(p.quote), funding);
        params[3] = abi.encode(Currency.wrap(address(0)), uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(
            abi.encodePacked(
                uint8(Actions.SWAP_EXACT_OUT), uint8(Actions.SETTLE), uint8(Actions.TAKE_ALL), uint8(Actions.TAKE_ALL)
            ),
            params
        );
        universalRouter.execute{ value: msg.value }(hex"10", inputs, p.deadline);
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert InvalidSettlement();
    }
}
