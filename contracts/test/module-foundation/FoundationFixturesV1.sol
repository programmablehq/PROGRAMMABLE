// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { FoundationTypesV1 as T } from "../../src/module-foundation/FoundationTypesV1.sol";
import { IFoundationModuleV1, IFoundationModuleFactoryV1 } from "../../src/module-foundation/IFoundationModuleV1.sol";
import { FoundationLedgerV1 } from "../../src/module-foundation/FoundationLedgerV1.sol";
import { FoundationHookV1 } from "../../src/module-foundation/FoundationHookV1.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { IV4Router } from "@uniswap/v4-periphery-v211/src/interfaces/IV4Router.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";

interface IFixtureUR {
    function execute(bytes calldata, bytes[] calldata, uint256) external payable;
}

contract FoundationQuoteFixture is ERC20 {
    uint8 private _decimals;
    bool public taxed;

    constructor(uint8 d) ERC20("Technical quote fixture", "QFIX") {
        _decimals = d;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function setTax(bool value) external {
        taxed = value;
    }

    function _update(address from, address to, uint256 amount) internal override {
        uint256 tax = taxed && from != address(0) && to != address(0) ? amount / 100 : 0;
        super._update(from, to, amount - tax);
        if (tax != 0) super._update(from, address(0), tax);
    }
}

/// @dev Stateful technical fixture only, never a catalog product. Storage-bound context yields identical runtime
/// across isolated instances. No setters for bound context/config/descriptor.
contract FoundationStatefulFixture is IFoundationModuleV1 {
    T.ModuleContext private _context;
    T.Descriptor private _descriptor;
    bytes32 private _configurationHash;
    uint256 public beforeCount;
    uint256 public afterCount;
    uint256 public actionCount;
    uint256 public observedGross;
    uint8 private _fault;

    constructor(T.ModuleContext memory c, bytes memory configuration) {
        _context = c;
        _configurationHash = keccak256(configuration);
        (_descriptor, _fault) = abi.decode(configuration, (T.Descriptor, uint8));
    }

    function context() external view returns (T.ModuleContext memory) {
        return _context;
    }

    function configurationHash() external view returns (bytes32) {
        return _configurationHash;
    }

    function descriptor() external view returns (T.Descriptor memory) {
        return _descriptor;
    }
    modifier onlyHost() {
        require(msg.sender == _context.host, "host");
        _;
    }

    function onBeforeSwap(T.SwapContext calldata) external onlyHost returns (bytes4) {
        ++beforeCount;
        if (_fault == 1) revert("before fixture");
        if (_fault == 3) {
            FoundationHookV1 host = FoundationHookV1(_context.host);
            host.poolManager().swap(host.poolKey(), SwapParams(true, -1, 4_295_128_740), "");
        }
        return IFoundationModuleV1.onBeforeSwap.selector;
    }

    function onAfterSwap(T.SwapContext calldata c) external onlyHost returns (bytes4) {
        ++afterCount;
        observedGross += c.grossQuote;
        if (_fault == 2) revert("after fixture");
        if (_fault == 5) return bytes4(0);
        if (_fault == 6) {
            bytes4 selector = IFoundationModuleV1.onAfterSwap.selector;
            assembly ("memory-safe") {
                let ptr := mload(0x40)
                mstore(ptr, selector)
                return(ptr, 100000)
            }
        }
        return IFoundationModuleV1.onAfterSwap.selector;
    }

    function onAction(address actor, bytes calldata data) external onlyHost returns (bytes4) {
        require(actor == _context.creator, "creator");
        ++actionCount;
        uint256 amount = abi.decode(data, (uint256));
        if (amount != 0) FoundationLedgerV1(_context.ledger).claimModule(amount);
        if (data.length == 128) {
            (, address router, address permit2, uint128 minimum) =
                abi.decode(data, (uint256, address, address, uint128));
            IERC20(_context.quote).approve(permit2, amount);
            IAllowanceTransfer(permit2).approve(_context.quote, router, uint160(amount), uint48(block.timestamp));
            bytes[] memory params = new bytes[](3);
            params[0] = abi.encode(
                IV4Router.ExactInputSingleParams(
                    FoundationHookV1(_context.host).poolKey(),
                    _context.quote < _context.token,
                    uint128(amount),
                    minimum,
                    0,
                    bytes("")
                )
            );
            params[1] = abi.encode(Currency.wrap(_context.quote), amount);
            params[2] = abi.encode(Currency.wrap(_context.token), uint256(minimum));
            bytes[] memory inputs = new bytes[](1);
            inputs[0] = abi.encode(
                abi.encodePacked(
                    uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL)
                ),
                params
            );
            IFixtureUR(router).execute(hex"10", inputs, block.timestamp);
            IAllowanceTransfer(permit2).approve(_context.quote, router, 0, 0);
            IERC20(_context.quote).approve(permit2, 0);
        }
        return IFoundationModuleV1.onAction.selector;
    }
}

contract FoundationFixtureFactory is IFoundationModuleFactoryV1 {
    function createModule(T.ModuleContext calldata c, bytes calldata configuration) external returns (address) {
        require(msg.sender == c.host, "bound host");
        return address(new FoundationStatefulFixture(c, configuration));
    }
}
