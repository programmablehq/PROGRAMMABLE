// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
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
import { FoundationTypesV1 as T } from "./FoundationTypesV1.sol";
import { FoundationFeeMathV1 as F } from "./FoundationFeeMathV1.sol";
import { FoundationLedgerV1 } from "./FoundationLedgerV1.sol";
import { IFoundationModuleV1, IFoundationModuleFactoryV1 } from "./IFoundationModuleV1.sol";

/// @notice Immutable per-pool directional creator fees and bounded module composition, with open router compatibility.
/// @dev No arbitrary host calls, swaps, delegatecalls, user identity from hookData, or module access to platform funds.
contract FoundationHookV2 is BaseHook {
    using PoolIdLibrary for PoolKey;
    uint256 private constant MAX_AMOUNT = uint256(uint128(type(int128).max));
    address public immutable initializer;
    address public immutable token;
    address public immutable quote;
    address public immutable creator;
    int24 public immutable initialTick;
    uint16 public immutable creatorBuyFeeBps;
    uint16 public immutable creatorSellFeeBps;
    FoundationLedgerV1 public immutable ledger;
    bytes32 public immutable poolId;
    bytes32 public immutable compositionHash;
    mapping(bool => F.Carry) public feeCarry;
    // A span guard covers BOTH Core callbacks. An ordinary per-function guard would allow nested swaps between them.
    uint8 private _phase;
    address private _actionModule;

    struct Module {
        address instance;
        bytes32 codeHash;
        bytes32 configurationHash;
        T.Descriptor descriptor;
    }
    Module[] private _modules;

    struct Settlement {
        bool buy;
        bool exactInput;
        bool quoteSpecified;
        uint256 gross;
        uint256 fee;
        F.Result fees;
    }

    error InvalidConfiguration();
    error InvalidInitialization();
    error InvalidSwap();
    error InvalidSettlement();
    error PartialFillUnsupported();
    error ReentrantOperation();
    error ModuleFailure(uint256 index, uint8 phase);
    error ModuleConflict(uint256 first, uint256 second);
    error InvalidModuleResponse(address instance);

    event ModuleBound(
        uint256 indexed index,
        address indexed instance,
        bytes32 codeHash,
        bytes32 configurationHash,
        bytes32 descriptorHash,
        uint16 creatorShareBps
    );
    event ModuleCallbackFailed(uint256 indexed index, uint8 phase);
    event ModuleAction(uint256 indexed index, address indexed actor, bytes32 dataHash);
    event FoundationSwap(
        bytes32 indexed poolId,
        address indexed router,
        bool buy,
        bool exactInput,
        uint256 grossQuote,
        uint256 platformQuote,
        uint256 creatorQuote,
        int128 coreAmount0,
        int128 coreAmount1
    );

    constructor(
        IPoolManager manager,
        address initializer_,
        address token_,
        address quote_,
        address creator_,
        int24 initialTick_,
        uint16 creatorBuyFeeBps_,
        uint16 creatorSellFeeBps_,
        T.ModuleSelection[] memory selections
    ) BaseHook(manager) {
        if (
            address(manager).code.length == 0 || initializer_ == address(0) || token_.code.length == 0
                || quote_.code.length == 0 || token_ == quote_ || creator_ == address(0)
                || creatorBuyFeeBps_ > T.MAX_CREATOR_BPS || creatorBuyFeeBps_ % 100 != 0
                || creatorSellFeeBps_ > T.MAX_CREATOR_BPS || creatorSellFeeBps_ % 100 != 0
                || initialTick_ % T.TICK_SPACING != 0 || initialTick_ <= TickMath.minUsableTick(T.TICK_SPACING)
                || initialTick_ >= TickMath.maxUsableTick(T.TICK_SPACING)
        ) revert InvalidConfiguration();
        initializer = initializer_;
        token = token_;
        quote = quote_;
        creator = creator_;
        initialTick = initialTick_;
        creatorBuyFeeBps = creatorBuyFeeBps_;
        creatorSellFeeBps = creatorSellFeeBps_;
        poolId = PoolId.unwrap(poolKey().toId());
        ledger = new FoundationLedgerV1(manager, quote_, creator_);
        compositionHash = keccak256(abi.encode(T.ABI_ID, selections));
        _configureModules(selections);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeInitialize = true;
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }

    function poolKey() public view returns (PoolKey memory) {
        bool quote0 = quote < token;
        return PoolKey(
            Currency.wrap(quote0 ? quote : token),
            Currency.wrap(quote0 ? token : quote),
            T.LP_FEE,
            T.TICK_SPACING,
            IHooks(address(this))
        );
    }

    function moduleCount() external view returns (uint256) {
        return _modules.length;
    }

    function moduleAt(uint256 index) external view returns (Module memory) {
        return _modules[index];
    }

    function isModuleAction(address module) external view returns (bool) {
        return _phase == 2 && _actionModule == module;
    }

    function executeModuleAction(uint256 index, bytes calldata data) external {
        if (_phase != 0) revert ReentrantOperation();
        Module storage m = _modules[index];
        if ((m.descriptor.phases & T.ACTION) == 0 || data.length > 16_384) revert InvalidConfiguration();
        _phase = 2;
        if ((m.descriptor.resources & T.OWN_QUOTE_BUDGET) != 0) _actionModule = m.instance;
        if (!_call(
                m,
                abi.encodeCall(IFoundationModuleV1.onAction, (msg.sender, data)),
                m.descriptor.actionGas,
                IFoundationModuleV1.onAction.selector
            )) revert ModuleFailure(index, T.ACTION);
        _actionModule = address(0);
        _phase = 0;
        emit ModuleAction(index, msg.sender, keccak256(data));
    }

    function previewGrossFees(bool buy, uint256 amount) external view returns (F.Result memory) {
        return F.quoteGross(amount, _creatorFeeBps(buy), feeCarry[buy]);
    }

    function previewNetFees(bool buy, uint256 amount) external view returns (uint256, F.Result memory) {
        return F.quoteNet(amount, _creatorFeeBps(buy), feeCarry[buy]);
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96)
        internal
        view
        override
        returns (bytes4)
    {
        if (
            sender != initializer || PoolId.unwrap(key.toId()) != poolId
                || sqrtPriceX96 != TickMath.getSqrtPriceAtTick(initialTick)
        ) revert InvalidInitialization();
        return IHooks.beforeInitialize.selector;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        // A standalone action may route a fee-paying swap through an external router. A swap callback
        // may never start another swap. Phase 3 restores the existing action only after full settlement.
        if (_phase != 0 && _phase != 2) revert ReentrantOperation();
        if (PoolId.unwrap(key.toId()) != poolId) revert InvalidSwap();
        _phase = _phase == 2 ? 3 : 1;
        uint256 specified = _specifiedAmount(params.amountSpecified);
        bool buy = params.zeroForOne == (quote < token);
        T.SwapContext memory context_ =
            T.SwapContext(poolId, sender, buy, params.amountSpecified < 0, specified, 0, 0, 0);
        _dispatch(T.BEFORE_SWAP, context_);
        if (buy != (params.amountSpecified < 0)) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        uint256 gross = specified;
        F.Result memory result;
        if (buy) result = F.quoteGross(gross, _creatorFeeBps(buy), feeCarry[buy]);
        else (gross, result) = F.quoteNet(specified, _creatorFeeBps(buy), feeCarry[buy]);
        // Carry is committed only after the actual full fill is validated in afterSwap.
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(_checkedFee(gross, result))), 0), 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        if ((_phase != 1 && _phase != 3) || PoolId.unwrap(key.toId()) != poolId) {
            revert ReentrantOperation();
        }
        bool inAction = _phase == 3;
        Settlement memory settled = _settlement(params, delta);
        feeCarry[settled.buy] = settled.fees.next;
        if (settled.fee != 0) poolManager.mint(address(ledger), Currency.wrap(quote).toId(), settled.fee);
        ledger.accrue(settled.fees.platform, settled.fees.creator);
        _dispatch(
            T.AFTER_SWAP,
            T.SwapContext(
                poolId,
                sender,
                settled.buy,
                settled.exactInput,
                _specifiedAmount(params.amountSpecified),
                settled.gross,
                delta.amount0(),
                delta.amount1()
            )
        );
        _phase = inAction ? 2 : 0;
        emit FoundationSwap(
            poolId,
            sender,
            settled.buy,
            settled.exactInput,
            settled.gross,
            settled.fees.platform,
            settled.fees.creator,
            delta.amount0(),
            delta.amount1()
        );
        return (IHooks.afterSwap.selector, settled.quoteSpecified ? int128(0) : int128(int256(settled.fee)));
    }

    function _settlement(SwapParams calldata params, BalanceDelta delta) private view returns (Settlement memory s) {
        uint256 specified = _specifiedAmount(params.amountSpecified);
        bool quote0 = quote < token;
        s.buy = params.zeroForOne == quote0;
        s.exactInput = params.amountSpecified < 0;
        s.quoteSpecified = s.buy == s.exactInput;
        int128 quoteDelta = quote0 ? delta.amount0() : delta.amount1();
        int128 tokenDelta = quote0 ? delta.amount1() : delta.amount0();
        uint256 quoteAmount = _absolute(quoteDelta);
        if (!s.quoteSpecified && _absolute(tokenDelta) != specified) revert PartialFillUnsupported();
        if (s.exactInput) {
            s.gross = s.buy ? specified : quoteAmount;
            s.fees = F.quoteGross(s.gross, _creatorFeeBps(s.buy), feeCarry[s.buy]);
        } else {
            (s.gross, s.fees) = F.quoteNet(s.buy ? quoteAmount : specified, _creatorFeeBps(s.buy), feeCarry[s.buy]);
        }
        s.fee = _checkedFee(s.gross, s.fees);
        if (s.quoteSpecified && quoteAmount != (s.buy ? s.gross - s.fee : s.gross)) revert PartialFillUnsupported();
        if (s.buy ? quoteDelta >= 0 || tokenDelta <= 0 : quoteDelta <= 0 || tokenDelta >= 0) {
            revert InvalidSettlement();
        }
    }

    function _configureModules(T.ModuleSelection[] memory selections) private {
        if (selections.length > T.MAX_MODULES) revert InvalidConfiguration();
        address[] memory instances = new address[](selections.length);
        uint16[] memory shares = new uint16[](selections.length);
        uint256 totalSwapGas;
        for (uint256 i; i < selections.length; ++i) {
            T.ModuleSelection memory selection = selections[i];
            if (
                selection.factory.code.length == 0 || selection.factory.codehash != selection.factoryCodeHash
                    || selection.configuration.length > 16_384
            ) revert InvalidConfiguration();
            T.ModuleContext memory context_ =
                T.ModuleContext(address(this), token, quote, creator, address(ledger), poolId);
            address instance =
                IFoundationModuleFactoryV1(selection.factory).createModule(context_, selection.configuration);
            if (
                instance.code.length == 0 || instance.codehash != selection.moduleCodeHash
                    || instance == address(poolManager) || instance == address(ledger) || instance == initializer
            ) {
                revert InvalidConfiguration();
            }
            IFoundationModuleV1 module = IFoundationModuleV1(instance);
            T.Descriptor memory d = module.descriptor();
            bytes32 configHash = keccak256(selection.configuration);
            if (
                keccak256(abi.encode(module.context())) != keccak256(abi.encode(context_))
                    || module.configurationHash() != configHash || keccak256(abi.encode(d)) != selection.descriptorHash
                    || d.abiVersion != 1 || d.moduleId == 0 || d.phases == 0 || d.phases > 7 || d.resources > 1
                    || d.beforeGas > 300_000 || d.afterGas > 300_000 || d.actionGas > 2_000_000
                    || ((d.phases & T.BEFORE_SWAP) != 0 && d.beforeGas < 10_000)
                    || ((d.phases & T.AFTER_SWAP) != 0 && d.afterGas < 10_000)
                    || ((d.phases & T.ACTION) != 0 && d.actionGas < 10_000)
                    || ((d.phases & T.BEFORE_SWAP) == 0 && d.beforeGas != 0)
                    || ((d.phases & T.AFTER_SWAP) == 0 && (d.afterGas != 0 || d.failOpenAfter))
                    || ((d.phases & T.ACTION) == 0 && (d.actionGas != 0 || d.resources != 0))
                    || (selection.creatorShareBps != 0
                        && ((d.resources & T.OWN_QUOTE_BUDGET) == 0 || (d.phases & T.ACTION) == 0))
            ) revert InvalidConfiguration();
            for (uint256 j; j < i; ++j) {
                Module storage previous = _modules[j];
                if (
                    previous.instance == instance || previous.descriptor.moduleId == d.moduleId
                        || (d.exclusiveGroup != 0 && previous.descriptor.exclusiveGroup == d.exclusiveGroup)
                ) {
                    revert ModuleConflict(j, i);
                }
            }
            totalSwapGas += d.beforeGas + d.afterGas;
            instances[i] = instance;
            shares[i] = selection.creatorShareBps;
            _modules.push(Module(instance, selection.moduleCodeHash, configHash, d));
            emit ModuleBound(i, instance, selection.moduleCodeHash, configHash, selection.descriptorHash, shares[i]);
        }
        if (totalSwapGas > 1_200_000) revert InvalidConfiguration();
        ledger.configure(instances, shares);
    }

    function _dispatch(uint8 phase, T.SwapContext memory context_) private {
        for (uint256 i; i < _modules.length; ++i) {
            Module storage m = _modules[i];
            if ((m.descriptor.phases & phase) == 0) continue;
            bool before_ = phase == T.BEFORE_SWAP;
            bytes4 selector =
                before_ ? IFoundationModuleV1.onBeforeSwap.selector : IFoundationModuleV1.onAfterSwap.selector;
            bool ok = _call(
                m,
                abi.encodeWithSelector(selector, context_),
                before_ ? m.descriptor.beforeGas : m.descriptor.afterGas,
                selector
            );
            if (!ok) {
                if (before_ || !m.descriptor.failOpenAfter) revert ModuleFailure(i, phase);
                emit ModuleCallbackFailed(i, phase);
            }
        }
    }

    /// @dev Fixed output buffer prevents returndata bombs. The gas reserve also prevents a caller from selectively
    /// starving a fail-open observer while leaving enough gas for the enclosing swap to complete.
    function _call(Module storage m, bytes memory data, uint32 budget, bytes4 selector) private returns (bool ok) {
        address instance = m.instance;
        if (instance.codehash != m.codeHash) revert InvalidConfiguration();
        if (gasleft() < uint256(budget) * 64 / 63 + 60_000) revert InvalidSwap();
        bytes32 result;
        uint256 size;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0)
            ok := call(budget, instance, 0, add(data, 32), mload(data), ptr, 32)
            result := mload(ptr)
            size := returndatasize()
        }
        // A successful but nonconforming callback may already have changed its state. Reject the
        // entire enclosing operation instead of treating it as a rolled-back fail-open callback.
        if (ok && (size != 32 || result != bytes32(selector))) revert InvalidModuleResponse(instance);
        return ok;
    }

    function _creatorFeeBps(bool buy) private view returns (uint16) {
        return buy ? creatorBuyFeeBps : creatorSellFeeBps;
    }

    function _checkedFee(uint256 gross, F.Result memory result) private pure returns (uint256 fee) {
        fee = result.platform + result.creator;
        if (gross == 0 || gross > MAX_AMOUNT || fee >= gross) revert InvalidSwap();
    }

    function _specifiedAmount(int256 amount) private pure returns (uint256) {
        if (amount == 0 || amount > int256(MAX_AMOUNT) || amount < -int256(MAX_AMOUNT)) revert InvalidSwap();
        return amount < 0 ? uint256(-amount) : uint256(amount);
    }

    function _absolute(int128 amount) private pure returns (uint256) {
        return amount < 0 ? uint256(-int256(amount)) : uint256(int256(amount));
    }
}
