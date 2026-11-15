// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @notice Immutable 80% V4 buybacks and 20% ETH payments to the fixed team wallet.
/// @dev Fee deposits do not depend on market liquidity. A quote signer authorizes only
///      bounded V4 purchases; it cannot withdraw funds, change routes or change recipients.
contract RobinhoodPlatformFeeRouterV1 is EIP712, ReentrancyGuardTransient, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    uint256 public constant SUPPORTED_CHAIN_ID = 4663;
    uint16 public constant BUYBACK_SHARE_BPS = 8000;
    uint16 public constant BASIS_POINTS = 10_000;
    address public constant TEAM_WALLET = 0x9F5856A3578Faba96A6E8Dfd9C10563A1E598f62;
    address public constant V4_TOKEN = 0xC60bA256B44334A0Cd2C7242E98B88f031abB006;
    address public constant MAIN_HOOK = 0x720e649549F7BC2118aCBA9F4C9ae6fCC7586080;
    IPoolManager public constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    bytes32 public constant MAIN_POOL_ID = 0x3df16f271060e4941c0386047def159f42e629dc0455db623c5b363eeacbcc1d;
    bytes32 public constant POLICY_ID = keccak256("programmable.automatic-platform-fees.v1");
    bytes32 private constant MANAGER_HASH = 0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626;
    bytes32 private constant HOOK_HASH = 0xf3d3f472aa61c1a3bafd8e104c422feb8419adc6838472382b75c81f7f0de106;
    bytes32 private constant TOKEN_HASH = 0x3a59d82f4d4bce7c9f370476a284e1ef549ed3d20a3b9ec7af5560011c9c1458;
    bytes32 private constant ORDER_TYPEHASH = keccak256(
        "BuybackOrder(uint256 nonce,uint128 amountIn,uint128 minimumOut,uint160 sqrtPriceLimitX96,uint64 validAfter,uint64 deadline)"
    );
    uint256 public constant MAX_BUYBACK_AMOUNT = 0.01 ether;
    uint256 public constant MAX_ORDER_LIFETIME = 5 minutes;
    uint256 public constant MAX_NATIVE_PAYOUT_GAS = 50_000;
    address public immutable quoteSigner;

    struct BuybackOrder {
        uint256 nonce;
        uint128 amountIn;
        uint128 minimumOut;
        uint160 sqrtPriceLimitX96;
        uint64 validAfter;
        uint64 deadline;
    }

    uint256 public buybackReserve;
    uint256 public nativeReserve;
    uint256 public totalRevenue;
    uint256 public totalNativePaid;
    uint256 public totalNativeBought;
    uint256 public totalV4Delivered;
    uint256 public nextNonce;
    bytes32 private activeOrder;

    error InvalidConfiguration();
    error InvalidOrder();
    error UnauthorizedCallback();
    error InvalidSettlement();
    event RevenueReceived(address indexed source, uint256 amount, uint256 buybackAmount, uint256 nativeAmount);
    event NativePaid(uint256 amount);
    event NativePayoutDeferred(uint256 amount);
    event BuybackExecuted(uint256 indexed nonce, uint256 amountIn, uint256 tokensDelivered);

    constructor(address quoteSigner_) EIP712("Programmable Platform Buybacks", "1") {
        if (block.chainid != SUPPORTED_CHAIN_ID || quoteSigner_ == address(0)) revert InvalidConfiguration();
        quoteSigner = quoteSigner_;
        _requireInfrastructure();
        if (PoolId.unwrap(mainPoolKey().toId()) != MAIN_POOL_ID) revert InvalidConfiguration();
    }

    receive() external payable nonReentrant {
        // Cumulative rounding makes splitting a payment into dust transfers unable to skew the 80/20 policy.
        uint256 oldAllocated = totalRevenue * BUYBACK_SHARE_BPS / BASIS_POINTS;
        totalRevenue += msg.value;
        uint256 buybackAmount = totalRevenue * BUYBACK_SHARE_BPS / BASIS_POINTS - oldAllocated;
        uint256 nativeAmount = msg.value - buybackAmount;
        buybackReserve += buybackAmount;
        nativeReserve += nativeAmount;
        emit RevenueReceived(msg.sender, msg.value, buybackAmount, nativeAmount);
        _payNative();
    }

    /// @notice Retry an ETH payout to the same wallet; no caller-selected destination.
    function payNative() external nonReentrant {
        _payNative();
    }

    function _payNative() private {
        uint256 amount = nativeReserve;
        if (amount == 0) return;
        nativeReserve = 0;
        (bool paid,) = TEAM_WALLET.call{ value: amount, gas: MAX_NATIVE_PAYOUT_GAS }("");
        if (paid) {
            totalNativePaid += amount;
            emit NativePaid(amount);
        } else {
            nativeReserve = amount;
            emit NativePayoutDeferred(amount);
        }
    }

    function mainPoolKey() public pure returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(V4_TOKEN), 0x800000, 60, IHooks(MAIN_HOOK));
    }

    function orderDigest(BuybackOrder calldata order) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ORDER_TYPEHASH,
                    order.nonce,
                    order.amountIn,
                    order.minimumOut,
                    order.sqrtPriceLimitX96,
                    order.validAfter,
                    order.deadline
                )
            )
        );
    }

    /// @notice Anyone may submit a fresh price-bound order; gas never comes out of the 80/20 allocation.
    function executeBuyback(BuybackOrder calldata order, bytes calldata signature)
        external
        nonReentrant
        returns (uint256 delivered)
    {
        if (
            order.nonce != nextNonce || order.amountIn == 0 || order.amountIn > MAX_BUYBACK_AMOUNT
                || order.amountIn > buybackReserve || order.minimumOut == 0 || order.validAfter > block.timestamp
                || order.deadline < block.timestamp || order.deadline < order.validAfter
                || order.deadline - order.validAfter > MAX_ORDER_LIFETIME
                || order.sqrtPriceLimitX96 <= TickMath.MIN_SQRT_PRICE
                || order.sqrtPriceLimitX96 >= TickMath.MAX_SQRT_PRICE
                || ECDSA.recover(orderDigest(order), signature) != quoteSigner
        ) revert InvalidOrder();
        _requireInfrastructure();
        uint256 beforeBalance = IERC20(V4_TOKEN).balanceOf(TEAM_WALLET);
        buybackReserve -= order.amountIn;
        ++nextNonce;
        bytes memory data = abi.encode(order);
        activeOrder = keccak256(data);
        POOL_MANAGER.unlock(data);
        if (activeOrder != bytes32(0)) revert InvalidSettlement();
        delivered = IERC20(V4_TOKEN).balanceOf(TEAM_WALLET) - beforeBalance;
        if (delivered < order.minimumOut) revert InvalidSettlement();
        totalNativeBought += order.amountIn;
        totalV4Delivered += delivered;
        emit BuybackExecuted(order.nonce, order.amountIn, delivered);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER) || activeOrder == bytes32(0) || keccak256(data) != activeOrder) {
            revert UnauthorizedCallback();
        }
        activeOrder = bytes32(0);
        BuybackOrder memory order = abi.decode(data, (BuybackOrder));
        BalanceDelta delta = POOL_MANAGER.swap(
            mainPoolKey(), SwapParams(true, -int256(uint256(order.amountIn)), order.sqrtPriceLimitX96), ""
        );
        if (
            int256(delta.amount0()) != -int256(uint256(order.amountIn)) || delta.amount1() <= 0
                || uint256(uint128(delta.amount1())) < order.minimumOut
        ) revert InvalidSettlement();
        POOL_MANAGER.sync(Currency.wrap(address(0)));
        if (POOL_MANAGER.settle{ value: order.amountIn }() != order.amountIn) revert InvalidSettlement();
        POOL_MANAGER.take(Currency.wrap(V4_TOKEN), TEAM_WALLET, uint256(uint128(delta.amount1())));
        return "";
    }

    /// @notice Forced ETH is not spendable through buyback orders and can only reach the team.
    function forwardUnallocatedNative() external nonReentrant {
        uint256 extra = address(this).balance - buybackReserve - nativeReserve;
        if (extra == 0) return;
        (bool paid,) = TEAM_WALLET.call{ value: extra, gas: MAX_NATIVE_PAYOUT_GAS }("");
        if (!paid) revert InvalidSettlement();
    }

    function _requireInfrastructure() private view {
        if (
            address(POOL_MANAGER).codehash != MANAGER_HASH || MAIN_HOOK.codehash != HOOK_HASH
                || V4_TOKEN.codehash != TOKEN_HASH
        ) revert InvalidConfiguration();
    }
}
