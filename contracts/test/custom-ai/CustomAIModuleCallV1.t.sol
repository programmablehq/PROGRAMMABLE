// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CustomAITypesV1 as T } from "../../src/custom-ai/CustomAITypesV1.sol";
import { CustomAIModuleCallV1 as M } from "../../src/custom-ai/CustomAIModuleCallV1.sol";
import { ICustomAIFeeModuleV1 } from "../../src/custom-ai/ICustomAIFeeModuleV1.sol";
import { CustomAIFeeMathV1 as F } from "../../src/custom-ai/CustomAIFeeMathV1.sol";

contract ModuleCallHarness {
    function evaluate(T.ModuleBinding memory binding, T.SwapContext memory context)
        external
        view
        returns (uint16, M.Status)
    {
        return M.evaluate(binding, context);
    }
}

contract FeeModuleFixture is ICustomAIFeeModuleV1 {
    uint16 private immutable _fee;
    uint64 private immutable _expiry;
    bytes32 private immutable _configuration;

    constructor(uint16 fee, uint64 expiry, bytes32 configuration) {
        _fee = fee;
        _expiry = expiry;
        _configuration = configuration;
    }

    function quoteFee(T.SwapContext calldata c) external view returns (bytes4, uint16, uint64, bytes32) {
        require(c.poolId != bytes32(0) && c.router != address(0) && c.specifiedAmount != 0, "context");
        return (this.quoteFee.selector, _fee, _expiry, _configuration);
    }
}

contract HostileFeeModuleFixture {
    uint8 private immutable _fault;
    uint256 public writes;

    constructor(uint8 fault) {
        _fault = fault;
    }

    fallback() external {
        uint8 fault = _fault;
        if (fault == 1) revert("module failed");
        if (fault == 2) ++writes;
        if (fault == 3) {
            assembly {
                for { } 1 { } { }
            }
        }
        bytes memory output = abi.encode(
            ICustomAIFeeModuleV1.quoteFee.selector, uint16(100), type(uint64).max, keccak256("configuration")
        );
        assembly ("memory-safe") {
            switch fault
            case 4 { return(add(output, 32), 31) }
            case 5 {
                let p := mload(0x40)
                mstore(p, 0)
                return(p, 65536)
            }
            case 6 { mstore(add(output, 32), or(mload(add(output, 32)), 1)) }
            case 7 { mstore(add(output, 64), 65536) }
            case 8 { mstore(add(output, 96), shl(64, 1)) }
            default { }
            return(add(output, 32), 128)
        }
    }
}

contract CustomAIModuleCallV1Test is Test {
    ModuleCallHarness private caller = new ModuleCallHarness();
    bytes32 private constant CONFIGURATION = keccak256("configuration");

    function _context() private pure returns (T.SwapContext memory) {
        return T.SwapContext(keccak256("pool"), address(0xa11ce), uint64(1), true, true, 10_000);
    }

    function _binding(address instance) private view returns (T.ModuleBinding memory) {
        return T.ModuleBinding(instance, instance.codehash, CONFIGURATION);
    }

    function _evaluate(address instance) private view returns (uint16, M.Status) {
        return caller.evaluate(_binding(instance), _context());
    }

    function test_validResultAndInclusiveExpiry() public {
        vm.warp(100);
        FeeModuleFixture module = new FeeModuleFixture(1450, 100, CONFIGURATION);
        (uint16 bps, M.Status status) = _evaluate(address(module));
        assertEq(bps, 1450);
        assertEq(uint256(status), uint256(M.Status.Applied));
        vm.warp(101);
        (bps, status) = _evaluate(address(module));
        assertEq(bps, 0);
        assertEq(uint256(status), uint256(M.Status.Expired));
    }

    function test_missingModuleUsesPlatformFeeOnly() public view {
        (uint16 bps, M.Status status) = _evaluate(address(0));
        assertEq(bps, 0);
        assertEq(uint256(status), uint256(M.Status.NoModule));
        assertEq(F.fromGross(10_000, bps).platform, 50);
    }

    function test_changedRuntimeCannotRetainItsFee() public {
        address module = address(new FeeModuleFixture(100, type(uint64).max, CONFIGURATION));
        T.ModuleBinding memory binding = _binding(module);
        vm.etch(module, hex"00");
        (uint16 bps, M.Status status) = caller.evaluate(binding, _context());
        assertEq(bps, 0);
        assertEq(uint256(status), uint256(M.Status.CodeChanged));
    }

    function test_changedConfigurationCannotRetainItsFee() public {
        address module = address(new FeeModuleFixture(100, type(uint64).max, keccak256("different rules")));
        (uint16 bps, M.Status status) = _evaluate(module);
        assertEq(bps, 0);
        assertEq(uint256(status), uint256(M.Status.ConfigurationChanged));
    }

    function test_revertsWritesAndGasExhaustionFallBackWithoutStateChanges() public {
        for (uint8 fault = 1; fault <= 3; ++fault) {
            HostileFeeModuleFixture module = new HostileFeeModuleFixture(fault);
            (uint16 bps, M.Status status) = _evaluate(address(module));
            assertEq(bps, 0);
            assertEq(uint256(status), uint256(M.Status.CallFailed));
            assertEq(module.writes(), 0);
            assertEq(F.fromGross(10_000, bps).net, 9950);
        }
    }

    function test_malformedAndHugeReturnDataFallBackWithoutDecodeRevert() public {
        for (uint8 fault = 4; fault <= 8; ++fault) {
            (uint16 bps, M.Status status) = _evaluate(address(new HostileFeeModuleFixture(fault)));
            assertEq(bps, 0);
            assertEq(uint256(status), uint256(M.Status.InvalidResponse));
        }
    }

    function test_insufficientCallerGasRevertsInsteadOfDiscountingFee() public {
        address module = address(new FeeModuleFixture(1450, type(uint64).max, CONFIGURATION));
        bytes memory input = abi.encodeCall(caller.evaluate, (_binding(module), _context()));
        (bool success, bytes memory reason) = address(caller).call{ gas: 120_000 }(input);
        assertFalse(success);
        assertEq(bytes4(reason), M.InsufficientEvaluationGas.selector);
    }

    function testFuzz_proposalsAboveTheTotalCapAreIgnored(uint16 proposal) public {
        address module = address(new FeeModuleFixture(proposal, type(uint64).max, CONFIGURATION));
        (uint16 bps, M.Status status) = _evaluate(module);
        if (proposal <= 1450) {
            assertEq(bps, proposal);
            assertEq(uint256(status), uint256(M.Status.Applied));
        } else {
            assertEq(bps, 0);
            assertEq(uint256(status), uint256(M.Status.FeeCapExceeded));
        }
        F.Fees memory fees = F.fromGross(10_000, bps);
        assertEq(fees.platform, 50);
        assertLe(fees.platform + fees.additional, 1500);
    }
}
