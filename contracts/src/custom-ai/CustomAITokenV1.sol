// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC165 } from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
import { IVenuePolicy } from "./IVenuePolicy.sol";

/// @notice Fixed supply and free ERC20 transfers. No owner, upgrades, mint, burn or blacklist entrypoints.
/// @dev The canonical factory must create, bind and fund the pool atomically. This primitive is not a launcher.
contract CustomAITokenV1 is ERC20, ERC165, IVenuePolicy {
    address public immutable factory;
    address public immutable quote;
    bytes32 public immutable metadataHash;
    bytes32 public constant CORE_VERSION = T.VERSION_ID;
    string public description;
    string public image;
    string public website;
    bytes public extraData;
    bool public poolBound;
    PoolKey private _pool;

    error InvalidConfiguration();
    error InvalidMetadata();
    error PoolBindingUnavailable();
    error PoolNotBound();

    constructor(T.Metadata memory m, address quote_) ERC20(m.name, m.symbol) {
        if (quote_.code.length == 0 || quote_ == address(this)) revert InvalidConfiguration();
        if (
            bytes(m.name).length == 0 || bytes(m.name).length > 48 || bytes(m.symbol).length == 0
                || bytes(m.symbol).length > 12 || bytes(m.description).length > 280 || bytes(m.imageURI).length == 0
                || bytes(m.imageURI).length > 2048 || bytes(m.website).length > 2048 || m.socialData.length > 1200
        ) revert InvalidMetadata();
        factory = msg.sender;
        quote = quote_;
        metadataHash = keccak256(abi.encode(m));
        description = m.description;
        image = m.imageURI;
        website = m.website;
        extraData = m.socialData;
        _mint(msg.sender, T.TOKEN_SUPPLY);
    }

    /// @dev One-time binding breaks the CREATE2 token/hook address cycle. Transfers stay disabled until bound.
    function bindPool(address hook) external returns (bytes32 poolId) {
        if (msg.sender != factory || poolBound) revert PoolBindingUnavailable();
        if (hook.code.length == 0 || hook == address(this) || hook == quote) revert InvalidConfiguration();
        bool token0 = address(this) < quote;
        _pool = PoolKey(
            Currency.wrap(token0 ? address(this) : quote),
            Currency.wrap(token0 ? quote : address(this)),
            T.LP_FEE,
            T.TICK_SPACING,
            IHooks(hook)
        );
        poolBound = true;
        poolId = PoolId.unwrap(PoolIdLibrary.toId(_pool));
        emit CanonicalPoolsChanged();
    }

    function metadata() external view returns (string memory, string memory, string memory, bytes memory) {
        return (description, website, image, extraData);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IVenuePolicy).interfaceId || super.supportsInterface(interfaceId);
    }

    function canonicalPools() external view returns (PoolKey[] memory pools) {
        pools = new PoolKey[](poolBound ? 1 : 0);
        if (poolBound) pools[0] = _pool;
    }

    function venueEnforcement() external pure returns (VenueEnforcement) {
        return VenueEnforcement.Preferred;
    }

    function venueAllowed(address, bytes32, bool) external pure returns (bool) {
        return true;
    }

    function externalVenues() external pure returns (bool, bool, ExternalVenue[] memory) {
        return (false, false, new ExternalVenue[](0));
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && !poolBound) revert PoolNotBound();
        super._update(from, to, value);
    }
}
