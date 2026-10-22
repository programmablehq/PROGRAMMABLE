// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
import { CustomAIFeeMathV1 as F } from "./CustomAIFeeMathV1.sol";

/// @notice Per-launch fee claims backed by v4 ERC6909 balances, with permanently fixed destinations.
/// @dev The deploying settlement hook alone may accrue. No approve, sweep, generic call or recipient setter exists.
contract CustomAIFeeLedgerV1 is ReentrancyGuardTransient, IUnlockCallback {
    IPoolManager public immutable poolManager;
    bytes32 public immutable poolManagerCodeHash;
    address public immutable hook;
    address public immutable quote;
    bytes32 public immutable quoteCodeHash;
    address public immutable additionalRecipient;
    address public constant PLATFORM_RECIPIENT = T.PLATFORM_RECIPIENT;
    uint256 public platformReceived;
    uint256 public platformClaimed;
    uint256 public additionalReceived;
    uint256 public additionalClaimed;
    bytes32 private _claimContext;

    error InvalidConfiguration();
    error Unauthorized();
    error InsufficientBacking();
    error InvalidTransfer();
    error NothingToClaim();

    event FeesAccrued(uint256 grossQuote, uint256 platform, uint256 additional);
    event FeesClaimed(address indexed recipient, bool indexed platform, uint256 amount);

    constructor(IPoolManager manager, address quote_, address additionalRecipient_) {
        if (
            address(manager).code.length == 0 || quote_.code.length == 0 || additionalRecipient_ == address(0)
                || additionalRecipient_ == address(this) || additionalRecipient_ == address(manager)
        ) revert InvalidConfiguration();
        poolManager = manager;
        poolManagerCodeHash = address(manager).codehash;
        hook = msg.sender;
        quote = quote_;
        quoteCodeHash = quote_.codehash;
        additionalRecipient = additionalRecipient_;
    }

    /// @dev Called only after the hook mints the matching fee claims into this ledger.
    function accrue(uint256 grossQuote, uint16 additionalBps) external {
        if (msg.sender != hook || _reentrancyGuardEntered()) revert Unauthorized();
        F.Fees memory fees = F.fromGross(grossQuote, additionalBps);
        platformReceived += fees.platform;
        additionalReceived += fees.additional;
        _assertBacking();
        emit FeesAccrued(grossQuote, fees.platform, fees.additional);
    }

    function outstandingBacking() public view returns (uint256) {
        return platformReceived + additionalReceived - platformClaimed - additionalClaimed;
    }

    /// @notice Anyone may trigger payment; the destination cannot be supplied by the caller.
    function claimPlatform() external nonReentrant returns (uint256 amount) {
        amount = _bounded(platformReceived - platformClaimed);
        platformClaimed += amount;
        _pay(PLATFORM_RECIPIENT, amount);
        emit FeesClaimed(PLATFORM_RECIPIENT, true, amount);
    }

    function claimAdditional() external nonReentrant returns (uint256 amount) {
        amount = _bounded(additionalReceived - additionalClaimed);
        additionalClaimed += amount;
        _pay(additionalRecipient, amount);
        emit FeesClaimed(additionalRecipient, false, amount);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (
            msg.sender != address(poolManager) || !_reentrancyGuardEntered() || _claimContext == bytes32(0)
                || keccak256(data) != _claimContext
        ) revert Unauthorized();
        _claimContext = bytes32(0);
        (address recipient, uint256 amount) = abi.decode(data, (address, uint256));
        IERC20 asset = IERC20(quote);
        uint256 recipientBefore = asset.balanceOf(recipient);
        uint256 managerBefore = asset.balanceOf(address(poolManager));
        poolManager.burn(address(this), uint256(uint160(quote)), amount);
        poolManager.take(Currency.wrap(quote), recipient, amount);
        if (
            asset.balanceOf(recipient) != recipientBefore + amount
                || asset.balanceOf(address(poolManager)) != managerBefore - amount
        ) revert InvalidTransfer();
        return bytes("");
    }

    function _pay(address recipient, uint256 amount) private {
        _verifyInfrastructure();
        if (poolManager.balanceOf(address(this), uint256(uint160(quote))) < outstandingBacking() + amount) {
            revert InsufficientBacking();
        }
        bytes memory data = abi.encode(recipient, amount);
        _claimContext = keccak256(data);
        poolManager.unlock(data);
        if (_claimContext != bytes32(0)) revert Unauthorized();
        _assertBacking();
    }

    function _assertBacking() private view {
        _verifyInfrastructure();
        if (poolManager.balanceOf(address(this), uint256(uint160(quote))) < outstandingBacking()) {
            revert InsufficientBacking();
        }
    }

    function _verifyInfrastructure() private view {
        if (address(poolManager).codehash != poolManagerCodeHash || quote.codehash != quoteCodeHash) {
            revert InvalidConfiguration();
        }
    }

    function _bounded(uint256 amount) private pure returns (uint256) {
        if (amount == 0) revert NothingToClaim();
        return amount > T.MAX_AMOUNT ? T.MAX_AMOUNT : amount;
    }
}
