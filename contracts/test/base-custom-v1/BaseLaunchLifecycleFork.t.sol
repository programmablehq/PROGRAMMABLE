// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { IV4Router } from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import { ProtectedLaunchTokenV1 } from "../../src/launch-protection/ProtectedLaunchTokenV1.sol";
import {
    BaseProtectedNativeInitializerV1,
    IProtectedLaunchHookV1,
    ILaunchUsdFeedV1
} from "../../src/base-custom-v1/BaseProtectedNativeInitializerV1.sol";
import { BaseProtectedNative30HookV1 } from "../../src/base-custom-v1/BaseProtectedNative30HookV1.sol";

interface IBaseUniversalRouterV1 {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IBasePermit2V1 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @dev Run only with a Base mainnet fork. No mock is installed at a protocol or oracle address.
contract BaseLaunchLifecycleForkTest is Test {
    IPoolManager constant MANAGER = IPoolManager(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    address constant ROUTER = 0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant FEED = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;
    address constant TREASURY = 0xD88539d3c4C460136a733A3Fd60cf6BF269079da;
    address constant DEVELOPER = address(0xD001);
    address constant BUYER = address(0xB001);
    uint256 constant SUPPLY = 1_000_000_000 ether;
    int24 constant START_TICK = 180_120;

    BaseProtectedNativeInitializerV1 initializer;
    ProtectedLaunchTokenV1 token;
    BaseProtectedNative30HookV1 hook;

    function setUp() public {
        require(block.chainid == 8453, "Base fork required");
        require(
            address(MANAGER).codehash == 0x83b2af6e9f3158defc2811cbcb0db71ecf8b2ba2abea39c39e370ac5c6f43eb6,
            "Manager runtime changed"
        );
        require(
            ROUTER.codehash == 0x816c75fe7f6ccf8fe8b14825091e8dff301fe7ffd4b962f89b2981a747facc08,
            "Router runtime changed"
        );
        require(
            FEED.codehash == 0xbd6f524cdc4268b6bd1bb6f77a8821faeea9c52ee9e0afa0b6d948ce82c966c2,
            "Oracle runtime changed"
        );
        vm.deal(address(this), 1 ether);
        vm.deal(BUYER, 1 ether);
        initializer =
            new BaseProtectedNativeInitializerV1(MANAGER, address(this), ILaunchUsdFeedV1(FEED), FEED.codehash);
        token = new ProtectedLaunchTokenV1(
            "Base Custom API Check", "BAPICHECK", SUPPLY, address(initializer), address(MANAGER)
        );
        BaseProtectedNative30HookV1.PoolConfig memory config = BaseProtectedNative30HookV1.PoolConfig({
            token: address(token),
            lpFee: 0,
            tickSpacing: 60,
            initialSqrtPriceX96: TickMath.getSqrtPriceAtTick(START_TICK),
            initializer: address(initializer),
            creatorFeeRecipient: DEVELOPER,
            creatorBuyFeeBps: 70,
            creatorSellFeeBps: 70,
            module: address(0),
            maxModuleLpFeePips: 0
        });
        address[6] memory exemptions;
        bytes memory args = abi.encode(MANAGER, config, DEVELOPER, ROUTER, ROUTER.codehash, exemptions);
        (, bytes32 salt) = HookMiner.find(address(this), 0x20cc, type(BaseProtectedNative30HookV1).creationCode, args);
        hook = new BaseProtectedNative30HookV1{ salt: salt }(
            MANAGER, config, DEVELOPER, ROUTER, ROUTER.codehash, exemptions
        );
        initializer.initialize{ value: 0.0001 ether }(
            IProtectedLaunchHookV1(address(hook)), token, START_TICK, DEVELOPER, 1
        );
    }

    function _swap(bool buy, uint128 amount) internal {
        PoolKey memory key = hook.poolKey();
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: key, zeroForOne: buy, amountIn: amount, amountOutMinimum: 1, hookData: ""
            })
        );
        params[1] = abi.encode(buy ? key.currency0 : key.currency1, amount);
        params[2] = abi.encode(buy ? key.currency1 : key.currency0, uint256(1));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0f", params);
        vm.prank(BUYER);
        IBaseUniversalRouterV1(ROUTER).execute{ value: buy ? amount : 0 }(hex"10", inputs, block.timestamp + 60);
    }

    function testFork_openingBuyTaxGoesToTreasuryAndSellRemainsAvailable() public {
        uint256 initialPlatform = hook.feeVault().platformAccrued();
        uint256 initialTax = hook.openingTaxVault().platformAccrued();
        _swap(true, uint128(0.000_01 ether));
        assertGt(token.balanceOf(BUYER), 0);
        assertEq(hook.feeVault().platformAccrued() - initialPlatform, 0.000_000_03 ether);
        uint256 extraTax = hook.openingTaxVault().platformAccrued() - initialTax;
        assertEq(extraTax, 0.000_009_8 ether);
        assertEq(hook.openingTaxVault().PLATFORM_RECIPIENT(), TREASURY);
        uint256 treasuryBefore = TREASURY.balance;
        hook.openingTaxVault().claimPlatform();
        assertEq(TREASURY.balance - treasuryBefore, extraTax);
        _sellBalance();
    }

    function testFork_normalBuyAndSellCollectThirtyBpsExactlyOnce() public {
        vm.warp(block.timestamp + 31);
        uint256 initialPlatform = hook.feeVault().platformAccrued();
        uint256 initialTax = hook.openingTaxVault().platformAccrued();
        _swap(true, uint128(0.000_01 ether));
        assertEq(hook.feeVault().platformAccrued() - initialPlatform, 0.000_000_03 ether);
        assertEq(hook.openingTaxVault().platformAccrued(), initialTax);
        _sellBalance();
        assertGt(hook.feeVault().platformAccrued() - initialPlatform, 0.000_000_03 ether);
    }

    function _sellBalance() internal {
        uint256 amount = token.balanceOf(BUYER);
        vm.startPrank(BUYER);
        token.approve(PERMIT2, amount);
        IBasePermit2V1(PERMIT2).approve(address(token), ROUTER, uint160(amount), uint48(block.timestamp + 60));
        vm.stopPrank();
        uint256 beforeNative = BUYER.balance;
        _swap(false, uint128(amount));
        assertEq(token.balanceOf(BUYER), 0);
        assertGt(BUYER.balance, beforeNative);
    }
}
