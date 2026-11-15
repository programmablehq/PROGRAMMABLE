// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IProgrammablePlatformFeeRouterV1 } from "./IProgrammablePlatformFeeRouterV1.sol";

/// @notice Pushes newly earned platform fees during the originating swap.
/// @dev A failed bounded payout preserves fully backed claims for a permissionless retry.
///      Creator fees stay in their independent, fixed-recipient ledger.
contract AutomaticNativeFeeVaultV1 is IUnlockCallback {
    address public constant TEAM_WALLET = 0x9F5856A3578Faba96A6E8Dfd9C10563A1E598f62;
    bytes32 public constant POLICY_ID = keccak256("programmable.automatic-platform-fees.v1");
    uint256 public constant AUTOMATIC_PAYOUT_GAS = 200_000;

    IPoolManager public immutable poolManager;
    address public immutable kernel;
    address public immutable creatorRecipient;
    address public immutable PLATFORM_RECIPIENT;
    bytes32 public immutable platformRouterCodeHash;
    uint256 public platformAccrued;
    uint256 public creatorAccrued;
    uint256 public totalPlatformRecorded;
    uint256 public totalPlatformPaid;
    bool private claimActive;
    bytes32 private activeClaim;

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidClaim();
    error InsufficientFeeBacking();
    error ReentrantClaim();
    error NothingToClaim();
    error InsufficientForwardGas();
    event FeesRecorded(uint256 platformAmount, uint256 creatorAmount);
    event FeesClaimed(address indexed recipient, uint256 amount, bool platform);
    event AutomaticPayoutDeferred(uint256 pendingAmount);

    constructor(IPoolManager manager, address creator, address router, bytes32 routerCodeHash) {
        address expectedManager = block.chainid == 1
            ? 0x000000000004444c5dc75cB358380D2e3dE08A90
            : block.chainid == 4663 ? 0x8366a39CC670B4001A1121B8F6A443A643e40951 : address(0);
        if (
            expectedManager == address(0) || address(manager) != expectedManager || expectedManager.code.length == 0
                || creator == address(0)
        ) revert InvalidConfiguration();
        if (block.chainid == 1) {
            if (router != address(0) || routerCodeHash != bytes32(0)) revert InvalidConfiguration();
            PLATFORM_RECIPIENT = TEAM_WALLET;
        } else {
            if (
                router == address(0) || routerCodeHash == bytes32(0) || router.code.length == 0
                    || router.codehash != routerCodeHash
            ) revert InvalidConfiguration();
            IProgrammablePlatformFeeRouterV1 policy = IProgrammablePlatformFeeRouterV1(router);
            if (
                policy.TEAM_WALLET() != TEAM_WALLET || policy.SUPPORTED_CHAIN_ID() != 4663
                    || policy.BUYBACK_SHARE_BPS() != 8000 || policy.POLICY_ID() != POLICY_ID
            ) revert InvalidConfiguration();
            PLATFORM_RECIPIENT = router;
        }
        poolManager = manager;
        kernel = msg.sender;
        creatorRecipient = creator;
        platformRouterCodeHash = routerCodeHash;
    }

    function recordFees(uint256 platformAmount, uint256 creatorAmount) external {
        if (msg.sender != kernel) revert Unauthorized();
        if (claimActive) revert ReentrantClaim();
        platformAccrued += platformAmount;
        creatorAccrued += creatorAmount;
        totalPlatformRecorded += platformAmount;
        _requireBacking();
        emit FeesRecorded(platformAmount, creatorAmount);
        if (platformAccrued != 0) {
            // A cheap successful estimate must not intentionally starve the automatic payout.
            if (gasleft() <= AUTOMATIC_PAYOUT_GAS + 60_000) revert InsufficientForwardGas();
            // The originating hook already unlocked the manager. A new unlock here would fail.
            // The self-call rolls back burns and transfers together if the recipient cannot receive.
            try this.forwardWhileUnlocked{ gas: AUTOMATIC_PAYOUT_GAS }() { }
            catch {
                emit AutomaticPayoutDeferred(platformAccrued);
            }
        }
    }

    function forwardWhileUnlocked() external {
        if (msg.sender != address(this)) revert Unauthorized();
        if (claimActive) revert ReentrantClaim();
        claimActive = true;
        uint256 amount = platformAccrued;
        if (amount == 0) revert NothingToClaim();
        _requireRouter();
        platformAccrued = 0;
        totalPlatformPaid += amount;
        poolManager.burn(address(this), 0, amount);
        poolManager.take(Currency.wrap(address(0)), PLATFORM_RECIPIENT, amount);
        claimActive = false;
        _requireBacking();
        emit FeesClaimed(PLATFORM_RECIPIENT, amount, true);
    }

    /// @notice Retry only; normal swaps already attempt the platform payout.
    function claimPlatform() external returns (uint256 amount) {
        amount = platformAccrued;
        _requireRouter();
        _claim(PLATFORM_RECIPIENT, amount, true);
    }

    function claimCreator() external returns (uint256 amount) {
        amount = creatorAccrued;
        _claim(creatorRecipient, amount, false);
    }

    function _claim(address recipient, uint256 amount, bool platform) private {
        if (claimActive) revert ReentrantClaim();
        if (amount == 0) revert NothingToClaim();
        claimActive = true;
        bytes memory data = abi.encode(recipient, amount);
        activeClaim = keccak256(data);
        if (platform) {
            platformAccrued = 0;
            totalPlatformPaid += amount;
        } else {
            creatorAccrued = 0;
        }
        bytes memory result = poolManager.unlock(data);
        if (result.length != 0 || activeClaim != bytes32(0)) revert InvalidClaim();
        claimActive = false;
        _requireBacking();
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

    function _requireRouter() private view {
        if (platformRouterCodeHash != bytes32(0) && PLATFORM_RECIPIENT.codehash != platformRouterCodeHash) {
            revert InvalidConfiguration();
        }
    }

    function _requireBacking() private view {
        if (poolManager.balanceOf(address(this), 0) < platformAccrued + creatorAccrued) {
            revert InsufficientFeeBacking();
        }
    }
}
