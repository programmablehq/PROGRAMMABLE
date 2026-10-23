// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
import { CustomAIFactoryV1 } from "./CustomAIFactoryV1.sol";
import { CustomAIHookV1 } from "./CustomAIHookV1.sol";
import { CustomAIRewardVaultV1 } from "./CustomAIRewardVaultV1.sol";
import { CustomAISwapRouterV1 } from "./CustomAISwapRouterV1.sol";
import { CustomAITransfersV1 as X } from "./CustomAITransfersV1.sol";
import { ICustomAIRewardModuleV1 } from "./ICustomAIRewardModuleV1.sol";

/// @notice Immutable funded distributions, staking rewards or bounded buybacks for one launch.
/// @dev Receives only the reward share fixed in that launch's vault. No owner, mint, arbitrary call or principal rescue.
contract CustomAIProgramV1 is ICustomAIRewardModuleV1, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    enum Mode { Distribution, Staking, Buyback }
    struct Configuration {
        CustomAIFactoryV1 factory;
        address creator;
        bytes32 launchSalt;
        address quote;
        uint8 quoteDecimals;
        Mode mode;
        address recipient;
        uint64 interval;
        uint128 maximumBatch;
        uint256 minimumTokensPerQuote;
    }

    CustomAIFactoryV1 public immutable factory;
    bytes32 public immutable factoryCodeHash;
    address public immutable creator;
    bytes32 public immutable launchSalt;
    IERC20 public immutable quote;
    bytes32 public immutable quoteCodeHash;
    Mode public immutable mode;
    address public immutable recipient;
    uint64 public immutable interval;
    uint128 public immutable maximumBatch;
    uint256 public immutable minimumTokensPerQuote;
    uint256 public immutable quoteUnit;
    bytes32 public immutable configurationHash;
    uint256 public nextExecution;
    uint256 public totalStaked;
    uint256 public rewardPerToken;
    uint256 public accountedRewards;
    address public stakingToken;
    mapping(address => uint256) public staked;
    mapping(address => uint256) public rewardPerTokenPaid;
    mapping(address => uint256) public earned;
    uint256 private constant SCALE = 1e27;

    error InvalidConfiguration();
    error NotReady();
    error InvalidAmount();
    event Distributed(address indexed recipient, uint256 amount);
    event Staked(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event RewardPaid(address indexed account, uint256 amount);
    event BoughtBack(address indexed recipient, uint256 paid, uint256 received);

    constructor(Configuration memory c) {
        if (address(c.factory).code.length == 0 || c.creator == address(0) || c.quote.code.length == 0
            || c.quoteDecimals > 36 || c.interval < 60 || c.interval > 365 days
            || (c.mode != Mode.Staking && (c.recipient == address(0) || c.recipient == address(this)))
            || (c.mode == Mode.Staking && c.recipient != address(0))
            || (c.mode == Mode.Buyback && (c.maximumBatch == 0 || c.maximumBatch > T.MAX_AMOUNT || c.minimumTokensPerQuote == 0))
            || (c.mode != Mode.Buyback && (c.maximumBatch != 0 || c.minimumTokensPerQuote != 0))) revert InvalidConfiguration();
        factory = c.factory; factoryCodeHash = address(c.factory).codehash;
        creator = c.creator; launchSalt = c.launchSalt; quote = IERC20(c.quote); quoteCodeHash = c.quote.codehash;
        mode = c.mode; recipient = c.recipient; interval = c.interval; maximumBatch = c.maximumBatch;
        minimumTokensPerQuote = c.minimumTokensPerQuote; quoteUnit = 10 ** c.quoteDecimals;
        configurationHash = keccak256(abi.encode(T.VERSION_ID, "funded-program-v1", c, factoryCodeHash, quoteCodeHash));
    }

    function actionId() public view returns (bytes32) {
        return keccak256(abi.encode(configurationHash, block.timestamp / interval));
    }

    function quoteReward(bytes32 action, address vault, address asset, uint256 available)
        external view returns (bytes4, address, uint256, uint64, bytes32)
    {
        T.LaunchResult memory r = _launch();
        bool valid = r.token != address(0) && r.rewardVault == vault && asset == address(quote) && action == actionId();
        return (this.quoteReward.selector, address(this), valid ? available : 0, type(uint64).max, configurationHash);
    }

    /// @notice Anyone may move already-earned rewards to the immutable program.
    function collect() external nonReentrant { _collect(); }

    function distribute() external nonReentrant returns (uint256 amount) {
        if (mode != Mode.Distribution || block.timestamp < nextExecution) revert NotReady();
        _collect();
        amount = quote.balanceOf(address(this));
        if (amount == 0) revert InvalidAmount();
        nextExecution = block.timestamp + interval;
        X.push(quote, recipient, amount);
        emit Distributed(recipient, amount);
    }

    function stake(uint256 amount) external nonReentrant {
        if (mode != Mode.Staking || amount == 0) revert InvalidAmount();
        T.LaunchResult memory r = _launch();
        if (r.token == address(0)) revert NotReady();
        stakingToken = r.token;
        _accrue(msg.sender);
        X.pull(IERC20(r.token), msg.sender, address(this), amount);
        staked[msg.sender] += amount; totalStaked += amount;
        emit Staked(msg.sender, amount);
    }

    /// @notice Principal withdrawal never invokes the reward vault, a feed, a keeper or the swap router.
    function withdraw(uint256 amount) external nonReentrant {
        if (mode != Mode.Staking || amount == 0 || amount > staked[msg.sender]) revert InvalidAmount();
        _accrueRecorded(msg.sender);
        staked[msg.sender] -= amount; totalStaked -= amount;
        X.push(IERC20(stakingToken), msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claim() external nonReentrant returns (uint256 amount) {
        if (mode != Mode.Staking) revert NotReady();
        _accrue(msg.sender);
        amount = earned[msg.sender];
        if (amount == 0) revert InvalidAmount();
        earned[msg.sender] = 0; accountedRewards -= amount;
        X.push(quote, msg.sender, amount);
        emit RewardPaid(msg.sender, amount);
    }

    function buyback() external nonReentrant returns (uint256 paid, uint256 received) {
        if (mode != Mode.Buyback || block.timestamp < nextExecution) revert NotReady();
        T.LaunchResult memory r = _launch();
        _collect();
        uint256 amount = Math.min(quote.balanceOf(address(this)), maximumBatch);
        uint256 minimum = Math.mulDiv(amount, minimumTokensPerQuote, quoteUnit, Math.Rounding.Ceil);
        if (amount == 0 || minimum == 0) revert InvalidAmount();
        nextExecution = block.timestamp + interval;
        CustomAISwapRouterV1 router = factory.router();
        bool zeroForOne = address(quote) < r.token;
        quote.forceApprove(address(router), amount);
        (paid, received) = router.swap(CustomAIHookV1(r.hook).poolKey(), SwapParams({
            zeroForOne: zeroForOne, amountSpecified: -int256(amount),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        }), minimum, T.MAX_TOTAL_BPS, recipient, uint64(block.timestamp));
        quote.forceApprove(address(router), 0);
        emit BoughtBack(recipient, paid, received);
    }

    function _launch() private view returns (T.LaunchResult memory r) {
        if (address(factory).codehash != factoryCodeHash || address(quote).codehash != quoteCodeHash) revert InvalidConfiguration();
        r = factory.launchOf(creator, launchSalt);
    }

    function _collect() private {
        T.LaunchResult memory r = _launch();
        if (r.rewardVault == address(0)) revert NotReady();
        CustomAIRewardVaultV1 vault = CustomAIRewardVaultV1(r.rewardVault);
        vault.allocate(actionId());
        if (vault.claimable(address(this)) != 0) vault.claimReward(address(this));
        if (mode == Mode.Staking) _syncRewards();
    }

    function _syncRewards() private {
        uint256 balance = quote.balanceOf(address(this));
        if (balance < accountedRewards) revert InvalidAmount();
        if (totalStaked == 0) return;
        uint256 delta = Math.mulDiv(balance - accountedRewards, SCALE, totalStaked);
        if (delta == 0) return;
        rewardPerToken += delta;
        // Account the whole deposit; fractional dust stays reserved and cannot be promised twice.
        accountedRewards = balance;
    }

    function _accrue(address account) private {
        _syncRewards();
        _accrueRecorded(account);
    }

    function _accrueRecorded(address account) private {
        // Round the earned interval once, rather than subtracting separately
        // rounded totals that could award a new staker an old fractional reward.
        earned[account] += Math.mulDiv(staked[account], rewardPerToken - rewardPerTokenPaid[account], SCALE);
        rewardPerTokenPaid[account] = rewardPerToken;
    }
}
