// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface FixtureERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @dev Trusted adapter for the isolated EVM only. It is not a published trading
/// route, a wallet transaction, a fee policy or a claim about live compatibility.
contract GeneralProtectedV4Fixture is IUnlockCallback {
    IPoolManager public immutable manager;
    bytes32 public immutable managerRuntimeHash;
    bytes32 private context;
    bool private executing;
    address private authenticatedPayer;

    /// @dev Matches the router identity query used by the original protection module.
    function msgSender() external view returns (address) {
        return executing ? authenticatedPayer : address(0);
    }

    error FixtureExecution();

    constructor(IPoolManager manager_) {
        if (address(manager_).code.length == 0) revert FixtureExecution();
        manager = manager_;
        managerRuntimeHash = address(manager_).codehash;
    }

    function deploy(bytes calldata creation, bytes32 salt) external returns (address deployed) {
        bytes memory code = creation;
        assembly ("memory-safe") { deployed := create2(0, add(code, 32), mload(code), salt) }
        if (deployed == address(0) || deployed.code.length == 0) revert FixtureExecution();
    }

    function initialize(PoolKey calldata key, uint160 sqrtPriceX96) external returns (int24) {
        return manager.initialize(key, sqrtPriceX96);
    }

    function liquidity(PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata hookData)
        external
        payable
        returns (int256 delta)
    {
        bytes memory data = abi.encode(uint8(0), msg.sender, key, abi.encode(params), hookData);
        delta = _unlock(data);
    }

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        payable
        returns (int256 delta)
    {
        bytes memory data = abi.encode(uint8(1), msg.sender, key, abi.encode(params), hookData);
        delta = _unlock(data);
    }

    function _unlock(bytes memory data) private returns (int256 delta) {
        if (executing || context != 0 || address(manager).codehash != managerRuntimeHash) revert FixtureExecution();
        executing = true;
        authenticatedPayer = msg.sender;
        context = keccak256(data);
        uint256 previous = address(this).balance - msg.value;
        delta = abi.decode(manager.unlock(data), (int256));
        if (context != 0 || address(this).balance < previous) revert FixtureExecution();
        uint256 refund = address(this).balance - previous;
        if (refund != 0) {
            (bool sent,) = msg.sender.call{value: refund}("");
            if (!sent) revert FixtureExecution();
        }
        authenticatedPayer = address(0);
        executing = false;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (
            msg.sender != address(manager) || msg.sender.codehash != managerRuntimeHash || context == 0
                || keccak256(data) != context
        ) revert FixtureExecution();
        context = 0;
        (uint8 operation, address payer, PoolKey memory key, bytes memory params, bytes memory hookData) =
            abi.decode(data, (uint8, address, PoolKey, bytes, bytes));
        BalanceDelta delta;
        if (operation == 0) {
            (delta,) = manager.modifyLiquidity(key, abi.decode(params, (ModifyLiquidityParams)), hookData);
        } else if (operation == 1) {
            delta = manager.swap(key, abi.decode(params, (SwapParams)), hookData);
        } else {
            revert FixtureExecution();
        }
        _settle(key.currency0, delta.amount0(), payer);
        _settle(key.currency1, delta.amount1(), payer);
        return abi.encode(BalanceDelta.unwrap(delta));
    }

    function _settle(Currency currency, int128 delta, address payer) private {
        if (delta < 0) {
            uint256 debt = uint256(-int256(delta));
            if (Currency.unwrap(currency) == address(0)) {
                if (manager.settle{value: debt}() != debt) revert FixtureExecution();
            } else {
                manager.sync(currency);
                if (!FixtureERC20(Currency.unwrap(currency)).transferFrom(payer, address(manager), debt)) {
                    revert FixtureExecution();
                }
                if (manager.settle() != debt) revert FixtureExecution();
            }
        } else if (delta > 0) {
            manager.take(currency, payer, uint256(int256(delta)));
        }
    }

    receive() external payable {
        if (msg.sender != address(manager)) revert FixtureExecution();
    }
}


/// @dev Deliberately synthetic, immutable data for isolated scenarios only.
contract GeneralProtectedUsdFeedFixture {
    uint8 public immutable decimals;
    int256 private immutable answer;
    uint256 private immutable updated;
    uint256 private immutable started;

    constructor(uint8 precision, int256 price, uint256 updatedAt, uint256 startedAt) {
        require(precision <= 18 && price >= 0 && updatedAt > 0 && startedAt > 0);
        decimals = precision;
        answer = price;
        updated = updatedAt;
        started = startedAt;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, started, updated, 1);
    }
}
