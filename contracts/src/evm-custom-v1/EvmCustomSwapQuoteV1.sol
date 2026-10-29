// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IQuoteTokenV1 {
    function balanceOf(address owner) external view returns (uint256);
}
interface IQuotePermit2V1 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @notice Read-only simulation code injected at the caller address by eth_call.
/// @dev Never deployed or submitted as a transaction. The actual transaction is
/// separately simulated without overrides before it becomes wallet-signable.
contract EvmCustomSwapQuoteV1 {
    function quote(address inputToken, address outputToken, address permit2, address router, uint160 amount, uint48 deadline, bytes calldata callData)
        external returns (uint256 amountOut)
    {
        require(msg.sender == address(this), "QUOTE_SELF_ONLY");
        uint256 beforeOut = outputToken == address(0) ? address(this).balance : IQuoteTokenV1(outputToken).balanceOf(address(this));
        if (inputToken != address(0)) {
            (bool approved, bytes memory result) = inputToken.call(abi.encodeWithSignature("approve(address,uint256)", permit2, amount));
            require(approved && (result.length == 0 || abi.decode(result, (bool))), "QUOTE_APPROVAL_FAILED");
            IQuotePermit2V1(permit2).approve(inputToken, router, amount, deadline);
        }
        (bool ok, bytes memory reason) = router.call{value: inputToken == address(0) ? amount : 0}(callData);
        if (!ok) assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
        uint256 afterOut = outputToken == address(0) ? address(this).balance : IQuoteTokenV1(outputToken).balanceOf(address(this));
        require(afterOut > beforeOut, "QUOTE_NO_OUTPUT");
        return afterOut - beforeOut;
    }
}
