// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { CustomAITypesV1 as T } from "../../src/custom-ai/CustomAITypesV1.sol";
import { CustomAITokenV1 } from "../../src/custom-ai/CustomAITokenV1.sol";
import { IVenuePolicy } from "../../src/custom-ai/IVenuePolicy.sol";

contract TokenQuoteFixture is ERC20 {
    constructor() ERC20("Quote", "Q") { }
}

contract TokenHookFixture { }

contract CustomAITokenV1Test is Test {
    CustomAITokenV1 private token;
    TokenQuoteFixture private quote;
    TokenHookFixture private hook;
    address private constant ALICE = address(0xa11ce);
    address private constant BOB = address(0xb0b);

    function setUp() public {
        quote = new TokenQuoteFixture();
        hook = new TokenHookFixture();
        token = new CustomAITokenV1(_metadata(), address(quote));
    }

    function _metadata() private pure returns (T.Metadata memory) {
        return T.Metadata("Custom AI fixture", "CAIF", "", "ipfs://fixture", "", bytes(""));
    }

    function test_fixedSupplyExistsOnlyAtFactoryUntilPoolBinding() public {
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(address(this)), token.totalSupply());
        assertEq(token.balanceOf(ALICE), 0);
        assertEq(token.canonicalPools().length, 0);
        vm.expectRevert(CustomAITokenV1.PoolNotBound.selector);
        token.transfer(ALICE, 1);
        token.approve(ALICE, 100);
        vm.prank(ALICE);
        vm.expectRevert(CustomAITokenV1.PoolNotBound.selector);
        token.transferFrom(address(this), ALICE, 1);
    }

    function test_onlyFactoryCanBindAndCannotReplacePool() public {
        vm.prank(ALICE);
        vm.expectRevert(CustomAITokenV1.PoolBindingUnavailable.selector);
        token.bindPool(address(hook));
        token.bindPool(address(hook));
        vm.expectRevert(CustomAITokenV1.PoolBindingUnavailable.selector);
        token.bindPool(address(hook));
    }

    function test_bindingRejectsNonContractAndCurrencyAsHook() public {
        vm.expectRevert(CustomAITokenV1.InvalidConfiguration.selector);
        token.bindPool(ALICE);
        vm.expectRevert(CustomAITokenV1.InvalidConfiguration.selector);
        token.bindPool(address(quote));
        assertFalse(token.poolBound());
    }

    function test_urc5ReportsExactPoolAndPreferredPermissions() public {
        token.bindPool(address(hook));
        assertTrue(token.supportsInterface(type(IVenuePolicy).interfaceId));
        assertTrue(token.supportsInterface(type(IERC165).interfaceId));
        assertFalse(token.supportsInterface(0xffffffff));
        assertEq(uint256(token.venueEnforcement()), uint256(IVenuePolicy.VenueEnforcement.Preferred));
        PoolKey[] memory pools = token.canonicalPools();
        assertEq(pools.length, 1);
        assertEq(Currency.unwrap(pools[0].currency0), address(token) < address(quote) ? address(token) : address(quote));
        assertEq(Currency.unwrap(pools[0].currency1), address(token) < address(quote) ? address(quote) : address(token));
        assertEq(address(pools[0].hooks), address(hook));
        assertEq(pools[0].fee, 0);
        assertEq(pools[0].tickSpacing, 60);
        (bool inbound, bool outbound, IVenuePolicy.ExternalVenue[] memory venues) = token.externalVenues();
        assertFalse(inbound);
        assertFalse(outbound);
        assertEq(venues.length, 0);
        assertTrue(token.venueAllowed(BOB, bytes32(uint256(1)), true));
        assertTrue(token.venueAllowed(address(hook), bytes32(0), false));
    }

    function test_noMintBurnPauseOrRecipientSeizureEntryPoint() public {
        token.bindPool(address(hook));
        token.transfer(ALICE, 100);
        (bool minted,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", ALICE, 100));
        (bool burned,) = address(token).call(abi.encodeWithSignature("burn(uint256)", 100));
        (bool paused,) = address(token).call(abi.encodeWithSignature("pause()"));
        (bool seized,) = address(token).call(abi.encodeWithSignature("burnFrom(address,uint256)", ALICE, 100));
        assertFalse(minted || burned || paused || seized);
        assertEq(token.totalSupply(), T.TOKEN_SUPPLY);
        assertEq(token.balanceOf(ALICE), 100);
    }

    function testFuzz_transfersAndAllowancesHaveNoTaxOrSupplyChange(uint128 value) public {
        uint256 amount = bound(value, 0, T.TOKEN_SUPPLY);
        token.bindPool(address(hook));
        token.transfer(ALICE, amount);
        vm.prank(ALICE);
        token.approve(address(this), amount);
        token.transferFrom(ALICE, BOB, amount);
        assertEq(token.balanceOf(BOB), amount);
        assertEq(token.balanceOf(ALICE), 0);
        assertEq(token.totalSupply(), T.TOKEN_SUPPLY);
        assertEq(token.balanceOf(address(this)) + token.balanceOf(BOB), T.TOKEN_SUPPLY);
    }
}
