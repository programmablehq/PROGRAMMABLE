// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Fixed rules for Custom AI V1. Existing Module Mode profiles are independent.
library CustomAITypesV1 {
    bytes32 internal constant VERSION_ID = keccak256("programmable.custom-ai.core.v1");
    uint256 internal constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant START_FDV_USD_E18 = 15_000 ether;
    uint256 internal constant MIN_INITIAL_BUY_ETH = 0.01 ether;
    uint16 internal constant BPS = 10_000;
    uint16 internal constant PLATFORM_BPS = 50;
    uint16 internal constant MAX_TOTAL_BPS = 1500;
    uint16 internal constant MAX_ADDITIONAL_BPS = MAX_TOTAL_BPS - PLATFORM_BPS;
    address internal constant PLATFORM_RECIPIENT = 0xD88539d3c4C460136a733A3Fd60cf6BF269079da;
    address internal constant LP_RECIPIENT = 0x000000000000000000000000000000000000dEaD;
    int24 internal constant TICK_SPACING = 60;
    uint24 internal constant LP_FEE = 0;
    uint256 internal constant MAX_AMOUNT = uint256(uint128(type(int128).max));

    struct Metadata {
        string name;
        string symbol;
        string description;
        string imageURI;
        string website;
        bytes socialData;
    }

    struct ModuleBinding {
        address instance;
        bytes32 runtimeHash;
        bytes32 configurationHash;
    }

    struct Rewards {
        address creatorRecipient;
        uint16 creatorShareBps;
        ModuleBinding module;
    }

    struct LaunchParams {
        Metadata metadata;
        address quote;
        uint8 quoteDecimals;
        int24 initialTick;
        bytes32 launchSalt;
        bytes32 hookSalt;
        ModuleBinding feeModule;
        Rewards rewards;
        uint128 initialBuyQuote;
        uint128 minimumBuyTokens;
        uint16 maximumFeeBps;
        uint64 deadline;
    }

    struct Price {
        uint256 quoteUsdE18;
        uint256 ethUsdE18;
        uint64 observedAt;
        uint64 validUntil;
    }

    struct LaunchResult {
        bytes32 planHash;
        bytes32 poolId;
        address token;
        address hook;
        address ledger;
        address rewardVault;
        address liquidityVault;
        uint128 liquidity;
        uint128 tokenPrincipal;
        uint128 tokenRounding;
        uint256 initialBuyTokens;
    }

    /// @dev router is the authenticated PoolManager callback sender, not an inferred end user.
    struct SwapContext {
        bytes32 poolId;
        address router;
        uint64 launchTimestamp;
        bool buy;
        bool exactInput;
        uint256 specifiedAmount;
    }
}
