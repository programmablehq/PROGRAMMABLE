// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { CustomAITransfersV1 as X } from "./CustomAITransfersV1.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";

/// @notice Full-fill ERC20 swaps with caller-only funding, explicit price/fee limits and no residual custody.
contract CustomAISwapRouterV1 is ReentrancyGuardTransient, IUnlockCallback {
    IPoolManager public immutable poolManager;
    bytes32 public immutable managerCodeHash;
    bytes32 private _context;

    event SwapSettled(address indexed payer, address indexed recipient, address indexed input, address output, uint256 paid, uint256 received);

    error InvalidSwap();
    error DeadlineExpired();
    error Unauthorized();
    error SlippageExceeded();
    error InvalidSettlement();

    struct Order {
        address payer;
        address recipient;
        PoolKey key;
        SwapParams params;
        uint256 limit;
        uint16 maxFeeBps;
    }

    constructor(IPoolManager manager) {
        if (address(manager).code.length == 0) revert InvalidSwap();
        poolManager = manager;
        managerCodeHash = address(manager).codehash;
    }

    /// @param limit Minimum received for exact input; maximum paid for exact output. Fees are included.
    function swap(
        PoolKey calldata key,
        SwapParams calldata params,
        uint256 limit,
        uint16 maxFeeBps,
        address recipient,
        uint64 deadline
    ) external nonReentrant returns (uint256 paid, uint256 received) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (
            address(poolManager).codehash != managerCodeHash || recipient == address(0) || recipient == address(this)
                || recipient == address(poolManager) || Currency.unwrap(key.currency0).code.length == 0
                || Currency.unwrap(key.currency1).code.length == 0 || params.amountSpecified == 0
                || params.amountSpecified > int256(T.MAX_AMOUNT) || params.amountSpecified < -int256(T.MAX_AMOUNT)
                || maxFeeBps < T.PLATFORM_BPS || maxFeeBps > T.MAX_TOTAL_BPS
        ) revert InvalidSwap();
        bytes memory data = abi.encode(Order(msg.sender, recipient, key, params, limit, maxFeeBps));
        _context = keccak256(data);
        (paid, received) = abi.decode(poolManager.unlock(data), (uint256, uint256));
        if (_context != 0) revert Unauthorized();
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (
            msg.sender != address(poolManager) || !_reentrancyGuardEntered() || _context == 0
                || keccak256(data) != _context
        ) revert Unauthorized();
        _context = 0;
        Order memory o = abi.decode(data, (Order));
        BalanceDelta delta = poolManager.swap(o.key, o.params, abi.encode(o.maxFeeBps));
        int128 inputDelta = o.params.zeroForOne ? delta.amount0() : delta.amount1();
        int128 outputDelta = o.params.zeroForOne ? delta.amount1() : delta.amount0();
        if (inputDelta >= 0 || outputDelta <= 0) revert InvalidSettlement();
        uint256 paid = uint256(-int256(inputDelta));
        uint256 received = uint256(int256(outputDelta));
        if (o.params.amountSpecified < 0) {
            if (paid != uint256(-o.params.amountSpecified) || received < o.limit) revert SlippageExceeded();
        } else if (received != uint256(o.params.amountSpecified) || paid > o.limit) {
            revert SlippageExceeded();
        }
        Currency input = o.params.zeroForOne ? o.key.currency0 : o.key.currency1;
        Currency output = o.params.zeroForOne ? o.key.currency1 : o.key.currency0;
        poolManager.sync(input);
        X.pull(IERC20(Currency.unwrap(input)), o.payer, address(poolManager), paid);
        if (poolManager.settle() != paid) revert InvalidSettlement();
        IERC20 outAsset = IERC20(Currency.unwrap(output));
        uint256 beforeRecipient = outAsset.balanceOf(o.recipient);
        uint256 beforeManager = outAsset.balanceOf(address(poolManager));
        poolManager.take(output, o.recipient, received);
        if (
            outAsset.balanceOf(o.recipient) != beforeRecipient + received
                || outAsset.balanceOf(address(poolManager)) != beforeManager - received
        ) revert InvalidSettlement();
        emit SwapSettled(o.payer, o.recipient, Currency.unwrap(input), Currency.unwrap(output), paid, received);
        return abi.encode(paid, received);
    }
}
