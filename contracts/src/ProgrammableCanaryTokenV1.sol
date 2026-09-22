// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ProgrammableCanaryTokenV1
/// @notice Fixed-supply, non-upgradeable ERC-20 used only for the first low-value stamped Mainnet canary.
/// @dev The complete supply is minted once to the explicitly configured liquidity initializer. The initializer
///      atomically places the reviewed budget into Uniswap v4 and returns any token dust to `launchWallet`.
///      There is no owner, administrator, pause, blacklist, tax, proxy, or second mint path.
contract ProgrammableCanaryTokenV1 is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000 ether;
    uint256 public constant MAX_NAME_BYTES = 48;
    uint256 public constant MAX_SYMBOL_BYTES = 12;

    address public immutable launchWallet;
    address public immutable liquidityInitializer;
    bytes32 public immutable configurationHash;

    error EmptyName();
    error EmptySymbol();
    error NameTooLong(uint256 actual, uint256 maximum);
    error SymbolTooLong(uint256 actual, uint256 maximum);
    error ZeroAddress();

    constructor(string memory name_, string memory symbol_, address launchWallet_, address liquidityInitializer_)
        ERC20(name_, symbol_)
    {
        uint256 nameLength = bytes(name_).length;
        uint256 symbolLength = bytes(symbol_).length;
        if (nameLength == 0) revert EmptyName();
        if (symbolLength == 0) revert EmptySymbol();
        if (nameLength > MAX_NAME_BYTES) revert NameTooLong(nameLength, MAX_NAME_BYTES);
        if (symbolLength > MAX_SYMBOL_BYTES) revert SymbolTooLong(symbolLength, MAX_SYMBOL_BYTES);
        if (launchWallet_ == address(0) || liquidityInitializer_ == address(0)) revert ZeroAddress();

        launchWallet = launchWallet_;
        liquidityInitializer = liquidityInitializer_;
        configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                keccak256(bytes(name_)),
                keccak256(bytes(symbol_)),
                TOTAL_SUPPLY,
                launchWallet_,
                liquidityInitializer_
            )
        );

        _mint(liquidityInitializer_, TOTAL_SUPPLY);
    }
}
