// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {ProtectedLaunchTokenV1} from "../../src/launch-protection/ProtectedLaunchTokenV1.sol";
import {ProtectedNativeInitializerV1,IProtectedLaunchHookV1,ILaunchUsdFeedV1} from "../../src/launch-protection/ProtectedNativeInitializerV1.sol";
import {AutomaticProtectedNative30HookV1} from "../../src/automatic-platform-fees-v1/AutomaticProtectedNative30HookV1.sol";
import {RobinhoodPlatformFeeRouterV1} from "../../src/automatic-platform-fees-v1/RobinhoodPlatformFeeRouterV1.sol";

contract AutomaticHookForkTest is Test {
    address constant TEAM=0x9F5856A3578Faba96A6E8Dfd9C10563A1E598f62;
    function _launch(bool robinhood) private {
        vm.createSelectFork(robinhood?"https://rpc.mainnet.chain.robinhood.com":"https://ethereum-rpc.publicnode.com");
        vm.deal(address(this),1 ether);
        IPoolManager manager=IPoolManager(robinhood?0x8366a39CC670B4001A1121B8F6A443A643e40951:0x000000000004444c5dc75cB358380D2e3dE08A90);
        address swapRouter=robinhood?0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99:0xd92A36B0000531EF3063dEd4De20A0783308446C;
        address feed=robinhood?0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9:0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;
        address recipientRouter=robinhood?address(new RobinhoodPlatformFeeRouterV1(vm.addr(0xA11CE))):address(0);
        bytes32 routerHash=robinhood?recipientRouter.codehash:bytes32(0);
        ProtectedNativeInitializerV1 initializer=new ProtectedNativeInitializerV1(manager,address(this),ILaunchUsdFeedV1(feed),feed.codehash);
        ProtectedLaunchTokenV1 token=new ProtectedLaunchTokenV1("Automatic fee proof","AFEE",1_000_000_000 ether,address(initializer),address(manager));
        int24 tick=180120;
        AutomaticProtectedNative30HookV1.PoolConfig memory config=AutomaticProtectedNative30HookV1.PoolConfig(address(token),0,60,TickMath.getSqrtPriceAtTick(tick),address(initializer),address(this),0,0,address(0),0);
        address[6] memory exemptions;
        bytes memory args=abi.encode(manager,config,address(this),swapRouter,swapRouter.codehash,exemptions,recipientRouter,routerHash);
        (,bytes32 salt)=HookMiner.find(address(this),0x20cc,type(AutomaticProtectedNative30HookV1).creationCode,args);
        AutomaticProtectedNative30HookV1 hook=new AutomaticProtectedNative30HookV1{salt:salt}(manager,config,address(this),swapRouter,swapRouter.codehash,exemptions,recipientRouter,routerHash);
        uint256 beforeBalance=TEAM.balance;
        initializer.initialize{value:0.01 ether}(IProtectedLaunchHookV1(address(hook)),token,tick,address(this),1);
        assertGt(token.balanceOf(address(this)),0);
        assertEq(hook.feeVault().totalPlatformRecorded(),0.00003 ether);
        assertEq(hook.feeVault().totalPlatformPaid(),0.00003 ether);
        assertEq(hook.feeVault().platformAccrued(),0);
        assertEq(TEAM.balance-beforeBalance,robinhood?0.000006 ether:0.00003 ether);
        if(robinhood)assertEq(RobinhoodPlatformFeeRouterV1(payable(recipientRouter)).buybackReserve(),0.000024 ether);
    }
    function testEthereumActualPoolManagerDeliversDuringInitialSwap() public {_launch(false);}
    function testRobinhoodActualPoolManagerSplitsDuringInitialSwap() public {_launch(true);}
    receive() external payable {}
}
