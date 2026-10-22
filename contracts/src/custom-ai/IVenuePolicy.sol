// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.26;

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice URC-5 interface pinned to Uniswap/URCs 02b9ab1d2176917f1098eaae300c607da71a78b1.
interface IVenuePolicy {
    enum VenueEnforcement {
        Preferred,
        Enforced
    }

    struct ExternalVenue {
        address venue;
        bool inbound;
        bool outbound;
    }

    event VenueEnforcementChanged(VenueEnforcement enforcement);
    event CanonicalPoolsChanged();
    event VenueStatusChanged(address indexed venue, bytes32 indexed poolId, bool inbound, bool allowed);
    event ExternalVenuesChanged();

    function venueEnforcement() external view returns (VenueEnforcement);
    function canonicalPools() external view returns (PoolKey[] memory);
    function venueAllowed(address venue, bytes32 poolId, bool inbound) external view returns (bool);
    function externalVenues()
        external
        view
        returns (bool inboundRestricted, bool outboundRestricted, ExternalVenue[] memory allowed);
}

error VenueNotAllowed(address venue, bytes32 poolId, bool inbound);
