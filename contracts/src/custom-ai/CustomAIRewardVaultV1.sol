// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { CustomAITransfersV1 as X } from "./CustomAITransfersV1.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
import { ICustomAIRewardModuleV1 } from "./ICustomAIRewardModuleV1.sol";

/// @notice Isolated, funded creator/reward balances. No module has custody, allowance or execution authority.
contract CustomAIRewardVaultV1 is ReentrancyGuardTransient {
    uint256 public constant MODULE_GAS = 100_000;
    address public immutable quote;
    bytes32 public immutable quoteCodeHash;
    address public immutable creatorRecipient;
    uint16 public immutable creatorShareBps;
    address public immutable rewardModule;
    bytes32 public immutable moduleCodeHash;
    bytes32 public immutable configurationHash;
    uint256 public totalReceived;
    uint256 public creatorReceived;
    uint256 public creatorClaimed;
    uint256 public availableRewards;
    uint256 public reservedRewards;
    mapping(bytes32 => bool) public allocated;
    mapping(address => uint256) public claimable;

    error InvalidConfiguration();
    error Insolvent();
    error NothingToClaim();
    error InsufficientEvaluationGas();

    event Funded(uint256 amount, uint256 creatorAmount, uint256 rewardAmount);
    event RewardAllocated(bytes32 indexed actionId, address indexed beneficiary, uint256 amount);
    event Claimed(address indexed beneficiary, bool creator, uint256 amount);

    constructor(address quote_, T.Rewards memory r) {
        if (
            quote_.code.length == 0 || r.creatorRecipient == address(0) || r.creatorRecipient == address(this)
                || r.creatorShareBps > T.BPS
        ) revert InvalidConfiguration();
        if (r.module.instance == address(0)) {
            if (r.creatorShareBps != T.BPS || r.module.runtimeHash != 0 || r.module.configurationHash != 0) {
                revert InvalidConfiguration();
            }
        } else if (r.module.instance.code.length == 0 || r.module.instance.codehash != r.module.runtimeHash) {
            revert InvalidConfiguration();
        }
        quote = quote_;
        quoteCodeHash = quote_.codehash;
        creatorRecipient = r.creatorRecipient;
        creatorShareBps = r.creatorShareBps;
        rewardModule = r.module.instance;
        moduleCodeHash = r.module.runtimeHash;
        configurationHash = r.module.configurationHash;
    }

    function accountedBalance() public view returns (uint256) {
        return creatorReceived - creatorClaimed + availableRewards + reservedRewards;
    }

    function sync() external nonReentrant {
        _sync();
    }

    /// @notice Permissionless proposal evaluation; failure leaves funds available and never affects trading.
    function allocate(bytes32 actionId) external nonReentrant returns (bool) {
        _sync();
        address module = rewardModule;
        if (
            actionId == 0 || allocated[actionId] || module == address(0) || module.codehash != moduleCodeHash
                || availableRewards == 0
        ) return false;
        bytes memory input =
            abi.encodeCall(ICustomAIRewardModuleV1.quoteReward, (actionId, address(this), quote, availableRewards));
        uint256[5] memory output;
        bool ok;
        uint256 size;
        if (gasleft() < MODULE_GAS + MODULE_GAS / 63 + 75_000) revert InsufficientEvaluationGas();
        assembly ("memory-safe") {
            ok := staticcall(MODULE_GAS, module, add(input, 32), mload(input), output, 160)
            size := returndatasize()
        }
        if (
            !ok || size != 160 || output[0] != uint256(bytes32(ICustomAIRewardModuleV1.quoteReward.selector))
                || output[1] == 0 || output[1] > type(uint160).max || address(uint160(output[1])) == address(this)
                || output[2] == 0 || output[2] > availableRewards || output[3] > type(uint64).max
                || output[3] < block.timestamp || bytes32(output[4]) != configurationHash
        ) return false;
        address beneficiary = address(uint160(output[1]));
        allocated[actionId] = true;
        availableRewards -= output[2];
        reservedRewards += output[2];
        claimable[beneficiary] += output[2];
        emit RewardAllocated(actionId, beneficiary, output[2]);
        return true;
    }

    function claimCreator() external nonReentrant returns (uint256 amount) {
        _sync();
        amount = creatorReceived - creatorClaimed;
        if (amount == 0) revert NothingToClaim();
        creatorClaimed += amount;
        X.push(IERC20(quote), creatorRecipient, amount);
        emit Claimed(creatorRecipient, true, amount);
    }

    /// @notice Anyone can deliver an earned reward, but can never change its destination.
    function claimReward(address beneficiary) external nonReentrant returns (uint256 amount) {
        _sync();
        amount = claimable[beneficiary];
        if (amount == 0) revert NothingToClaim();
        claimable[beneficiary] = 0;
        reservedRewards -= amount;
        X.push(IERC20(quote), beneficiary, amount);
        emit Claimed(beneficiary, false, amount);
    }

    function _sync() private {
        if (quote.codehash != quoteCodeHash) revert InvalidConfiguration();
        uint256 balance = IERC20(quote).balanceOf(address(this));
        uint256 accounted = accountedBalance();
        if (balance < accounted) revert Insolvent();
        uint256 incoming = balance - accounted;
        if (incoming == 0) return;
        // Split cumulatively so repeated tiny syncs cannot divert the creator's rounding share.
        totalReceived += incoming;
        uint256 creatorTotal =
            totalReceived / T.BPS * creatorShareBps + (totalReceived % T.BPS) * creatorShareBps / T.BPS;
        uint256 creatorAdded = creatorTotal - creatorReceived;
        creatorReceived = creatorTotal;
        availableRewards += incoming - creatorAdded;
        emit Funded(incoming, creatorAdded, incoming - creatorAdded);
    }
}
