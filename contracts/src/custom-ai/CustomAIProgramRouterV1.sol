// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
import { CustomAIFactoryV1 } from "./CustomAIFactoryV1.sol";
import { CustomAIRewardVaultV1 } from "./CustomAIRewardVaultV1.sol";
import { CustomAITransfersV1 as X } from "./CustomAITransfersV1.sol";
import { ICustomAIRewardModuleV1 } from "./ICustomAIRewardModuleV1.sol";

interface ICustomAIProgramRecipients {
    function recipientOf(address router, bytes32 actionId) external view returns (address);
}

/// @notice Isolated cumulative allocations of this launch's earned reward share only.
contract CustomAIProgramRouterV1 is ICustomAIRewardModuleV1, ReentrancyGuardTransient {
    struct Destination {
        bytes32 id;
        address recipient;
        uint16 weight;
    }
    CustomAIFactoryV1 public immutable factory;
    bytes32 public immutable factoryCodeHash;
    address public immutable creator;
    bytes32 public immutable launchSalt;
    IERC20 public immutable quote;
    bytes32 public immutable quoteCodeHash;
    uint256 public immutable totalWeight;
    bytes32 public immutable configurationHash;
    address public immutable recipientRegistry;
    bytes32 public immutable registryCodeHash;
    Destination[] public destinations;
    uint256 public totalCollected;
    mapping(bytes32 => uint256) public allocated;
    mapping(bytes32 => uint256) public claimed;
    error InvalidConfiguration();
    error NotReady();

    constructor(
        CustomAIFactoryV1 f,
        address owner,
        bytes32 salt,
        address asset,
        Destination[] memory targets,
        address registry
    ) {
        if (
            address(f).code.length == 0 || owner == address(0) || asset.code.length == 0 || targets.length == 0
                || targets.length > 4
        ) revert InvalidConfiguration();
        uint256 weight;
        for (uint256 i; i < targets.length; i++) {
            if (
                targets[i].id == 0 || (targets[i].recipient == address(0) && registry == address(0))
                    || targets[i].weight == 0
            ) revert InvalidConfiguration();
            for (uint256 j; j < i; j++) {
                if (targets[j].id == targets[i].id) revert InvalidConfiguration();
            }
            destinations.push(targets[i]);
            weight += targets[i].weight;
        }
        if (weight > 10_000) revert InvalidConfiguration();
        if (registry != address(0) && registry.code.length == 0) revert InvalidConfiguration();
        recipientRegistry = registry;
        registryCodeHash = registry.codehash;
        factory = f;
        factoryCodeHash = address(f).codehash;
        creator = owner;
        launchSalt = salt;
        quote = IERC20(asset);
        quoteCodeHash = asset.codehash;
        totalWeight = weight;
        configurationHash =
            keccak256(abi.encode(T.VERSION_ID, "program-router-v1", f, owner, salt, asset, targets, registry));
    }

    function _launch() private view returns (T.LaunchResult memory r) {
        if (address(factory).codehash != factoryCodeHash || address(quote).codehash != quoteCodeHash) {
            revert InvalidConfiguration();
        }
        r = factory.launchOf(creator, launchSalt);
        if (r.rewardVault == address(0)) revert NotReady();
    }

    function batchId() public view returns (bytes32) {
        T.LaunchResult memory r = _launch();
        return keccak256(abi.encode(configurationHash, CustomAIRewardVaultV1(r.rewardVault).totalReceived()));
    }

    function quoteReward(bytes32 action, address vault, address asset, uint256 available)
        external
        view
        returns (bytes4, address, uint256, uint64, bytes32)
    {
        T.LaunchResult memory r = _launch();
        bool valid = vault == r.rewardVault && asset == address(quote) && action == batchId();
        return (this.quoteReward.selector, address(this), valid ? available : 0, type(uint64).max, configurationHash);
    }

    function collectAndAllocate() public nonReentrant {
        T.LaunchResult memory r = _launch();
        CustomAIRewardVaultV1 vault = CustomAIRewardVaultV1(r.rewardVault);
        vault.sync();
        vault.allocate(batchId());
        uint256 beforeBalance = quote.balanceOf(address(this));
        if (vault.claimable(address(this)) > 0) vault.claimReward(address(this));
        uint256 received = quote.balanceOf(address(this)) - beforeBalance;
        totalCollected += received;
        // Each target rounds against the cumulative funded total. Dust remains
        // held here instead of being assigned to whichever target runs first.
        for (uint256 i; i < destinations.length; i++) {
            Destination memory target = destinations[i];
            allocated[target.id] = Math.mulDiv(totalCollected, target.weight, totalWeight);
        }
    }

    function claimFor(bytes32 id) external nonReentrant returns (uint256 amount) {
        for (uint256 i; i < destinations.length; i++) {
            if (destinations[i].id == id) {
                amount = allocated[id] - claimed[id];
                if (amount == 0) return 0;
                address recipient = destinations[i].recipient;
                if (recipient == address(0)) {
                    if (recipientRegistry.codehash != registryCodeHash) revert InvalidConfiguration();
                    recipient = ICustomAIProgramRecipients(recipientRegistry).recipientOf(address(this), id);
                }
                if (recipient == address(0) || recipient == address(this)) revert InvalidConfiguration();
                claimed[id] += amount;
                X.push(quote, recipient, amount);
                return amount;
            }
        }
        revert InvalidConfiguration();
    }
}
