// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { FoundationTypesV1 as T } from "./FoundationTypesV1.sol";

interface IFoundationActionContextV1 {
    function isModuleAction(address module) external view returns (bool);
}

/// @notice One launch, one quote, separately accounted platform/creator/module claims backed by Core ERC6909.
/// @dev No platform recipient setter, sweep, approval, generic call or module authority over platform credits exists.
contract FoundationLedgerV1 is ReentrancyGuardTransient, IUnlockCallback {
    IPoolManager public immutable poolManager;
    address public immutable hook;
    address public immutable quote;
    address public immutable creator;
    uint256 public platformReceived;
    uint256 public platformClaimed;
    uint256 public creatorReceived;
    uint256 public creatorCredited;
    uint256 public creatorClaimed;
    uint256 public moduleClaimedTotal;
    uint16 public creatorShareBps;
    mapping(address => uint16) public moduleShareBps;
    mapping(address => uint256) public moduleCredited;
    mapping(address => uint256) public moduleClaimed;
    address[] private _modules;
    bool private _configured;
    bytes32 private _claimContext;

    error Unauthorized();
    error InvalidConfiguration();
    error InsufficientBacking();
    error InvalidTransfer();
    error NoClaim();

    event FeesAccrued(uint256 platform, uint256 creator, uint256 platformReceived, uint256 creatorReceived);
    event QuoteClaimed(address indexed beneficiary, uint8 indexed budget, uint256 amount);

    constructor(IPoolManager manager, address quote_, address creator_) {
        if (address(manager).code.length == 0 || quote_.code.length == 0 || creator_ == address(0)) {
            revert InvalidConfiguration();
        }
        poolManager = manager;
        hook = msg.sender;
        quote = quote_;
        creator = creator_;
    }

    function configure(address[] memory modules, uint16[] memory shares) external {
        if (msg.sender != hook || _configured || modules.length > T.MAX_MODULES || modules.length != shares.length) {
            revert Unauthorized();
        }
        _configured = true;
        uint256 sum;
        for (uint256 i; i < modules.length; ++i) {
            if (modules[i] == address(0)) revert InvalidConfiguration();
            for (uint256 j; j < i; ++j) {
                if (modules[i] == modules[j]) revert InvalidConfiguration();
            }
            sum += shares[i];
            moduleShareBps[modules[i]] = shares[i];
            _modules.push(modules[i]);
        }
        if (sum > 10_000) revert InvalidConfiguration();
        creatorShareBps = uint16(10_000 - sum);
    }

    function accrue(uint256 platform, uint256 creatorFee) external {
        if (msg.sender != hook || !_configured) revert Unauthorized();
        platformReceived += platform;
        creatorReceived += creatorFee;
        creatorCredited = FullMath.mulDiv(creatorReceived, creatorShareBps, 10_000);
        for (uint256 i; i < _modules.length; ++i) {
            address module = _modules[i];
            moduleCredited[module] = FullMath.mulDiv(creatorReceived, moduleShareBps[module], 10_000);
        }
        _assertBacking();
        emit FeesAccrued(platform, creatorFee, platformReceived, creatorReceived);
    }

    function claimPlatform() external nonReentrant returns (uint256 amount) {
        amount = _bounded(platformReceived - platformClaimed);
        platformClaimed += amount;
        _pay(T.PLATFORM_RECIPIENT, amount);
        emit QuoteClaimed(T.PLATFORM_RECIPIENT, 0, amount);
    }

    function claimCreator() external nonReentrant returns (uint256 amount) {
        amount = _bounded(creatorCredited - creatorClaimed);
        creatorClaimed += amount;
        _pay(creator, amount);
        emit QuoteClaimed(creator, 1, amount);
    }

    /// @notice An active module action may withdraw only that instance's separately credited quote budget to itself.
    function claimModule(uint256 amount) external nonReentrant {
        if (
            !IFoundationActionContextV1(hook).isModuleAction(msg.sender)
                || amount > moduleCredited[msg.sender] - moduleClaimed[msg.sender] || amount == 0
                || amount > uint256(uint128(type(int128).max))
        ) revert Unauthorized();
        moduleClaimed[msg.sender] += amount;
        moduleClaimedTotal += amount;
        _pay(msg.sender, amount);
        emit QuoteClaimed(msg.sender, 2, amount);
    }

    function outstandingBacking() public view returns (uint256) {
        return platformReceived + creatorReceived - platformClaimed - creatorClaimed - moduleClaimedTotal;
    }

    function unallocatedCreatorDust() external view returns (uint256 dust) {
        dust = creatorReceived - creatorCredited;
        for (uint256 i; i < _modules.length; ++i) {
            dust -= moduleCredited[_modules[i]];
        }
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (
            msg.sender != address(poolManager) || !_reentrancyGuardEntered() || _claimContext == 0
                || keccak256(data) != _claimContext
        ) revert Unauthorized();
        _claimContext = 0;
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
        // Updated counters must still be backed by the pre-burn balance plus this withdrawal.
        if (poolManager.balanceOf(address(this), uint256(uint160(quote))) < outstandingBacking() + amount) {
            revert InsufficientBacking();
        }
        bytes memory data = abi.encode(recipient, amount);
        _claimContext = keccak256(data);
        poolManager.unlock(data);
        if (_claimContext != 0) revert Unauthorized();
        _assertBacking();
    }

    function _assertBacking() private view {
        if (poolManager.balanceOf(address(this), uint256(uint160(quote))) < outstandingBacking()) {
            revert InsufficientBacking();
        }
    }

    function _bounded(uint256 amount) private pure returns (uint256) {
        if (amount == 0) revert NoClaim();
        uint256 limit = uint256(uint128(type(int128).max));
        return amount > limit ? limit : amount;
    }
}
