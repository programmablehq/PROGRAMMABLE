// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { CustomAILiquidityV1 as L } from "./CustomAILiquidityV1.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
import { CustomAITransfersV1 as X } from "./CustomAITransfersV1.sol";

/// @notice Permanent direct Core position custody. One positive mint, no remove/collect/approval/upgrade functions.
/// @dev Uses the existing one-sided Module Mode range, without an intermediate transferable position NFT.
contract CustomAILiquidityVaultV1 is IUnlockCallback {
    IPoolManager public immutable poolManager;
    address public immutable factory;
    address public immutable token;
    bytes32 public poolId;
    L.Position public position;
    bool public initialized;
    bytes32 private _context;

    error Unauthorized();
    error InvalidSettlement();

    constructor(IPoolManager manager, address factory_, address token_) {
        poolManager = manager;
        factory = factory_;
        token = token_;
    }

    /// @dev All supply must arrive in the same factory transaction; at most the computed principal enters Core.
    function initialize(PoolKey calldata key, int24 tick) external returns (L.Position memory p) {
        if (msg.sender != factory || initialized) revert Unauthorized();
        bool token0 = Currency.unwrap(key.currency0) == token;
        if (
            (!token0 && Currency.unwrap(key.currency1) != token) || key.fee != T.LP_FEE
                || key.tickSpacing != T.TICK_SPACING || IERC20(token).balanceOf(address(this)) != T.TOKEN_SUPPLY
        ) {
            revert InvalidSettlement();
        }
        initialized = true;
        poolId = PoolId.unwrap(PoolIdLibrary.toId(key));
        p = L.plan(token0, tick);
        position = p;
        bytes memory data = abi.encode(key, p, token0);
        _context = keccak256(data);
        poolManager.unlock(data);
        if (_context != 0 || IERC20(token).balanceOf(address(this)) != p.tokenRounding) revert InvalidSettlement();
        if (p.tokenRounding != 0) X.push(IERC20(token), T.LP_RECIPIENT, p.tokenRounding);
        if (IERC20(token).balanceOf(address(this)) != 0) revert InvalidSettlement();
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || _context == 0 || keccak256(data) != _context) revert Unauthorized();
        _context = 0;
        (PoolKey memory key, L.Position memory p, bool token0) = abi.decode(data, (PoolKey, L.Position, bool));
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key, ModifyLiquidityParams(p.lower, p.upper, int256(uint256(p.liquidity)), bytes32(0)), bytes("")
        );
        int128 tokenDelta = token0 ? delta.amount0() : delta.amount1();
        int128 quoteDelta = token0 ? delta.amount1() : delta.amount0();
        if (tokenDelta != -int128(p.tokenPrincipal) || quoteDelta != 0) revert InvalidSettlement();
        poolManager.sync(Currency.wrap(token));
        X.push(IERC20(token), address(poolManager), p.tokenPrincipal);
        if (poolManager.settle() != p.tokenPrincipal) revert InvalidSettlement();
        return bytes("");
    }
}
