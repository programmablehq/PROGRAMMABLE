// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { FoundationTypesV1 as T } from "./FoundationTypesV1.sol";

/// @notice Standard fixed-supply token. Metadata has no setters, and burn affects only the caller's own inventory.
contract FoundationTokenV1 is ERC20 {
    string public description;
    string public image;
    string public website;
    bytes public extraData;
    bytes32 public immutable metadataHash;

    error InvalidMetadata();

    constructor(T.Metadata memory m, address recipient) ERC20(m.name, m.symbol) {
        if (
            bytes(m.name).length == 0 || bytes(m.name).length > 48 || bytes(m.symbol).length == 0
                || bytes(m.symbol).length > 12 || bytes(m.description).length > 280 || bytes(m.imageURI).length == 0
                || bytes(m.imageURI).length > 2048 || bytes(m.website).length > 2048 || m.socialData.length > 1200
        ) revert InvalidMetadata();
        description = m.description;
        image = m.imageURI;
        website = m.website;
        extraData = m.socialData;
        metadataHash = keccak256(abi.encode(m));
        _mint(recipient, T.TOKEN_SUPPLY);
    }

    function metadata() external view returns (string memory, string memory, string memory, bytes memory) {
        return (description, website, image, extraData);
    }

    function burn(uint256 amount) external {
        _burn(_msgSender(), amount);
    }
}
