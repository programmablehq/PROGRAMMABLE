// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";

/// @notice Version-owned Robinhood native-fee custody. Only accrued fees are claimable, to fixed recipients.
/// @dev The kernel funds native ERC-6909 claims before recording either ledger. There are no allowances,
///      operators, principal withdrawals, destination overrides, owner setters, or arbitrary calls.
contract RobinhoodNativeFeeVaultV1 is IUnlockCallback {
    address public constant PLATFORM_RECIPIENT = 0xD88539d3c4C460136a733A3Fd60cf6BF269079da;
    IPoolManager public immutable poolManager;
    address public immutable kernel;
    address public immutable creatorRecipient;
    uint256 public platformAccrued;
    uint256 public creatorAccrued;
    bool private claimActive;
    bytes32 private activeClaim;

    error UnauthorizedKernel();
    error InvalidClaim();
    error InsufficientFeeBacking();
    error ReentrantClaim();
    error NothingToClaim();

    event FeesRecorded(uint256 platformAmount, uint256 creatorAmount);
    event FeesClaimed(address indexed recipient, uint256 amount, bool platform);

    constructor(IPoolManager manager, address creator) {
        if (address(manager) == address(0) || creator == address(0)) revert InvalidClaim();
        poolManager = manager;
        kernel = msg.sender;
        creatorRecipient = creator;
    }

    function recordFees(uint256 platformAmount, uint256 creatorAmount) external {
        if (msg.sender != kernel) revert UnauthorizedKernel();
        if (claimActive) revert ReentrantClaim();
        platformAccrued += platformAmount;
        creatorAccrued += creatorAmount;
        if (poolManager.balanceOf(address(this), 0) < platformAccrued + creatorAccrued) {
            revert InsufficientFeeBacking();
        }
        emit FeesRecorded(platformAmount, creatorAmount);
    }

    /// @notice Anybody may pay claim gas; the entire transfer always goes to the immutable Treasury.
    function claimPlatform() external returns (uint256 amount) {
        amount = platformAccrued;
        _claim(PLATFORM_RECIPIENT, amount, true);
    }

    /// @notice Anybody may pay claim gas; creator fees never share the Treasury ledger.
    function claimCreator() external returns (uint256 amount) {
        amount = creatorAccrued;
        _claim(creatorRecipient, amount, false);
    }

    function _claim(address recipient, uint256 amount, bool platform) private {
        if (claimActive) revert ReentrantClaim();
        if (amount == 0) revert NothingToClaim();
        claimActive = true;
        activeClaim = keccak256(abi.encode(recipient, amount));
        if (platform) platformAccrued = 0;
        else creatorAccrued = 0;
        bytes memory result = poolManager.unlock(abi.encode(recipient, amount));
        if (result.length != 0 || activeClaim != bytes32(0)) revert InvalidClaim();
        claimActive = false;
        emit FeesClaimed(recipient, amount, platform);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (
            msg.sender != address(poolManager) || !claimActive || activeClaim == bytes32(0)
                || keccak256(data) != activeClaim
        ) revert InvalidClaim();
        (address recipient, uint256 amount) = abi.decode(data, (address, uint256));
        activeClaim = bytes32(0);
        poolManager.burn(address(this), 0, amount);
        poolManager.take(Currency.wrap(address(0)), recipient, amount);
        return "";
    }
}
