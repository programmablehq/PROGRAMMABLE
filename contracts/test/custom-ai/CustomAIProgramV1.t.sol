// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { T, CustomAIProgramV1, CustomAIFactoryV1 } from "../../src/custom-ai/CustomAIProgramV1.sol";
import { CustomAIRewardVaultV1 } from "../../src/custom-ai/CustomAIRewardVaultV1.sol";

contract ProgramAsset is ERC20 {
    bool public broken;
    constructor() ERC20("Fixture", "FIX") { }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setBroken(bool value) external { broken = value; }
    function balanceOf(address account) public view override returns (uint256) {
        require(!broken, "quote unavailable"); return super.balanceOf(account);
    }
}

contract ProgramFactoryFixture {
    T.LaunchResult private result;
    address public router;
    function bind(address token, address vault, address hook, address router_) external {
        result.token = token; result.rewardVault = vault; result.hook = hook; router = router_;
    }
    function launchOf(address, bytes32) external view returns (T.LaunchResult memory) { return result; }
}

contract ProgramRouterFixture {
    ProgramAsset public immutable quote;
    ProgramAsset public immutable token;
    uint256 public rate = 100;
    constructor(ProgramAsset q, ProgramAsset t) { quote = q; token = t; }
    function setRate(uint256 r) external { rate = r; }
    function poolKey() external view returns (PoolKey memory) {
        bool order = address(quote) < address(token);
        return PoolKey(Currency.wrap(order ? address(quote) : address(token)), Currency.wrap(order ? address(token) : address(quote)), 0, 60, IHooks(address(this)));
    }
    function swap(PoolKey calldata, SwapParams calldata params, uint256 limit, uint16, address recipient, uint64 deadline)
        external returns (uint256 paid, uint256 received)
    {
        require(deadline >= block.timestamp && params.zeroForOne == (address(quote) < address(token)));
        paid = uint256(-params.amountSpecified); received = paid * rate;
        require(received >= limit, "price limit");
        quote.transferFrom(msg.sender, address(this), paid); token.mint(recipient, received);
    }
}

