// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";

/// @notice Per-trade fees with a hard effective cap. No rounding debt is imposed on another trade.
library CustomAIFeeMathV1 {
    struct Fees {
        uint256 platform;
        uint256 additional;
        uint256 net;
    }

    error InvalidAmount();
    error FeeCapExceeded();

    function fromGross(uint256 gross, uint16 additionalBps) internal pure returns (Fees memory fees) {
        _validate(gross, additionalBps);
        uint256 total = gross * (T.PLATFORM_BPS + additionalBps) / T.BPS;
        fees.platform = gross * T.PLATFORM_BPS / T.BPS;
        fees.additional = total - fees.platform;
        fees.net = gross - total;
    }

    /// @notice Smallest gross that yields exactly net after the single total-fee floor.
    function fromNet(uint256 net, uint16 additionalBps) internal pure returns (uint256 gross, Fees memory fees) {
        _validate(net, additionalBps);
        // net(gross) = ceil(gross * (BPS - totalBps) / BPS).
        gross = (net - 1) * T.BPS / (T.BPS - T.PLATFORM_BPS - additionalBps) + 1;
        fees = fromGross(gross, additionalBps);
    }

    function _validate(uint256 amount, uint16 additionalBps) private pure {
        if (amount == 0 || amount > T.MAX_AMOUNT) revert InvalidAmount();
        if (additionalBps > T.MAX_ADDITIONAL_BPS) revert FeeCapExceeded();
    }
}
