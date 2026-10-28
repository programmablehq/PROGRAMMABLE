// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import { CustomAIFactoryV1 } from "./CustomAIFactoryV1.sol";

library CustomAIProgramTypesV1 {
    struct Action {
        bytes32 id;
        uint8 kind;
        uint16 shareBps;
        address recipient;
        uint128 maximumBatch;
        uint256 minimumTokensPerQuote;
        uint16 deviation;
        uint64 interval;
        uint64 maxPriceAge;
        uint32 minimumObservations;
        uint64 minimumHistory;
    }

    struct Launch {
        CustomAIFactoryV1 factory;
        address creator;
        bytes32 launchSalt;
        address quote;
        uint8 quoteDecimals;
        bytes32 ruleSpecHash;
        Action[] actions;
    }
}