contract CustomAIProgramV1Test is Test {
    ProgramAsset private quote;
    ProgramAsset private token;
    ProgramFactoryFixture private factory;
    ProgramRouterFixture private router;
    CustomAIProgramV1 private program;
    CustomAIRewardVaultV1 private vault;
    address private constant ALICE = address(0xa11ce);
    address private constant BOB = address(0xb0b);
    address private constant RECIPIENT = address(0x1234);

    function setUp() public {
        vm.warp(1_000_000);
        quote = new ProgramAsset(); token = new ProgramAsset(); factory = new ProgramFactoryFixture();
        router = new ProgramRouterFixture(quote, token);
    }

    function setupProgram(CustomAIProgramV1.Mode mode) private {
        program = new CustomAIProgramV1(CustomAIProgramV1.Configuration({ factory: CustomAIFactoryV1(address(factory)),
            creator: address(this), launchSalt: keccak256("program"), quote: address(quote), quoteDecimals: 18,
            mode: mode, recipient: mode == CustomAIProgramV1.Mode.Staking ? address(0) : RECIPIENT,
            interval: 3600, maximumBatch: mode == CustomAIProgramV1.Mode.Buyback ? 1 ether : 0,
            minimumTokensPerQuote: mode == CustomAIProgramV1.Mode.Buyback ? 90 ether : 0 }));
        vault = new CustomAIRewardVaultV1(address(quote), T.Rewards(address(this), 4000,
            T.ModuleBinding(address(program), address(program).codehash, program.configurationHash())));
        factory.bind(address(token), address(vault), address(router), address(router));
    }

    function deposit(address account, uint256 amount) private {
        token.mint(account, amount);
        vm.startPrank(account); token.approve(address(program), amount); program.stake(amount); vm.stopPrank();
    }

    function test_distributionIsFundedBoundAndCannotReplay() public {
        setupProgram(CustomAIProgramV1.Mode.Distribution);
        vm.expectRevert(CustomAIProgramV1.InvalidAmount.selector); program.distribute();
        quote.mint(address(vault), 10 ether);
        assertFalse(vault.allocate(keccak256("unrelated")));
        vm.prank(BOB); assertEq(program.distribute(), 6 ether);
        assertEq(quote.balanceOf(RECIPIENT), 6 ether); assertEq(quote.balanceOf(BOB), 0);
        vault.claimCreator(); assertEq(quote.balanceOf(address(this)), 4 ether);
        vm.expectRevert(CustomAIProgramV1.NotReady.selector); program.distribute();
        vm.warp(block.timestamp + 3600); vm.expectRevert(CustomAIProgramV1.InvalidAmount.selector); program.distribute();
        (, , uint256 amount,,) = program.quoteReward(program.actionId(), BOB, address(quote), 10 ether);
        assertEq(amount, 0);
    }

    function test_stakingProportionalFundedRewardsAndNoLateCapture() public {
        setupProgram(CustomAIProgramV1.Mode.Staking);
        deposit(ALICE, 100 ether);
        quote.mint(address(vault), 10 ether); program.collect();
        deposit(BOB, 100 ether);
        vm.warp(block.timestamp + 3600); quote.mint(address(vault), 10 ether); program.collect();
        vm.startPrank(ALICE); assertEq(program.claim(), 9 ether); program.withdraw(100 ether); vm.stopPrank();
        vm.startPrank(BOB); assertEq(program.claim(), 3 ether); program.withdraw(100 ether); vm.stopPrank();
        assertEq(token.balanceOf(ALICE), 100 ether); assertEq(token.balanceOf(BOB), 100 ether);
        assertEq(quote.balanceOf(address(program)), 0); assertEq(program.totalStaked(), 0);
        vm.prank(ALICE); vm.expectRevert(CustomAIProgramV1.InvalidAmount.selector); program.claim();
    }

    function test_principalWithdrawsWithUnavailableQuoteAndFactory() public {
        setupProgram(CustomAIProgramV1.Mode.Staking); deposit(ALICE, 100 ether);
        quote.setBroken(true); vm.etch(address(factory), hex"00");
        vm.prank(ALICE); program.withdraw(100 ether);
        assertEq(token.balanceOf(ALICE), 100 ether);
    }

    function test_fractionalHistoryCannotOverpayNewStakers() public {
        setupProgram(CustomAIProgramV1.Mode.Staking);
        deposit(ALICE, 2);
        quote.mint(address(program), 1);
        vm.startPrank(ALICE); assertEq(program.claim(), 1); program.withdraw(2); vm.stopPrank();
        address carol = address(0xca01);
        deposit(BOB, 1); deposit(carol, 1);
        quote.mint(address(program), 1);
        program.collect();
        vm.prank(BOB); vm.expectRevert(CustomAIProgramV1.InvalidAmount.selector); program.claim();
        vm.prank(carol); vm.expectRevert(CustomAIProgramV1.InvalidAmount.selector); program.claim();
        quote.mint(address(program), 1);
        vm.prank(BOB); assertEq(program.claim(), 1);
        vm.prank(carol); assertEq(program.claim(), 1);
        assertEq(quote.balanceOf(address(program)), 0);
    }

    function test_buybackEnforcesPriceBatchCooldownAndClearsAllowance() public {
        setupProgram(CustomAIProgramV1.Mode.Buyback); quote.mint(address(vault), 10 ether);
        (uint256 paid, uint256 received) = program.buyback();
        assertEq(paid, 1 ether); assertEq(received, 100 ether);
        assertEq(token.balanceOf(RECIPIENT), 100 ether); assertEq(quote.allowance(address(program), address(router)), 0);
        assertEq(quote.balanceOf(address(program)), 5 ether);
        vm.expectRevert(CustomAIProgramV1.NotReady.selector); program.buyback();
        vm.warp(block.timestamp + 3600); router.setRate(80);
        vm.expectRevert("price limit"); program.buyback();
        assertEq(quote.balanceOf(address(program)), 5 ether);
        router.setRate(100); program.buyback(); assertEq(token.balanceOf(RECIPIENT), 200 ether);
    }

    function testFuzz_stakingNeverPromisesUnfundedRewards(uint96 amount, uint96 funding) public {
        setupProgram(CustomAIProgramV1.Mode.Staking);
        amount = uint96(bound(amount, 1, 1e27)); funding = uint96(bound(funding, 10, 1e27));
        deposit(ALICE, amount); quote.mint(address(vault), funding); program.collect();
        uint256 funded = quote.balanceOf(address(program));
        vm.startPrank(ALICE);
        uint256 expected = program.rewardPerToken() * uint256(amount) / 1e27;
        if (expected != 0) assertLe(program.claim(), funded);
        program.withdraw(amount); vm.stopPrank();
        assertEq(token.balanceOf(ALICE), amount);
    }
}
