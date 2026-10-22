// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Rejects fee-on-transfer, short transfers and callbacks that change either measured balance.
library CustomAITransfersV1 {
    using SafeERC20 for IERC20;
    error InexactTransfer();

    function pull(IERC20 asset, address from, address to, uint256 amount) internal {
        if (from == to || to == address(0)) revert InexactTransfer();
        uint256 beforeFrom = asset.balanceOf(from);
        uint256 beforeTo = asset.balanceOf(to);
        asset.safeTransferFrom(from, to, amount);
        if (asset.balanceOf(from) != beforeFrom - amount || asset.balanceOf(to) != beforeTo + amount) {
            revert InexactTransfer();
        }
    }

    function push(IERC20 asset, address to, uint256 amount) internal {
        if (to == address(this) || to == address(0)) revert InexactTransfer();
        uint256 beforeFrom = asset.balanceOf(address(this));
        uint256 beforeTo = asset.balanceOf(to);
        asset.safeTransfer(to, amount);
        if (asset.balanceOf(address(this)) != beforeFrom - amount || asset.balanceOf(to) != beforeTo + amount) {
            revert InexactTransfer();
        }
    }
}
