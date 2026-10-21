// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { PositionPlanner } from "@uniswap/liquidity-launcher/src/libraries/PositionPlanner.sol";
import {
    CurrencyAmounts,
    Plan,
    Position,
    PositionDefinition
} from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { PlatformFeeHookV1 } from "./PlatformFeeHookV1.sol";
import { ProgrammableCanaryTokenV1 } from "./ProgrammableCanaryTokenV1.sol";

/// @title ProgrammableCanaryLiquidityInitializerV1
/// @notice One-shot Graph target that opens the reviewed canary pool and mints its owner-controlled full-range LP NFT.
/// @dev The Graph factory is an explicit immutable caller, never inferred from constructor `msg.sender`. The
/// initializer reuses the official PositionPlanner/PositionManager action path already exercised by
/// DirectLiquidityLauncherV1.
///      The PositionManager receives the exact token/native budgets, mints the NFT directly to `lpRecipient`, and its
///      TAKE_PAIR actions send every unused token/native unit directly to `launchWallet`. This contract retains
/// nothing. Any native balance prefunded to the predicted CREATE2 address is refunded only to the same immutable
/// `launchWallet` after LP creation; refund failure or a nonzero post-refund balance reverts the complete Graph.
contract ProgrammableCanaryLiquidityInitializerV1 is ReentrancyGuardTransient {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    uint256 public constant TOKEN_LIQUIDITY_BUDGET = 1_000_000 ether;
    uint256 public constant NATIVE_LIQUIDITY_BUDGET = 0.001 ether;
    int24 public constant INITIAL_TICK = 207_240;
    uint24 public constant LP_FEE_PIPS = 3000;
    int24 public constant TICK_SPACING = 60;
    uint24 public constant PLATFORM_FEE_PIPS = 1000;
    address public constant PLATFORM_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    uint160 public constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 public constant REQUIRED_HOOK_FLAGS =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);

    bytes32 private constant FIELD_ALLOCATION = keccak256("allocation");
    bytes32 private constant FIELD_CODE = keccak256("code");
    bytes32 private constant FIELD_CURRENCIES = keccak256("currencies");
    bytes32 private constant FIELD_FEE_RECIPIENT = keccak256("fee-recipient");
    bytes32 private constant FIELD_FEES = keccak256("fees");
    bytes32 private constant FIELD_INITIALIZER = keccak256("initializer");
    bytes32 private constant FIELD_PERMISSIONS = keccak256("permissions");
    bytes32 private constant FIELD_POOL_ID = keccak256("pool-id");
    bytes32 private constant FIELD_POOL_MANAGER = keccak256("pool-manager");
    bytes32 private constant FIELD_SUPPLY = keccak256("supply");
    bytes32 private constant FIELD_WALLET = keccak256("wallet");

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    address public immutable graphFactory;
    address public immutable launchWallet;
    address public immutable lpRecipient;
    bytes32 public immutable configurationHash;

    bool public initialized;
    address public token;
    address public hook;
    bytes32 public poolId;
    uint256 public positionTokenId;
    uint256 public nativeLiquidityAmount;
    uint256 public tokenLiquidityAmount;

    error AlreadyInitialized();
    error DeadlineExpired(uint256 timestamp, uint256 deadline);
    error DependencyPoolManagerMismatch(address expected, address actual);
    error InvalidDependency(address dependency);
    error InvalidHook(address hook, bytes32 field);
    error InvalidInitialTick(int24 expected, int24 actual);
    error InvalidPosition(uint256 count, uint256 nativeAmount, uint256 tokenAmount);
    error InvalidPositionOwner(address expected, address actual);
    error InvalidRemainder(uint256 nativeAmount, uint256 tokenAmount);
    error InvalidToken(address token, bytes32 field);
    error InvalidValue(uint256 expected, uint256 actual);
    error PositionManagerBalanceNotEmpty(uint256 nativeBalance, uint256 tokenBalance);
    error ResidualCustody(uint256 nativeBalance, uint256 tokenBalance);
    error UnauthorizedInitializer(address caller, address expected);
    error ZeroAddress();

    event ProgrammableCanaryLiquidityInitializedV1(
        address indexed launchWallet,
        address indexed token,
        address indexed hook,
        bytes32 poolId,
        address lpRecipient,
        uint256 positionTokenId,
        uint256 nativeLiquidityAmount,
        uint256 tokenLiquidityAmount,
        uint256 nativeLiquidityBudget,
        uint256 tokenLiquidityBudget,
        int24 initialTick
    );

    constructor(
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        address graphFactory_,
        address launchWallet_,
        address lpRecipient_
    ) {
        if (graphFactory_ == address(0) || launchWallet_ == address(0) || lpRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        if (address(poolManager_).code.length == 0) revert InvalidDependency(address(poolManager_));
        if (address(positionManager_).code.length == 0) revert InvalidDependency(address(positionManager_));
        if (graphFactory_.code.length == 0) revert InvalidDependency(graphFactory_);

        address positionManagerPoolManager = address(positionManager_.poolManager());
        if (positionManagerPoolManager != address(poolManager_)) {
            revert DependencyPoolManagerMismatch(address(poolManager_), positionManagerPoolManager);
        }

        poolManager = poolManager_;
        positionManager = positionManager_;
        graphFactory = graphFactory_;
        launchWallet = launchWallet_;
        lpRecipient = lpRecipient_;
        bytes32 dependencyHash = keccak256(
            abi.encode(
                address(poolManager_),
                address(positionManager_),
                graphFactory_,
                launchWallet_,
                lpRecipient_,
                PLATFORM_FEE_RECIPIENT
            )
        );
        bytes32 economicsHash = keccak256(
            abi.encode(
                TOKEN_LIQUIDITY_BUDGET,
                NATIVE_LIQUIDITY_BUDGET,
                INITIAL_TICK,
                LP_FEE_PIPS,
                TICK_SPACING,
                PLATFORM_FEE_PIPS,
                REQUIRED_HOOK_FLAGS
            )
        );
        configurationHash = keccak256(abi.encode(block.chainid, address(this), dependencyHash, economicsHash));
    }

    /// @notice Initializes exactly one reviewed canary token/hook pair and mints its full-range LP NFT atomically.
    /// @param token_ Exact Graph-deployed fixed-supply token.
    /// @param hook_ Exact Graph-deployed 10 bps PlatformFeeHookV1.
    /// @param deadline PositionManager deadline, also committed inside the Graph target initializer calldata.
    function initialize(ProgrammableCanaryTokenV1 token_, PlatformFeeHookV1 hook_, uint256 deadline)
        external
        payable
        nonReentrant
    {
        if (msg.sender != graphFactory) revert UnauthorizedInitializer(msg.sender, graphFactory);
        if (initialized) revert AlreadyInitialized();
        if (msg.value != NATIVE_LIQUIDITY_BUDGET) {
            revert InvalidValue(NATIVE_LIQUIDITY_BUDGET, msg.value);
        }
        // The deadline is committed in the Graph payload; timestamp slack can only expire, never broaden, that permit.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlineExpired(block.timestamp, deadline);

        _validateToken(token_);
        PoolKey memory key = _validateHook(token_, hook_);
        _requireEmptyPositionManagerTokenBalance(token_);

        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(INITIAL_TICK);
        (Plan memory plan, Position memory position) = _buildFullRangePlan(key, initialSqrtPriceX96);
        uint256 nextPositionTokenId = positionManager.nextTokenId();

        // Effects precede the PoolManager/PositionManager interactions. Every downstream failure reverts atomically.
        initialized = true;
        token = address(token_);
        hook = address(hook_);
        poolId = PoolId.unwrap(key.toId());
        positionTokenId = nextPositionTokenId;
        nativeLiquidityAmount = position.amount0;
        tokenLiquidityAmount = position.amount1;

        int24 actualTick = poolManager.initialize(key, initialSqrtPriceX96);
        if (actualTick != INITIAL_TICK) revert InvalidInitialTick(INITIAL_TICK, actualTick);

        IERC20(address(token_)).safeTransfer(address(positionManager), TOKEN_LIQUIDITY_BUDGET);
        positionManager.modifyLiquidities{ value: NATIVE_LIQUIDITY_BUDGET }(
            abi.encode(plan.actions, plan.params), deadline
        );

        address actualOwner = IERC721(address(positionManager)).ownerOf(positionTokenId);
        if (actualOwner != lpRecipient) revert InvalidPositionOwner(lpRecipient, actualOwner);

        _requireEmptyPositionManagerBalance(token_);
        uint256 nativeResidual = address(this).balance;
        if (nativeResidual != 0) Address.sendValue(payable(launchWallet), nativeResidual);
        uint256 tokenBalance = IERC20(address(token_)).balanceOf(address(this));
        if (address(this).balance != 0 || tokenBalance != 0) {
            revert ResidualCustody(address(this).balance, tokenBalance);
        }

        _emitInitialized(token_, hook_);
    }

    function reviewedPoolKey(address token_, address hook_) public pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token_),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: PlatformFeeHookV1(hook_)
        });
    }

    function _emitInitialized(ProgrammableCanaryTokenV1 token_, PlatformFeeHookV1 hook_) private {
        emit ProgrammableCanaryLiquidityInitializedV1(
            launchWallet,
            address(token_),
            address(hook_),
            poolId,
            lpRecipient,
            positionTokenId,
            nativeLiquidityAmount,
            tokenLiquidityAmount,
            NATIVE_LIQUIDITY_BUDGET,
            TOKEN_LIQUIDITY_BUDGET,
            INITIAL_TICK
        );
    }

    function _buildFullRangePlan(PoolKey memory key, uint160 initialSqrtPriceX96)
        private
        view
        returns (Plan memory plan, Position memory position)
    {
        PositionDefinition[] memory definitions = new PositionDefinition[](0);
        CurrencyAmounts memory available =
            CurrencyAmounts({ amount0: NATIVE_LIQUIDITY_BUDGET, amount1: TOKEN_LIQUIDITY_BUDGET });
        (Position[] memory positions, CurrencyAmounts memory remaining) =
            PositionPlanner.resolve(definitions, initialSqrtPriceX96, TICK_SPACING, available, lpRecipient);
        if (
            positions.length != 1 || positions[0].amount0 == 0 || positions[0].amount1 == 0
                || positions[0].amount0 > NATIVE_LIQUIDITY_BUDGET || positions[0].amount1 > TOKEN_LIQUIDITY_BUDGET
        ) {
            uint256 nativeAmount = positions.length == 0 ? 0 : positions[0].amount0;
            uint256 tokenAmount = positions.length == 0 ? 0 : positions[0].amount1;
            revert InvalidPosition(positions.length, nativeAmount, tokenAmount);
        }
        position = positions[0];
        if (
            remaining.amount0 != NATIVE_LIQUIDITY_BUDGET - position.amount0
                || remaining.amount1 != TOKEN_LIQUIDITY_BUDGET - position.amount1
        ) revert InvalidRemainder(remaining.amount0, remaining.amount1);
        plan = PositionPlanner.toPlan(positions, key, launchWallet);
    }

    function _validateToken(ProgrammableCanaryTokenV1 token_) private view {
        if (address(token_).code.length == 0) revert InvalidToken(address(token_), FIELD_CODE);
        if (token_.totalSupply() != TOKEN_LIQUIDITY_BUDGET) {
            revert InvalidToken(address(token_), FIELD_SUPPLY);
        }
        if (token_.launchWallet() != launchWallet) revert InvalidToken(address(token_), FIELD_WALLET);
        if (token_.liquidityInitializer() != address(this)) {
            revert InvalidToken(address(token_), FIELD_INITIALIZER);
        }
        if (token_.balanceOf(address(this)) != TOKEN_LIQUIDITY_BUDGET) {
            revert InvalidToken(address(token_), FIELD_ALLOCATION);
        }
    }

    function _requireEmptyPositionManagerTokenBalance(ProgrammableCanaryTokenV1 token_) private view {
        uint256 tokenBalance = token_.balanceOf(address(positionManager));
        if (tokenBalance != 0) {
            revert PositionManagerBalanceNotEmpty(address(positionManager).balance, tokenBalance);
        }
    }

    function _requireEmptyPositionManagerBalance(ProgrammableCanaryTokenV1 token_) private view {
        uint256 tokenBalance = token_.balanceOf(address(positionManager));
        if (address(positionManager).balance != 0 || tokenBalance != 0) {
            revert PositionManagerBalanceNotEmpty(address(positionManager).balance, tokenBalance);
        }
    }

    function _validateHook(ProgrammableCanaryTokenV1 token_, PlatformFeeHookV1 hook_)
        private
        view
        returns (PoolKey memory key)
    {
        if (address(hook_).code.length == 0) revert InvalidHook(address(hook_), FIELD_CODE);
        if ((uint160(address(hook_)) & ALL_HOOK_MASK) != REQUIRED_HOOK_FLAGS) {
            revert InvalidHook(address(hook_), FIELD_PERMISSIONS);
        }
        if (address(hook_.poolManager()) != address(poolManager)) {
            revert InvalidHook(address(hook_), FIELD_POOL_MANAGER);
        }
        if (hook_.authorized() != address(this)) revert InvalidHook(address(hook_), FIELD_INITIALIZER);
        if (hook_.feeRecipient() != PLATFORM_FEE_RECIPIENT) {
            revert InvalidHook(address(hook_), FIELD_FEE_RECIPIENT);
        }
        if (hook_.currency0() != address(0) || hook_.currency1() != address(token_)) {
            revert InvalidHook(address(hook_), FIELD_CURRENCIES);
        }
        if (
            hook_.LP_FEE_PIPS() != LP_FEE_PIPS || hook_.TICK_SPACING() != TICK_SPACING
                || hook_.PLATFORM_FEE_PIPS() != PLATFORM_FEE_PIPS
        ) revert InvalidHook(address(hook_), FIELD_FEES);

        key = reviewedPoolKey(address(token_), address(hook_));
        if (hook_.poolId() != PoolId.unwrap(key.toId())) revert InvalidHook(address(hook_), FIELD_POOL_ID);
    }
}
