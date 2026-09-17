// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

interface ICurrentLiquidityLauncherConfiguration {
    function permit2() external view returns (address);
    function getGraffiti(address originalCreator) external pure returns (bytes32);
}

interface ICurrentLBPStrategyConfiguration {
    function poolManager() external view returns (address);
    function positionManager() external view returns (address);
    function initializerFactory() external view returns (address);
}

interface ICurrentAuctionFactoryConfiguration {
    function protocolFeeController() external view returns (address);
}

/// @dev Current dependency coverage runs alongside the unchanged historical deployment snapshots.
abstract contract CurrentOfficialDeploymentSnapshot is Test {
    string internal currentSnapshot;
    uint256 internal expectedContractCount;

    function _selectCurrentSnapshot(string memory file, string memory rpc, uint256 chainId, uint256 contractCount)
        internal
    {
        currentSnapshot = vm.readFile(file);
        assertEq(vm.parseJsonUint(currentSnapshot, ".chainId"), chainId);
        uint256 snapshotBlock = vm.parseJsonUint(currentSnapshot, ".runtimeSnapshot.blockNumber");
        vm.createSelectFork(rpc, snapshotBlock);
        assertEq(block.chainid, chainId);
        assertEq(block.number, snapshotBlock);
        assertEq(block.timestamp, vm.parseJsonUint(currentSnapshot, ".runtimeSnapshot.blockTimestamp"));
        expectedContractCount = contractCount;
    }

    function test_currentOfficialRuntimeCodeMatchesEverySnapshotEntry() public view {
        string[] memory keys = vm.parseJsonKeys(currentSnapshot, ".contracts");
        assertEq(keys.length, expectedContractCount);
        for (uint256 i; i < keys.length; ++i) {
            address target = _dependency(keys[i]);
            bytes32 expected =
                vm.parseJsonBytes32(currentSnapshot, string.concat(".contracts.", keys[i], ".runtimeCodeHash"));
            assertGt(target.code.length, 0, keys[i]);
            assertEq(target.codehash, expected, keys[i]);
        }
    }

    function test_currentAuctionStackRetainsExpectedDependencies() public view {
        ICurrentLiquidityLauncherConfiguration launcher =
            ICurrentLiquidityLauncherConfiguration(_dependency("liquidityLauncher"));
        ICurrentLBPStrategyConfiguration strategy = ICurrentLBPStrategyConfiguration(_dependency("lbpStrategy"));

        assertEq(launcher.permit2(), _dependency("permit2"));
        assertEq(launcher.getGraffiti(address(this)), keccak256(abi.encode(address(this))));
        assertEq(strategy.poolManager(), _dependency("poolManager"));
        assertEq(strategy.positionManager(), _dependency("positionManager"));
        assertEq(strategy.initializerFactory(), _dependency("continuousClearingAuctionFactory"));
        assertEq(
            ICurrentAuctionFactoryConfiguration(_dependency("continuousClearingAuctionFactory"))
                .protocolFeeController(),
            address(0)
        );
    }

    function _dependency(string memory key) internal view returns (address) {
        return vm.parseJsonAddress(currentSnapshot, string.concat(".contracts.", key, ".address"));
    }
}
