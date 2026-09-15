// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Versioned, product-independent launch and module ABI. Asset amounts are raw ERC20 units.
library FoundationTypesV1 {
    uint256 internal constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint16 internal constant PLATFORM_BPS = 30;
    address internal constant PLATFORM_RECIPIENT = 0xD88539d3c4C460136a733A3Fd60cf6BF269079da;
    uint16 internal constant MAX_CREATOR_BPS = 1000;
    int24 internal constant TICK_SPACING = 60;
    uint24 internal constant LP_FEE = 0;
    uint8 internal constant MAX_MODULES = 8;
    uint8 internal constant BEFORE_SWAP = 1;
    uint8 internal constant AFTER_SWAP = 2;
    uint8 internal constant ACTION = 4;
    uint8 internal constant OWN_QUOTE_BUDGET = 1;
    bytes32 internal constant ABI_ID = keccak256("programmable.module-foundation.v1");

    struct Metadata {
        string name;
        string symbol;
        string description;
        string imageURI;
        string website;
        bytes socialData;
    }

    /// @dev A reviewed factory must deploy a fresh, non-upgradeable instance bound to this launch host.
    /// Descriptor/hash plus instance runtime are committed at construction. No registry update mutates a live host.
    struct ModuleSelection {
        address factory;
        bytes32 factoryCodeHash;
        bytes32 moduleCodeHash;
        bytes32 descriptorHash;
        bytes configuration;
        uint16 creatorShareBps;
    }

    struct Descriptor {
        bytes32 moduleId;
        uint16 abiVersion;
        uint8 phases;
        uint8 resources;
        uint32 beforeGas;
        uint32 afterGas;
        uint32 actionGas;
        bool failOpenAfter;
        bytes32 exclusiveGroup;
    }

    struct ModuleContext {
        address host;
        address token;
        address quote;
        address creator;
        address ledger;
        bytes32 poolId;
    }

    struct SwapContext {
        bytes32 poolId;
        address router;
        bool buy;
        bool exactInput;
        uint256 specifiedAmount;
        uint256 grossQuote;
        int128 coreAmount0;
        int128 coreAmount1;
    }

    struct LaunchParams {
        Metadata metadata;
        address quote;
        uint8 quoteDecimals;
        int24 initialTick;
        uint16 creatorFeeBps;
        uint128 additionalQuoteAmount;
        uint128 initialBuyQuoteAmount;
        uint128 initialBuyMinimumTokenAmount;
        uint64 deadline;
        bytes32 tokenSalt;
        bytes32 hookSalt;
        ModuleSelection[] modules;
    }

    struct LaunchResult {
        address token;
        address hook;
        address ledger;
        bytes32 poolId;
        address baseVault;
        uint256 basePositionId;
        uint256 creatorPositionId;
        uint256 initialBuyTokenAmount;
    }
}
