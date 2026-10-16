// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { BeforeSwapDelta, BeforeSwapDeltaLibrary } from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ProtectedLaunchTokenV1 } from "./ProtectedLaunchTokenV1.sol";

interface ILaunchProtectionRouterV1 {
    function msgSender() external view returns (address);
}

/// @notice Immutable opening-tax policy for the sealed launch kernel.
/// @dev Total buy fee starts at 99% and falls linearly to normal fees over thirty seconds.
/// The kernel separately accounts for opening taxes payable only to the fixed platform treasury.
contract LaunchProtectionModuleV1 {
    uint256 public constant OPENING_TOTAL_PPM = 990_000;
    uint256 public constant DECAY_SECONDS = 30;

    address public immutable kernel;
    ProtectedLaunchTokenV1 public immutable token;
    address public immutable developer;
    address public immutable router;
    bytes32 public immutable routerCodeHash;
    uint256 public immutable normalBuyFeePpm;
    address[6] private _exemptWallets;

    error InvalidConfiguration();
    error OnlyKernel();
    error InvalidPool();
    error UnsupportedRouter();
    error InvalidBuyer();

    constructor(
        address kernel_,
        ProtectedLaunchTokenV1 token_,
        address developer_,
        address router_,
        bytes32 routerCodeHash_,
        uint16 creatorBuyFeeBps_,
        address[6] memory exemptWallets_
    ) {
        address canonicalRouter = block.chainid == 1
            ? 0xd92A36B0000531EF3063dEd4De20A0783308446C
            : 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
        if (
            kernel_ == address(0) || address(token_).code.length == 0 || developer_ == address(0)
                || developer_ == address(token_) || developer_ == token_.poolManager() || router_.code.length == 0
                || (block.chainid != 1 && block.chainid != 4663) || router_ != canonicalRouter
                || router_.codehash != routerCodeHash_ || creatorBuyFeeBps_ > 1000
        ) revert InvalidConfiguration();
        for (uint256 i; i < exemptWallets_.length; ++i) {
            address wallet = exemptWallets_[i];
            if (wallet == address(0)) continue;
            if (
                wallet == developer_ || wallet == kernel_ || wallet == address(token_) || wallet == token_.poolManager()
                    || wallet == router_ || wallet == token_.initializer()
            ) {
                revert InvalidConfiguration();
            }
            for (uint256 j; j < i; ++j) {
                if (wallet == exemptWallets_[j]) revert InvalidConfiguration();
            }
        }
        kernel = kernel_;
        token = token_;
        developer = developer_;
        router = router_;
        routerCodeHash = routerCodeHash_;
        normalBuyFeePpm = (30 + uint256(creatorBuyFeeBps_)) * 100;
        _exemptWallets = exemptWallets_;
    }

    function exemptWallets() external view returns (address[6] memory) {
        return _exemptWallets;
    }

    function isTaxExempt(address wallet) public view returns (bool) {
        if (wallet == address(0)) return false;
        if (wallet == developer) return true;
        for (uint256 i; i < _exemptWallets.length; ++i) {
            if (wallet == _exemptWallets[i]) return true;
        }
        return false;
    }

    function additionalTaxPpmForBuyer(address buyer) public view returns (uint24) {
        uint256 start = token.startedAt();
        if (start == 0 || block.timestamp >= start + DECAY_SECONDS || isTaxExempt(buyer)) return 0;
        return uint24(
            Math.mulDiv(OPENING_TOTAL_PPM - normalBuyFeePpm, start + DECAY_SECONDS - block.timestamp, DECAY_SECONDS)
        );
    }

    function openingTaxPpmForSender(address sender) external view returns (uint24) {
        if (msg.sender != kernel) revert OnlyKernel();
        uint256 start = token.startedAt();
        if (start == 0 || block.timestamp >= start + DECAY_SECONDS) return 0;
        return additionalTaxPpmForBuyer(_buyer(sender));
    }

    function protectedBuyer(address sender) external view returns (address) {
        if (msg.sender != kernel) revert OnlyKernel();
        return _buyer(sender);
    }

    function _buyer(address sender) private view returns (address buyer) {
        if (sender == token.initializer()) {
            buyer = developer;
        } else {
            if (sender != router || sender.codehash != routerCodeHash) revert UnsupportedRouter();
            buyer = ILaunchProtectionRouterV1(sender).msgSender();
            if (buyer == address(0) || buyer == router || buyer == kernel || buyer == token.poolManager()) {
                revert InvalidBuyer();
            }
        }
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external
        view
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (msg.sender != kernel) revert OnlyKernel();
        if (
            address(key.hooks) != kernel || Currency.unwrap(key.currency0) != address(0)
                || Currency.unwrap(key.currency1) != address(token) || key.fee != 0
        ) revert InvalidPool();
        // Buyer authentication and the current tax are read by the kernel and bound to its active swap.
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        view
        returns (bytes4, int128)
    {
        if (msg.sender != kernel) revert OnlyKernel();
        return (this.afterSwap.selector, 0);
    }
}
