// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IV4Router } from "@uniswap/v4-periphery-v211/src/interfaces/IV4Router.sol";
import { Actions } from "@uniswap/v4-periphery-v211/src/libraries/Actions.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { FoundationFactoryV2, IFoundationUniversalRouterV2 } from "./FoundationFactoryV2.sol";
import { FoundationHookDeployerV1 } from "./FoundationHookDeployerV1.sol";
import { FoundationTypesV1 as T } from "./FoundationTypesV1.sol";
import { FoundationLaunchTypesV2 as L } from "./FoundationLaunchTypesV2.sol";

interface IFoundationWrappedEth {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @notice ETH funding, coin creation and initial buy are one reverting transaction.
/// @dev Retains V2 custody and creator identity. No wallet allowance or delegated account is required.
contract FoundationFactoryV2Native is FoundationFactoryV2 {
    bytes32 public constant NATIVE_FUNDING_ID = keccak256("programmable.module-foundation.native-funding.v1");
    // Constructor-only storage keeps the shared V2 runtime below EIP-170; no function can change this binding.
    address public wrappedEth;
    bytes32 public constant wrappedEthCodeHash = 0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353;

    constructor(
        IPoolManager manager,
        IPositionManager positions,
        IFoundationUniversalRouterV2 router,
        IAllowanceTransfer permits,
        FoundationHookDeployerV1 deployer,
        bytes32[5] memory expectedCodeHashes
    ) FoundationFactoryV2(manager, positions, router, permits, deployer, expectedCodeHashes) {
        wrappedEth = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
        if (wrappedEth.codehash != wrappedEthCodeHash) revert InvalidInfrastructure();
    }

    /// @param fundingPool Official v4 WETH/quote pool; the zero key is required for a WETH quote.
    /// @dev msg.value is the maximum ETH budget. Unspent ETH is refunded to the creator atomically.
    function launchWithEth(T.LaunchParams calldata p, PoolKey calldata fundingPool)
        external
        payable
        nonReentrant
        returns (L.LaunchResultV2 memory result)
    {
        if (wrappedEth.codehash != wrappedEthCodeHash || msg.value > uint128(type(int128).max)) {
            revert InvalidConfiguration();
        }
        uint256 nativeBefore = address(this).balance - msg.value;
        result = _launch(p, abi.encode(fundingPool));
        uint256 refund = address(this).balance - nativeBefore;
        if (refund != 0) {
            (bool sent,) = msg.sender.call{ value: refund }("");
            if (!sent) revert InvalidSettlement();
        }
        if (address(this).balance != nativeBefore) revert InvalidSettlement();
    }

    function _collectFunding(T.LaunchParams calldata p, uint256 funding, bytes memory data) internal override {
        if (data.length == 0) {
            super._collectFunding(p, funding, data);
            return;
        }
        PoolKey memory key = abi.decode(data, (PoolKey));
        if (p.quote == wrappedEth) {
            // keccak256 of the canonical ABI encoding of the all-zero PoolKey (160 zero bytes).
            if (
                msg.value < funding
                    || keccak256(data) != 0xdfded4ed5ac76ba7379cfe7b3b0f53e768dca8d45a34854e649cfc3c18cbd9cd
            ) revert InvalidConfiguration();
            IFoundationWrappedEth(wrappedEth).deposit{ value: funding }();
            return;
        }
        address a = Currency.unwrap(key.currency0);
        address b = Currency.unwrap(key.currency1);
        if (
            a >= b || !((a == wrappedEth && b == p.quote) || (a == p.quote && b == wrappedEth)) || msg.value == 0
                || funding > uint128(type(int128).max)
        ) revert InvalidConfiguration();
        uint256 wrappedBefore = IERC20(wrappedEth).balanceOf(address(this));
        IFoundationWrappedEth(wrappedEth).deposit{ value: msg.value }();
        _approve(wrappedEth, address(universalRouter), msg.value);
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactOutputSingleParams(key, a == wrappedEth, uint128(funding), uint128(msg.value), 0, bytes(""))
        );
        params[1] = abi.encode(Currency.wrap(wrappedEth), msg.value);
        params[2] = abi.encode(Currency.wrap(p.quote), funding);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(
            abi.encodePacked(uint8(Actions.SWAP_EXACT_OUT_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL)),
            params
        );
        universalRouter.execute(hex"10", inputs, p.deadline);
        _revoke(wrappedEth, address(universalRouter));
        uint256 unused = IERC20(wrappedEth).balanceOf(address(this)) - wrappedBefore;
        if (unused != 0) IFoundationWrappedEth(wrappedEth).withdraw(unused);
    }

    receive() external payable {
        if (msg.sender != wrappedEth) revert InvalidSettlement();
    }
}
