// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { AutomaticNativeFeeVaultV2 } from "../../src/automatic-platform-fees-v2/AutomaticNativeFeeVaultV2.sol";
import { RobinhoodPlatformFeeRouterV1 } from "../../src/automatic-platform-fees-v1/RobinhoodPlatformFeeRouterV1.sol";

contract FeeManagerFixture {
    mapping(address => uint256) private claims;
    bool private unlocked;
    receive() external payable { }

    function mint(address recipient, uint256, uint256 amount) external {
        require(unlocked);
        claims[recipient] += amount;
    }

    function burn(address from, uint256, uint256 amount) external {
        require(unlocked && msg.sender == from);
        claims[from] -= amount;
    }

    function take(address, address recipient, uint256 amount) external {
        require(unlocked);
        (bool sent,) = recipient.call{ value: amount }("");
        require(sent);
    }

    function balanceOf(address account, uint256) external view returns (uint256) {
        return claims[account];
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        require(!unlocked);
        unlocked = true;
        bytes memory result = IUnlockCallback(msg.sender).unlockCallback(data);
        unlocked = false;
        return result;
    }
}

contract FeeKernelFixture is IUnlockCallback {
    IPoolManager private immutable manager;
    AutomaticNativeFeeVaultV2 public immutable vault;

    constructor(IPoolManager manager_, address creator, address router, bytes32 routerHash) {
        manager = manager_;
        vault = new AutomaticNativeFeeVaultV2(manager_, creator, router, routerHash);
    }

    function accrue(uint256 platform, uint256 creator) external payable {
        (bool funded,) = address(manager).call{ value: msg.value }("");
        require(funded);
        manager.unlock(abi.encode(platform, creator));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (uint256 platform, uint256 creator) = abi.decode(data, (uint256, uint256));
        manager.mint(address(vault), 0, platform + creator);
        vault.recordFees(platform, creator);
        return "";
    }
}

contract RejectNativeFixture {
    receive() external payable {
        revert();
    }
}

contract AutomaticPlatformFeesV2Test is Test {
    address private constant TEAM = 0x9F5856A3578Faba96A6E8Dfd9C10563A1E598f62;
    address private constant ETH_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address private constant RH_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address private constant V4 = 0xC60bA256B44334A0Cd2C7242E98B88f031abB006;
    address private constant V4_HOOK = 0x720e649549F7BC2118aCBA9F4C9ae6fCC7586080;
    address private constant CREATOR = address(0xC0FFEE);

    function setUp() public {
        vm.deal(address(this), 100 ether);
    }

    function _manager(address at) private returns (IPoolManager) {
        FeeManagerFixture fixture = new FeeManagerFixture();
        vm.etch(at, address(fixture).code);
        return IPoolManager(at);
    }

    function testEthereumPaysDuringAccrualAndPreservesCreatorLedger() public {
        vm.chainId(1);
        IPoolManager manager = _manager(ETH_MANAGER);
        FeeKernelFixture kernel = new FeeKernelFixture(manager, CREATOR, address(0), bytes32(0));
        AutomaticNativeFeeVaultV2 vault = kernel.vault();
        uint256 beforeBalance = TEAM.balance;
        kernel.accrue{ value: 0.01 ether }(0.003 ether, 0.007 ether);
        assertEq(TEAM.balance - beforeBalance, 0.003 ether);
        assertEq(vault.platformAccrued(), 0);
        assertEq(vault.creatorAccrued(), 0.007 ether);
        assertEq(vault.totalPlatformPaid(), 0.003 ether);
        assertEq(manager.balanceOf(address(vault), 0), 0.007 ether);
        vm.prank(address(0xB0B));
        vault.claimCreator();
        assertEq(CREATOR.balance, 0.007 ether);
        assertEq(manager.balanceOf(address(vault), 0), 0);
    }

    function testAllDirectNativeChainsPayWithoutClaiming() public {
        uint256[4] memory chains = [uint256(1), 8453, 999, 99_901];
        address[4] memory managers = [
            ETH_MANAGER,
            address(0x498581fF718922c3f8e6A244956aF099B2652b2b),
            address(0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F),
            address(0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1)
        ];
        for (uint256 i; i < chains.length; ++i) {
            vm.chainId(chains[i]);
            FeeKernelFixture kernel = new FeeKernelFixture(_manager(managers[i]), CREATOR, address(0), bytes32(0));
            uint256 beforeBalance = TEAM.balance;
            kernel.accrue{ value: 10_001 }(3001, 7000);
            assertEq(TEAM.balance - beforeBalance, 3001);
            assertEq(kernel.vault().platformAccrued(), 0);
            assertEq(kernel.vault().creatorAccrued(), 7000);
        }
    }

    function testUnsupportedChainAndRedirectedRouteAreRejected() public {
        vm.chainId(8453);
        IPoolManager manager = _manager(0x498581fF718922c3f8e6A244956aF099B2652b2b);
        vm.expectRevert(AutomaticNativeFeeVaultV2.InvalidConfiguration.selector);
        new AutomaticNativeFeeVaultV2(manager, CREATOR, address(0xBAD), bytes32(uint256(1)));
        vm.chainId(10);
        vm.expectRevert(AutomaticNativeFeeVaultV2.InvalidConfiguration.selector);
        new AutomaticNativeFeeVaultV2(manager, CREATOR, address(0), bytes32(0));
    }

    function testRecipientFailurePreservesBackedFeesAndRetryCannotRedirect() public {
        vm.chainId(1);
        IPoolManager manager = _manager(ETH_MANAGER);
        FeeKernelFixture kernel = new FeeKernelFixture(manager, CREATOR, address(0), bytes32(0));
        AutomaticNativeFeeVaultV2 vault = kernel.vault();
        vm.etch(TEAM, address(new RejectNativeFixture()).code);
        kernel.accrue{ value: 1234 }(1234, 0);
        assertEq(vault.platformAccrued(), 1234);
        assertEq(vault.totalPlatformPaid(), 0);
        assertEq(manager.balanceOf(address(vault), 0), 1234);
        vm.etch(TEAM, "");
        uint256 beforeBalance = TEAM.balance;
        vm.prank(address(0xB0B));
        vault.claimPlatform();
        assertEq(TEAM.balance - beforeBalance, 1234);
        assertEq(vault.platformAccrued(), 0);
        assertEq(vault.totalPlatformPaid(), 1234);
    }

    function testUnauthorizedAccrualAndCallbackCannotSpend() public {
        vm.chainId(1);
        FeeKernelFixture kernel = new FeeKernelFixture(_manager(ETH_MANAGER), CREATOR, address(0), bytes32(0));
        AutomaticNativeFeeVaultV2 vault = kernel.vault();
        vm.expectRevert(AutomaticNativeFeeVaultV2.Unauthorized.selector);
        vault.recordFees(1, 0);
        vm.expectRevert(AutomaticNativeFeeVaultV2.Unauthorized.selector);
        vault.forwardWhileUnlocked();
        vm.expectRevert(AutomaticNativeFeeVaultV2.InvalidClaim.selector);
        vault.unlockCallback(abi.encode(TEAM, 1));
    }
}
