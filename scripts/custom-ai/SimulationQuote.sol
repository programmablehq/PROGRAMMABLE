// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Synthetic quote for the networkless test VM. Never deployed or used as evidence about a live ERC20.
contract SimulationQuote {
    uint8 public immutable decimals;
    uint256 public totalSupply;
    bool public taxed;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    constructor(uint8 decimals_) { decimals = decimals_; }
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; totalSupply += amount; }
    function setTaxed(bool value) external { taxed = value; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transfer(address to, uint256 amount) external returns (bool) { _transfer(msg.sender, to, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) allowance[from][msg.sender] -= amount;
        _transfer(from, to, amount); return true;
    }
    function _transfer(address from, address to, uint256 amount) private {
        uint256 fee = taxed ? amount / 100 : 0;
        balanceOf[from] -= amount; balanceOf[to] += amount - fee; totalSupply -= fee;
    }
}
