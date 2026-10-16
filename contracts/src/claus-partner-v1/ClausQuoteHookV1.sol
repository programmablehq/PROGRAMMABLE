// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ClausLaunchTokenV1 } from "./ClausLaunchTokenV1.sol";
import { ClausQuoteFeeVaultV1 } from "./ClausQuoteFeeVaultV1.sol";

interface IClausBuyerRouterV1 {
    function msgSender() external view returns (address);
}

/// @notice Candidate immutable CLAUS-quote kernel. This source is not a production admission.
/// @dev Only an external read-only fee policy may evolve. It cannot access kernel storage,
///      move principal, change recipients, restart protection or veto a sale. No arbitrary
///      call, delegation or swap-forwarding path exists in this hook.
contract ClausQuoteHookV1 is BaseHook {
    using SafeCast for uint256;
    using SafeCast for int256;

    address public constant QUOTE = 0x1b54E762aa34CF6E28E9C082F2848e28E45DA6b8;
    address public constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    uint256 public constant PLATFORM_PPM = 3000;
    uint256 public constant MAX_TOTAL_PPM = 150_000;
    uint256 public constant DENOMINATOR = 1_000_000;
    uint256 public constant PROTECTION_SECONDS = 300;
    bytes32 public constant PROFILE_ID = keccak256("programmable.claus-quote.v1");

    ClausLaunchTokenV1 public immutable token;
    address public immutable initializer;
    address public immutable initialBuyer;
    address public immutable buyerRouter;
    bytes32 public immutable buyerRouterCodeHash;
    address public immutable feePolicy;
    bytes32 public immutable feePolicyCodeHash;
    uint24 public immutable fallbackBuyCreatorPpm;
    uint24 public immutable fallbackSellCreatorPpm;
    uint160 public immutable initialSqrtPriceX96;
    bool public immutable quoteIsCurrency0;
    ClausQuoteFeeVaultV1 public immutable feeVault;
    bool public initialized;
    mapping(address => uint256) public boughtDuringProtection;
    bytes32 private activeSwap;
    address private activeBuyer;
    uint24 private activeCreatorPpm;
    uint256 private expectedQuoteAmount;

    struct Config {
        ClausLaunchTokenV1 token;
        address initializer;
        address initialBuyer;
        address creatorFeeRecipient;
        address buyerRouter;
        bytes32 buyerRouterCodeHash;
        address feePolicy;
        bytes32 feePolicyCodeHash;
        uint24 fallbackBuyCreatorPpm;
        uint24 fallbackSellCreatorPpm;
        uint160 initialSqrtPriceX96;
    }

    error InvalidConfiguration();
    error UnexpectedPool();
    error InvalidSwap();
    error UnsupportedOpeningBuyer();
    error BuyerLimitExceeded();
    event QuoteFeesAccrued(
        bytes32 indexed poolId, address indexed sender, bool buy, uint256 grossQuote, uint256 platform, uint256 creator
    );

    constructor(IPoolManager manager, Config memory c) BaseHook(manager) {
        if (
            block.chainid != 1 || address(manager) != CANONICAL_POOL_MANAGER || QUOTE.code.length == 0
                || address(c.token).code.length == 0 || address(c.token) == QUOTE || c.initializer == address(0)
                || c.initialBuyer == address(0) || c.creatorFeeRecipient == address(0)
                || c.token.initializer() != c.initializer || c.token.poolManager() != address(manager)
                || c.buyerRouter.code.length == 0 || c.buyerRouter.codehash != c.buyerRouterCodeHash
                || c.initialSqrtPriceX96 == 0 || c.fallbackBuyCreatorPpm > MAX_TOTAL_PPM - PLATFORM_PPM
                || c.fallbackSellCreatorPpm > MAX_TOTAL_PPM - PLATFORM_PPM
                || (c.feePolicy != address(0)
                    && (c.feePolicy.code.length == 0 || c.feePolicy.codehash != c.feePolicyCodeHash))
        ) {
            revert InvalidConfiguration();
        }
        token = c.token;
        initializer = c.initializer;
        initialBuyer = c.initialBuyer;
        buyerRouter = c.buyerRouter;
        buyerRouterCodeHash = c.buyerRouterCodeHash;
        feePolicy = c.feePolicy;
        feePolicyCodeHash = c.feePolicyCodeHash;
        fallbackBuyCreatorPpm = c.fallbackBuyCreatorPpm;
        fallbackSellCreatorPpm = c.fallbackSellCreatorPpm;
        initialSqrtPriceX96 = c.initialSqrtPriceX96;
        quoteIsCurrency0 = QUOTE < address(c.token);
        feeVault = new ClausQuoteFeeVaultV1(manager, c.creatorFeeRecipient);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeInitialize = true;
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }

    function poolKey() public view returns (PoolKey memory) {
        return PoolKey(
            Currency.wrap(quoteIsCurrency0 ? QUOTE : address(token)),
            Currency.wrap(quoteIsCurrency0 ? address(token) : QUOTE),
            0,
            60,
            IHooks(address(this))
        );
    }

    /// @dev Receives at most 96 return bytes. Failure, oversized output or an out-of-cap
    ///      answer selects the immutable fallback; an optional policy never vetoes trading.
    function creatorFeePpm(bool buy) public view returns (uint24) {
        uint24 fallbackPpm = buy ? fallbackBuyCreatorPpm : fallbackSellCreatorPpm;
        address policy = feePolicy;
        if (policy == address(0) || policy.codehash != feePolicyCodeHash || gasleft() < 360_000) return fallbackPpm;
        bytes memory input = abi.encodeWithSignature("evaluate(bytes)", abi.encode(buy));
        bytes memory result = new bytes(96);
        bool ok;
        uint256 size;
        uint256 offset;
        uint256 length;
        uint256 value;
        assembly ("memory-safe") {
            ok := staticcall(300000, policy, add(input, 32), mload(input), add(result, 32), 96)
            size := returndatasize()
            offset := mload(add(result, 32))
            length := mload(add(result, 64))
            value := mload(add(result, 96))
        }
        if (!ok || size != 96 || offset != 32 || length != 32 || value > MAX_TOTAL_PPM - PLATFORM_PPM) {
            return fallbackPpm;
        }
        return uint24(value);
    }

    function quoteFees(uint256 amount, bool amountIsNet, bool buy)
        external
        view
        returns (uint256 gross, uint256 platform, uint256 creator)
    {
        return _fees(amount, amountIsNet, creatorFeePpm(buy));
    }

    function _fees(uint256 amount, bool amountIsNet, uint24 creatorPpm)
        private
        pure
        returns (uint256 gross, uint256 platform, uint256 creator)
    {
        uint256 rate = PLATFORM_PPM + creatorPpm;
        if (rate > MAX_TOTAL_PPM) revert InvalidConfiguration();
        gross = amount;
        if (amountIsNet) {
            // Below seven raw quote units, rounding a one-unit platform fee
            // would exceed the immutable 15% aggregate ceiling.
            uint256 lower = Math.max(amount, 7);
            uint256 upper = Math.max(lower, Math.mulDiv(amount, DENOMINATOR, DENOMINATOR - rate, Math.Rounding.Ceil));
            // The capped total increases by at most one raw unit when gross
            // increases by one. Every attainable, non-dust net has an exact preimage.
            while (lower < upper) {
                uint256 mid = lower + (upper - lower) / 2;
                if (mid - _totalFee(mid, rate) >= amount) upper = mid;
                else lower = mid + 1;
            }
            gross = lower;
        }
        uint256 total = _totalFee(gross, rate);
        platform = Math.mulDiv(gross, PLATFORM_PPM, DENOMINATOR, Math.Rounding.Ceil);
        // Reject dust that cannot pay the rounded platform fee within the hard
        // aggregate cap. Never underflow the creator bucket or silently waive it.
        if (platform > total || total >= gross || (amountIsNet && gross - total != amount)) revert InvalidSwap();
        creator = total - platform;
    }

    function _totalFee(uint256 gross, uint256 rate) private pure returns (uint256) {
        return Math.min(
            Math.mulDiv(gross, rate, DENOMINATOR, Math.Rounding.Ceil), Math.mulDiv(gross, MAX_TOTAL_PPM, DENOMINATOR)
        );
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160 price) internal override returns (bytes4) {
        _requirePool(key);
        if (initialized || sender != initializer || price != initialSqrtPriceX96) revert InvalidConfiguration();
        initialized = true;
        return IHooks.beforeInitialize.selector;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata p, bytes calldata data)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _requirePool(key);
        if (!initialized || activeSwap != bytes32(0) || p.amountSpecified == 0) revert InvalidSwap();
        activeSwap = keccak256(abi.encode(sender, key, p, data));
        bool buy = p.zeroForOne == quoteIsCurrency0;
        if (buy && block.timestamp < token.startedAt() + PROTECTION_SECONDS) {
            if (sender == initializer) {
                activeBuyer = initialBuyer;
            } else {
                if (sender != buyerRouter || sender.codehash != buyerRouterCodeHash) revert UnsupportedOpeningBuyer();
                activeBuyer = IClausBuyerRouterV1(sender).msgSender();
                if (
                    activeBuyer == address(0) || activeBuyer == buyerRouter || activeBuyer == address(this)
                        || activeBuyer == address(poolManager) || activeBuyer == initializer
                ) revert UnsupportedOpeningBuyer();
            }
        }
        activeCreatorPpm = creatorFeePpm(buy);
        bool quoteSpecified = buy == (p.amountSpecified < 0);
        if (!quoteSpecified) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        uint256 amount = _abs(p.amountSpecified);
        (uint256 gross, uint256 platform, uint256 creator) = _fees(amount, p.amountSpecified > 0, activeCreatorPpm);
        uint256 total = platform + creator;
        if (p.amountSpecified < 0 && total >= amount) revert InvalidSwap();
        expectedQuoteAmount = p.amountSpecified > 0 ? gross : amount - total;
        if (expectedQuoteAmount == 0) revert InvalidSwap();
        _accrue(sender, key, buy, gross, platform, creator);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(total.toInt256().toInt128(), 0), 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata p,
        BalanceDelta delta,
        bytes calldata data
    ) internal override returns (bytes4, int128) {
        _requirePool(key);
        if (activeSwap != keccak256(abi.encode(sender, key, p, data))) revert InvalidSwap();
        return _settleSwap(sender, key, p, delta);
    }

    function _settleSwap(address sender, PoolKey calldata key, SwapParams calldata p, BalanceDelta delta)
        private
        returns (bytes4, int128)
    {
        int128 tokenDelta = quoteIsCurrency0 ? delta.amount1() : delta.amount0();
        uint256 quoteAmount = _abs(int256(quoteIsCurrency0 ? delta.amount0() : delta.amount1()));
        if (quoteAmount == 0 || tokenDelta == 0) revert InvalidSwap();
        bool buy = p.zeroForOne == quoteIsCurrency0;
        uint256 total;
        if (buy == (p.amountSpecified < 0)) {
            if (quoteAmount != expectedQuoteAmount) revert InvalidSwap();
        } else {
            total = _afterSwapFee(sender, key, buy, quoteAmount, p.amountSpecified > 0);
        }
        if (activeBuyer != address(0)) {
            if (tokenDelta <= 0) revert InvalidSwap();
            uint256 bought = boughtDuringProtection[activeBuyer] + uint256(uint128(tokenDelta));
            if (bought > token.walletTokenLimit()) revert BuyerLimitExceeded();
            boughtDuringProtection[activeBuyer] = bought;
        }
        activeBuyer = address(0);
        activeCreatorPpm = 0;
        expectedQuoteAmount = 0;
        activeSwap = bytes32(0);
        return (IHooks.afterSwap.selector, total.toInt256().toInt128());
    }

    function _afterSwapFee(address sender, PoolKey calldata key, bool buy, uint256 quoteAmount, bool exactOutput)
        private
        returns (uint256 total)
    {
        (uint256 gross, uint256 platform, uint256 creator) = _fees(quoteAmount, exactOutput, activeCreatorPpm);
        total = platform + creator;
        if (!exactOutput && total >= quoteAmount) revert InvalidSwap();
        _accrue(sender, key, buy, gross, platform, creator);
    }

    function _requirePool(PoolKey calldata key) private view {
        PoolKey memory expected = poolKey();
        if (
            Currency.unwrap(key.currency0) != Currency.unwrap(expected.currency0)
                || Currency.unwrap(key.currency1) != Currency.unwrap(expected.currency1)
                || address(key.hooks) != address(this) || key.fee != 0 || key.tickSpacing != 60
        ) revert UnexpectedPool();
    }

    function _accrue(address sender, PoolKey calldata key, bool buy, uint256 gross, uint256 platform, uint256 creator)
        private
    {
        poolManager.mint(address(feeVault), uint256(uint160(QUOTE)), platform + creator);
        feeVault.recordFees(platform, creator);
        emit QuoteFeesAccrued(keccak256(abi.encode(key)), sender, buy, gross, platform, creator);
    }

    function _abs(int256 amount) private pure returns (uint256) {
        if (amount == type(int256).min) revert InvalidSwap();
        return uint256(amount < 0 ? -amount : amount);
    }
}
