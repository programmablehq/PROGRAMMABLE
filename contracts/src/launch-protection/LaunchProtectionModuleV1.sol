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

/// @notice Immutable opening buy fee for the sealed Native30 kernel's dynamic-LP-fee module interface.
/// @dev Candidate parameters: 99% total at time zero, linear decay to normal fees after thirty seconds.
/// The fixed platform fee is never waived. The initializer locks all LP principal and fees permanently.
contract LaunchProtectionModuleV1 {
    uint256 public constant OPENING_TOTAL_PPM = 990_000;
    uint256 public constant DECAY_SECONDS = 30;
    uint256 private constant PPM = 1_000_000;
    uint24 private constant OVERRIDE_FEE_FLAG = 0x400000;
    uint24 private constant DYNAMIC_FEE_FLAG = 0x800000;

    address public immutable kernel;
    ProtectedLaunchTokenV1 public immutable token;
    address public immutable developer;
    address public immutable router;
    bytes32 public immutable routerCodeHash;
    uint256 public immutable normalBuyFeePpm;
    address[3] private _exemptWallets;

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
        address[3] memory exemptWallets_
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
        for (uint256 i; i < 3; ++i) {
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

    function exemptWallets() external view returns (address[3] memory) {
        return _exemptWallets;
    }

    function isTaxExempt(address wallet) public view returns (bool) {
        return wallet == developer
            || (wallet != address(0)
                && (wallet == _exemptWallets[0] || wallet == _exemptWallets[1] || wallet == _exemptWallets[2]));
    }

    function additionalLpFeePpm(address buyer) public view returns (uint24) {
        uint256 start = token.startedAt();
        if (start == 0 || block.timestamp >= start + DECAY_SECONDS || isTaxExempt(buyer)) return 0;
        uint256 opening = Math.mulDiv(OPENING_TOTAL_PPM, start + DECAY_SECONDS - block.timestamp, DECAY_SECONDS);
        if (opening <= normalBuyFeePpm) return 0;
        // The hook fee is taken first. This LP fee applies only to the remaining native input.
        return uint24(Math.mulDiv(opening - normalBuyFeePpm, PPM, PPM - normalBuyFeePpm));
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        view
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (msg.sender != kernel) revert OnlyKernel();
        if (
            address(key.hooks) != kernel || Currency.unwrap(key.currency0) != address(0)
                || Currency.unwrap(key.currency1) != address(token) || key.fee != DYNAMIC_FEE_FLAG
        ) revert InvalidPool();
        uint24 fee;
        uint256 start = token.startedAt();
        if (params.zeroForOne && start != 0 && block.timestamp < start + DECAY_SECONDS) {
            address buyer;
            if (sender == token.initializer()) {
                buyer = developer;
            } else {
                if (sender != router || sender.codehash != routerCodeHash) revert UnsupportedRouter();
                buyer = ILaunchProtectionRouterV1(sender).msgSender();
                if (buyer == address(0) || buyer == router || buyer == kernel || buyer == token.poolManager()) {
                    revert InvalidBuyer();
                }
            }
            fee = additionalLpFeePpm(buyer);
        }
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | OVERRIDE_FEE_FLAG);
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
