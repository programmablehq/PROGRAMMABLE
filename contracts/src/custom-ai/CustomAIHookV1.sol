// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { ProtocolFeeLibrary } from "@uniswap/v4-core/src/libraries/ProtocolFeeLibrary.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
import { CustomAIFeeMathV1 as F } from "./CustomAIFeeMathV1.sol";
import { CustomAIModuleCallV1 as M } from "./CustomAIModuleCallV1.sol";
import { CustomAIFeeLedgerV1 } from "./CustomAIFeeLedgerV1.sol";
import { CustomAIRewardVaultV1 } from "./CustomAIRewardVaultV1.sol";

/// @notice One immutable canonical pool; modules may only propose a capped, read-only extra fee.
contract CustomAIHookV1 is BaseHook {
    using PoolIdLibrary for PoolKey;
    uint16 public constant PLATFORM_FEE_BPS = T.PLATFORM_BPS;
    uint16 public constant MAX_TOTAL_FEE_BPS = T.MAX_TOTAL_BPS;
    address public immutable initializer;
    address public immutable token;
    address public immutable quote;
    bytes32 public immutable quoteCodeHash;
    int24 public immutable initialTick;
    uint64 public immutable launchTimestamp;
    bytes32 public immutable poolId;
    address public immutable feeModule;
    bytes32 public immutable moduleCodeHash;
    bytes32 public immutable configurationHash;
    CustomAIFeeLedgerV1 public immutable ledger;
    CustomAIRewardVaultV1 public immutable rewardVault;
    // Span both callbacks, and evaluate the fee only once before the pool price moves.
    bytes32 private _swapContext;
    uint16 private _additionalBps;
    uint16 private _maximumFeeBps;
    uint256 private _protocolBefore;
    M.Status private _moduleStatus;

    error InvalidConfiguration();
    error InvalidInitialization();
    error InvalidSwap();
    error FeeLimitExceeded();
    error PartialFillUnsupported();
    error InvalidSettlement();
    error ReentrantOperation();

    event CustomAISwap(
        bytes32 indexed poolId,
        address indexed router,
        bool buy,
        bool exactInput,
        uint256 grossQuote,
        uint256 platformQuote,
        uint256 additionalQuote,
        uint16 additionalBps,
        M.Status moduleStatus
    );

    constructor(
        IPoolManager manager,
        address initializer_,
        address token_,
        address quote_,
        int24 tick_,
        T.ModuleBinding memory module,
        T.Rewards memory rewards
    ) BaseHook(manager) {
        if (
            address(manager).code.length == 0 || initializer_ == address(0) || token_.code.length == 0
                || quote_.code.length == 0 || token_ == quote_ || tick_ % T.TICK_SPACING != 0
                || tick_ <= TickMath.minUsableTick(T.TICK_SPACING) || tick_ >= TickMath.maxUsableTick(T.TICK_SPACING)
        ) {
            revert InvalidConfiguration();
        }
        if (module.instance == address(0)) {
            if (module.runtimeHash != 0 || module.configurationHash != 0) revert InvalidConfiguration();
        } else if (module.instance.code.length == 0 || module.instance.codehash != module.runtimeHash) {
            revert InvalidConfiguration();
        }
        initializer = initializer_;
        token = token_;
        quote = quote_;
        quoteCodeHash = quote_.codehash;
        initialTick = tick_;
        launchTimestamp = uint64(block.timestamp);
        feeModule = module.instance;
        moduleCodeHash = module.runtimeHash;
        configurationHash = module.configurationHash;
        poolId = PoolId.unwrap(poolKey().toId());
        rewardVault = new CustomAIRewardVaultV1(quote_, rewards);
        ledger = new CustomAIFeeLedgerV1(manager, quote_, address(rewardVault));
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeInitialize = true;
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }

    function poolKey() public view returns (PoolKey memory) {
        bool q0 = quote < token;
        return PoolKey(
            Currency.wrap(q0 ? quote : token),
            Currency.wrap(q0 ? token : quote),
            T.LP_FEE,
            T.TICK_SPACING,
            IHooks(address(this))
        );
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPrice)
        internal
        view
        override
        returns (bytes4)
    {
        if (
            sender != initializer || PoolId.unwrap(key.toId()) != poolId
                || sqrtPrice != TickMath.getSqrtPriceAtTick(initialTick)
        ) revert InvalidInitialization();
        return IHooks.beforeInitialize.selector;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata data)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (_swapContext != 0) revert ReentrantOperation();
        if (
            PoolId.unwrap(key.toId()) != poolId || quote.codehash != quoteCodeHash
                || (data.length != 0 && data.length != 32)
        ) {
            revert InvalidSwap();
        }
        // Reserve room for Core's directional input fee; afterSwap checks actual rounded deductions.
        (,, uint24 protocolFee, uint24 lpFee) = StateLibrary.getSlot0(poolManager, PoolId.wrap(poolId));
        if (lpFee != 0) revert InvalidConfiguration();
        uint16 protocolPips = params.zeroForOne
            ? ProtocolFeeLibrary.getZeroForOneFee(protocolFee)
            : ProtocolFeeLibrary.getOneForZeroFee(protocolFee);
        uint16 reserveBps = (protocolPips + 99) / 100;
        // Standard v4 routers/quoters may send no hook data. They retain their
        // own min-output/max-input checks and the same immutable global fee cap.
        // A supplied word is a stricter trader ceiling, never a fee exemption.
        uint256 ceiling = data.length == 0 ? T.MAX_TOTAL_BPS : abi.decode(data, (uint256));
        if (ceiling < T.PLATFORM_BPS || ceiling > T.MAX_TOTAL_BPS) revert FeeLimitExceeded();
        uint256 specified = _specified(params.amountSpecified);
        bool buy = params.zeroForOne == (quote < token);
        (uint16 extra, M.Status status) = M.evaluate(
            T.ModuleBinding(feeModule, moduleCodeHash, configurationHash),
            T.SwapContext(poolId, sender, launchTimestamp, buy, params.amountSpecified < 0, specified)
        );
        if (extra > T.MAX_ADDITIONAL_BPS - reserveBps) extra = T.MAX_ADDITIONAL_BPS - reserveBps;
        if (T.PLATFORM_BPS + extra + reserveBps > ceiling) revert FeeLimitExceeded();
        _swapContext = keccak256(abi.encode(sender, params, data));
        _additionalBps = extra;
        _maximumFeeBps = uint16(ceiling);
        _protocolBefore = poolManager.protocolFeesAccrued(params.zeroForOne ? key.currency0 : key.currency1);
        _moduleStatus = status;
        if (buy != (params.amountSpecified < 0)) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        F.Fees memory fees;
        if (buy) fees = F.fromGross(specified, extra);
        else (, fees) = F.fromNet(specified, extra);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fees.platform + fees.additional)), 0), 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata data
    ) internal override returns (bytes4, int128) {
        if (
            _swapContext == 0 || _swapContext != keccak256(abi.encode(sender, params, data))
                || PoolId.unwrap(key.toId()) != poolId
        ) revert ReentrantOperation();
        bool buy = params.zeroForOne == (quote < token);
        bool exactInput = params.amountSpecified < 0;
        bool quoteSpecified = buy == exactInput;
        int128 qDelta = quote < token ? delta.amount0() : delta.amount1();
        int128 tDelta = quote < token ? delta.amount1() : delta.amount0();
        if (buy ? qDelta >= 0 || tDelta <= 0 : qDelta <= 0 || tDelta >= 0) revert InvalidSettlement();
        uint256 specified = _specified(params.amountSpecified);
        uint256 qAmount = _abs(qDelta);
        if (!quoteSpecified && _abs(tDelta) != specified) revert PartialFillUnsupported();
        uint256 gross;
        F.Fees memory fees;
        if (exactInput) {
            gross = buy ? specified : qAmount;
            fees = F.fromGross(gross, _additionalBps);
        } else {
            (gross, fees) = F.fromNet(buy ? qAmount : specified, _additionalBps);
        }
        if (quoteSpecified && qAmount != (buy ? fees.net : gross)) revert PartialFillUnsupported();
        uint256 totalFee = fees.platform + fees.additional;
        uint256 protocolPaid =
            poolManager.protocolFeesAccrued(params.zeroForOne ? key.currency0 : key.currency1) - _protocolBefore;
        if (buy) {
            if (totalFee + protocolPaid > FullMath.mulDiv(gross, _maximumFeeBps, T.BPS)) revert FeeLimitExceeded();
        } else {
            // Combined fee fraction = p/input + (1 - p/input) * fee/grossQuote.
            // Amounts fit int128, so both products and their sum fit uint256; mulDiv handles the BPS scale.
            uint256 tokenInput = _abs(tDelta);
            if (protocolPaid > tokenInput) revert InvalidSettlement();
            uint256 numerator = protocolPaid * gross + (tokenInput - protocolPaid) * totalFee;
            uint256 effectiveBps = FullMath.mulDivRoundingUp(numerator, T.BPS, tokenInput * gross);
            if (effectiveBps > _maximumFeeBps) revert FeeLimitExceeded();
        }
        if (totalFee != 0) poolManager.mint(address(ledger), uint256(uint160(quote)), totalFee);
        ledger.accrue(gross, _additionalBps);
        emit CustomAISwap(
            poolId, sender, buy, exactInput, gross, fees.platform, fees.additional, _additionalBps, _moduleStatus
        );
        _swapContext = 0;
        _additionalBps = 0;
        _maximumFeeBps = 0;
        _protocolBefore = 0;
        _moduleStatus = M.Status.NoModule;
        return (IHooks.afterSwap.selector, quoteSpecified ? int128(0) : int128(int256(totalFee)));
    }

    function _specified(int256 amount) private pure returns (uint256 value) {
        if (amount == type(int256).min) revert InvalidSwap();
        value = uint256(amount < 0 ? -amount : amount);
        if (value == 0 || value > T.MAX_AMOUNT) revert InvalidSwap();
    }

    function _abs(int128 value) private pure returns (uint256) {
        return value < 0 ? uint256(-int256(value)) : uint256(int256(value));
    }
}
