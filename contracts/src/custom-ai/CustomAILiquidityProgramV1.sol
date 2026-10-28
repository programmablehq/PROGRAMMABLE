// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams, ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
import { CustomAIFactoryV1 } from "./CustomAIFactoryV1.sol";
import { CustomAIHookV1 } from "./CustomAIHookV1.sol";
import { CustomAIProgramRouterV1 } from "./CustomAIProgramRouterV1.sol";
import { CustomAIExecutionPriceFeedV1 } from "./CustomAIExecutionPriceFeedV1.sol";
import { CustomAIFeeLedgerV1 } from "./CustomAIFeeLedgerV1.sol";
import { CustomAITransfersV1 as X } from "./CustomAITransfersV1.sol";

interface ICustomAIActionRule {
    function actionState(bytes32 actionId, uint64 launched) external view returns (bool, bytes32, uint64);
}

/// @notice Only adds to a permanently held canonical pool position. No exit or arbitrary call exists.
contract CustomAILiquidityProgramV1 is ReentrancyGuardTransient, IUnlockCallback {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    struct Configuration {
        CustomAIFactoryV1 factory;
        address creator;
        bytes32 launchSalt;
        CustomAIProgramRouterV1 allocator;
        bytes32 actionId;
        address quote;
        uint128 maximumBatch;
        uint16 maximumDeviationBps;
        uint64 interval;
        uint64 maxPriceAge;
        uint32 minimumObservations;
        uint64 minimumHistory;
        CustomAIExecutionPriceFeedV1 priceFeed;
    }
    Configuration public config;
    bytes32 public immutable configurationHash;
    bytes32 public immutable factoryCodeHash;
    bytes32 public immutable quoteCodeHash;
    bytes32 public immutable priceFeedCodeHash;
    uint128 public liquidity;
    uint256 public nextExecution;
    mapping(bytes32 => bool) public executed;
    bytes32 private pending;
    error NotReady();
    error InvalidConfiguration();
    error InvalidSettlement();
    event Compounded(bytes32 indexed executionId, uint256 quoteBudget, uint128 liquidityAdded);

    constructor(Configuration memory c) {
        if (
            address(c.factory).code.length == 0 || c.creator == address(0) || c.quote.code.length == 0
                || c.actionId == 0 || address(c.allocator) == address(0) || address(c.priceFeed).code.length == 0
                || c.maximumBatch < 2 || c.maximumBatch > T.MAX_AMOUNT || c.maximumDeviationBps == 0
                || c.maximumDeviationBps > 1000 || c.interval < 60 || c.maxPriceAge < 15 || c.maxPriceAge > 3600
                || c.minimumObservations < 3 || c.minimumHistory < 60
        ) revert InvalidConfiguration();
        config = c;
        factoryCodeHash = address(c.factory).codehash;
        quoteCodeHash = c.quote.codehash;
        // The CREATE2 allocator may be deployed immediately after this program.
        priceFeedCodeHash = address(c.priceFeed).codehash;
        configurationHash = keccak256(abi.encode(T.VERSION_ID, "locked-liquidity-v1", c));
    }

    function execute(
        bytes32 executionId,
        uint256 maximumQuote,
        uint128 minimumLiquidity,
        uint64 deadline,
        bytes calldata priceProof
    ) external nonReentrant {
        Configuration memory c = config;
        if (
            block.timestamp > deadline || block.timestamp < nextExecution || executed[executionId] || maximumQuote < 2
                || maximumQuote > c.maximumBatch || address(c.factory).codehash != factoryCodeHash
                || c.quote.codehash != quoteCodeHash || address(c.priceFeed).codehash != priceFeedCodeHash
        ) revert NotReady();
        T.LaunchResult memory r = c.factory.launchOf(c.creator, c.launchSalt);
        if (r.token == address(0)) revert NotReady();
        CustomAIHookV1 hook = CustomAIHookV1(r.hook);
        address rule = hook.feeModule();
        if (rule.codehash != hook.moduleCodeHash()) revert NotReady();
        (bool active, bytes32 eventId, uint64 validUntil) =
            ICustomAIActionRule(rule).actionState(c.actionId, hook.launchTimestamp());
        bytes32 expected = keccak256(abi.encode(configurationHash, eventId));
        if (!active || validUntil < block.timestamp || executionId != expected) revert NotReady();
        if (
            address(c.allocator.factory()) != address(c.factory) || c.allocator.creator() != c.creator
                || c.allocator.launchSalt() != c.launchSalt || address(c.allocator.quote()) != c.quote
        ) revert InvalidConfiguration();
        CustomAIFeeLedgerV1 ledger = CustomAIFeeLedgerV1(r.ledger);
        if (ledger.additionalReceived() > ledger.additionalClaimed()) ledger.claimAdditional();
        c.allocator.collectAndAllocate();
        c.allocator.claimFor(c.actionId);
        uint256 amount = Math.min(IERC20(c.quote).balanceOf(address(this)), maximumQuote);
        if (amount < 2) revert NotReady();
        (CustomAIExecutionPriceFeedV1.Quote memory q, bytes memory signature) =
            abi.decode(priceProof, (CustomAIExecutionPriceFeedV1.Quote, bytes));
        if (q.poolId != r.poolId || q.executionId != executionId || q.amount != amount) revert NotReady();
        c.priceFeed.verify(q, signature, c.maxPriceAge, c.minimumObservations, c.minimumHistory);
        PoolKey memory key = hook.poolKey();
        IPoolManager manager = c.factory.poolManager();
        (uint160 price,,,) = manager.getSlot0(PoolId.wrap(r.poolId));
        _checkPrice(price, q.sqrtPriceX96, c.maximumDeviationBps);
        uint256 half = amount / 2;
        uint256 minimumTokens = _minimumTokens(half, q.sqrtPriceX96, c.quote < r.token, c.maximumDeviationBps);
        if (minimumTokens == 0) revert NotReady();
        IERC20(c.quote).forceApprove(address(c.factory.router()), half);
        c.factory
            .router()
            .swap(
                key,
                SwapParams(
                    c.quote < r.token,
                    -int256(half),
                    c.quote < r.token ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                ),
                minimumTokens,
                T.MAX_TOTAL_BPS,
                address(this),
                deadline
            );
        IERC20(c.quote).forceApprove(address(c.factory.router()), 0);
        (price,,,) = manager.getSlot0(PoolId.wrap(r.poolId));
        _checkPrice(price, q.sqrtPriceX96, c.maximumDeviationBps);
        uint160 low = TickMath.getSqrtPriceAtTick(TickMath.minUsableTick(key.tickSpacing));
        uint160 high = TickMath.getSqrtPriceAtTick(TickMath.maxUsableTick(key.tickSpacing));
        uint256 balance0 = IERC20(Currency.unwrap(key.currency0)).balanceOf(address(this));
        uint256 balance1 = IERC20(Currency.unwrap(key.currency1)).balanceOf(address(this));
        uint128 added = LiquidityAmounts.getLiquidityForAmounts(price, low, high, balance0, balance1);
        uint128 floor = LiquidityAmounts.getLiquidityForAmounts(
            q.sqrtPriceX96,
            low,
            high,
            c.quote < r.token ? amount - half : minimumTokens,
            c.quote < r.token ? minimumTokens : amount - half
        );
        floor = uint128(Math.mulDiv(floor, 10_000 - c.maximumDeviationBps, 10_000));
        if (floor == 0 || added < floor || added < minimumLiquidity || added > uint128(type(int128).max)) revert InvalidSettlement();
        executed[executionId] = true;
        nextExecution = block.timestamp + c.interval;
        bytes memory data = abi.encode(key, added);
        pending = keccak256(data);
        manager.unlock(data);
        if (pending != 0) revert InvalidSettlement();
        liquidity += added;
        emit Compounded(executionId, amount, added);
    }

    function _checkPrice(uint160 current, uint160 referencePrice, uint16 deviation) private pure {
        uint256 scaledSquare = Math.mulDiv(current, current, referencePrice);
        if (
            scaledSquare < Math.mulDiv(referencePrice, 10_000 - deviation, 10_000)
                || scaledSquare > Math.mulDiv(referencePrice, 10_000 + deviation, 10_000)
        ) revert NotReady();
    }

    function _minimumTokens(uint256 amount, uint160 price, bool quote0, uint16 deviation)
        private
        pure
        returns (uint256)
    {
        uint256 net = Math.mulDiv(amount, 8500, 10_000);
        uint256 tokens;
        if (quote0) tokens = Math.mulDiv(Math.mulDiv(net, price, 1 << 96), price, 1 << 96);
        else tokens = Math.mulDiv(Math.mulDiv(net, 1 << 96, price), 1 << 96, price);
        return Math.mulDiv(tokens, 10_000 - deviation, 10_000);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        IPoolManager manager = config.factory.poolManager();
        if (msg.sender != address(manager) || !_reentrancyGuardEntered() || pending == 0 || keccak256(data) != pending)
        {
            revert InvalidSettlement();
        }
        pending = 0;
        (PoolKey memory key, uint128 added) = abi.decode(data, (PoolKey, uint128));
        (BalanceDelta delta,) = manager.modifyLiquidity(
            key,
            ModifyLiquidityParams(
                TickMath.minUsableTick(key.tickSpacing),
                TickMath.maxUsableTick(key.tickSpacing),
                int256(uint256(added)),
                config.actionId
            ),
            bytes("")
        );
        _settle(manager, key.currency0, delta.amount0());
        _settle(manager, key.currency1, delta.amount1());
        return bytes("");
    }

    function _settle(IPoolManager manager, Currency currency, int128 amount) private {
        if (amount > 0) revert InvalidSettlement();
        if (amount == 0) return;
        uint256 owed = uint256(-int256(amount));
        manager.sync(currency);
        X.push(IERC20(Currency.unwrap(currency)), address(manager), owed);
        if (manager.settle() != owed) revert InvalidSettlement();
    }
}
