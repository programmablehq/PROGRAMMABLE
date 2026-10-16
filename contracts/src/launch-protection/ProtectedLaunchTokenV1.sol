// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed supply and a cumulative two-percent receiving budget for the opening five minutes.
/// @dev Selling, burning and forwarding tokens do not refill the budget. No EOA or contract is whitelisted.
contract ProtectedLaunchTokenV1 is ERC20 {
    uint256 public constant POLICY_REVISION = 2;
    uint256 public constant WALLET_LIMIT_BPS = 200;
    uint256 public constant PROTECTION_SECONDS = 300;
    address public immutable initializer;
    address public immutable poolManager;
    uint256 public immutable launchSupply;
    uint256 public immutable walletTokenLimit;
    uint256 public startedAt;
    mapping(address => uint256) public receivedDuringProtection;

    error InvalidConfiguration();
    error NotInitializer();
    error AlreadyStarted();
    error TradingNotStarted();
    error WalletLimitExceeded(address recipient, uint256 attempted, uint256 limit);

    constructor(string memory name_, string memory symbol_, uint256 supply_, address initializer_, address manager_)
        ERC20(name_, symbol_)
    {
        if (
            bytes(name_).length == 0 || bytes(symbol_).length == 0 || supply_ < 50
                || supply_ > uint256(uint128(type(int128).max)) || initializer_ == address(0)
                || manager_.code.length == 0 || initializer_ == manager_
        ) revert InvalidConfiguration();
        initializer = initializer_;
        poolManager = manager_;
        launchSupply = supply_;
        walletTokenLimit = supply_ * WALLET_LIMIT_BPS / 10_000;
        _mint(initializer_, supply_);
    }

    function start() external {
        if (msg.sender != initializer) revert NotInitializer();
        if (startedAt != 0) revert AlreadyStarted();
        if (block.timestamp == 0) revert InvalidConfiguration();
        startedAt = block.timestamp;
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0) && amount != 0) {
            if (startedAt == 0) {
                // Only seed settlement may move inventory before the atomic start.
                if (from != initializer || to != poolManager) revert TradingNotStarted();
            } else if (block.timestamp < startedAt + PROTECTION_SECONDS && to != poolManager) {
                // Self-transfers cannot mint headroom, and should not consume it either.
                if (from != to) {
                    uint256 received = receivedDuringProtection[to] + amount;
                    if (received > walletTokenLimit) revert WalletLimitExceeded(to, received, walletTokenLimit);
                    receivedDuringProtection[to] = received;
                }
            }
        }
        super._update(from, to, amount);
    }
}
