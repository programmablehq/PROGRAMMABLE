// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ElysiumHypeUsdRelayV1, IHyperEvmHypeUsdFeedV1 } from "../../src/elysium-custom-v1/ElysiumHypeUsdRelayV1.sol";
import { ElysiumHypeUsdFeedV1 } from "../../src/elysium-custom-v1/ElysiumHypeUsdFeedV1.sol";

contract CanonicalInboxFixture {
    address public constant bridge = 0x503D572157113fAaaD4DbeD2647Bb10b949216B6;
    address public destination;
    address public refund;
    bytes public message;
    uint256 public ticket;
    bool public fail;

    function setFail(bool value) external {
        fail = value;
    }

    function calculateRetryableSubmissionFee(uint256 length, uint256) external pure returns (uint256) {
        require(length == 100);
        return 1000;
    }

    function createRetryableTicket(
        address to,
        uint256 value,
        uint256 submission,
        address excessRefund,
        address callRefund,
        uint256 gasLimit,
        uint256 maxFee,
        bytes calldata data
    ) external payable returns (uint256) {
        require(!fail && value == 0 && submission == 2000 && gasLimit >= 100_000);
        require(msg.value >= submission + gasLimit * maxFee && excessRefund == callRefund);
        destination = to;
        refund = excessRefund;
        message = data;
        return ++ticket;
    }
}

contract ElysiumHypeUsdRelayTest is Test {
    address constant SOURCE = 0x2b25BC41D55de29F3A2e163F8Eebf63966B25b57;
    address constant INBOX = 0xce59f8B65ad41C9DAE4c07A0571a39824bD92cff;
    ElysiumHypeUsdRelayV1 relay;
    ElysiumHypeUsdFeedV1 feed;
    CanonicalInboxFixture inbox;

    function setUp() public {
        vm.warp(2_000_000);
        vm.chainId(999);
        bytes memory code =
            vm.parseJsonBytes(vm.readFile("test/elysium-custom-v1/parent-feed-runtime.json"), ".runtime");
        vm.etch(SOURCE, code);
        vm.mockCall(SOURCE, abi.encodeCall(IHyperEvmHypeUsdFeedV1.decimals, ()), abi.encode(uint8(18)));
        source(15, 33e18, block.timestamp - 60, 15);
        CanonicalInboxFixture implementation = new CanonicalInboxFixture();
        vm.etch(INBOX, address(implementation).code);
        inbox = CanonicalInboxFixture(INBOX);
        // The child has no dependency on parent deployment order, only its fixed address.
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        vm.chainId(99_901);
        feed = new ElysiumHypeUsdFeedV1(predicted);
        vm.chainId(999);
        relay = new ElysiumHypeUsdRelayV1(address(feed));
        assertEq(address(relay), predicted);
        vm.deal(address(this), 1 ether);
    }

    function source(uint80 round, int256 price, uint256 time, uint80 answered) private {
        vm.mockCall(
            SOURCE,
            abi.encodeCall(IHyperEvmHypeUsdFeedV1.latestRoundData, ()),
            abi.encode(round, price, time, time, answered)
        );
    }

    function send() private {
        relay.relay{ value: 150_000 * 1 gwei + 2000 }(150_000, 1 gwei);
    }

    function testCanonicalDeliveryPreservesObservationAndRefundRecipient() public {
        send();
        assertEq(inbox.destination(), address(feed));
        assertEq(inbox.refund(), address(this));
        assertEq(relay.lastRelayedRound(), 15);
        vm.chainId(99_901);
        vm.warp(block.timestamp + 120);
        bytes memory message = inbox.message();
        vm.prank(feed.aliasedParentRelay());
        (bool ok,) = address(feed).call(message);
        assertTrue(ok);
        (uint80 round, int256 price,, uint256 time, uint80 answered) = feed.latestRoundData();
        assertEq(round, 15);
        assertEq(answered, 15);
        assertEq(price, 33e18);
        assertEq(time, block.timestamp - 180);
    }

    function testOnlyCanonicalParentAliasCanSetPrice() public {
        vm.chainId(99_901);
        vm.expectRevert(ElysiumHypeUsdFeedV1.Unauthorized.selector);
        feed.receivePrice(15, 33e18, block.timestamp);
        vm.prank(address(relay));
        vm.expectRevert(ElysiumHypeUsdFeedV1.Unauthorized.selector);
        feed.receivePrice(15, 33e18, block.timestamp);
        vm.prank(feed.aliasedParentRelay());
        feed.receivePrice(15, 33e18, block.timestamp);
    }

    function testUndeliveredRoundCanBeResentWithoutChangingPrice() public {
        send();
        bytes memory original = inbox.message();
        send();
        assertEq(inbox.ticket(), 2);
        assertEq(inbox.message(), original);
        vm.chainId(99_901);
        vm.prank(feed.aliasedParentRelay());
        (bool ok,) = address(feed).call(original);
        assertTrue(ok);
        vm.prank(feed.aliasedParentRelay());
        vm.expectRevert(ElysiumHypeUsdFeedV1.InvalidPrice.selector);
        feed.receivePrice(15, 33e18, block.timestamp - 60);
    }

    function testStaleFutureAndIncompleteSourceRejected() public {
        source(15, 33e18, block.timestamp - 86_521, 15);
        vm.expectRevert(ElysiumHypeUsdRelayV1.InvalidPrice.selector);
        send();
        source(15, 33e18, block.timestamp + 1, 15);
        vm.expectRevert(ElysiumHypeUsdRelayV1.InvalidPrice.selector);
        send();
        source(15, 33e18, block.timestamp, 14);
        vm.expectRevert(ElysiumHypeUsdRelayV1.InvalidPrice.selector);
        send();
        source(15, 0, block.timestamp, 15);
        vm.expectRevert(ElysiumHypeUsdRelayV1.InvalidPrice.selector);
        send();
    }

    function testDelayedOrOutOfOrderChildMessageRejected() public {
        vm.chainId(99_901);
        vm.startPrank(feed.aliasedParentRelay());
        vm.expectRevert(ElysiumHypeUsdFeedV1.InvalidPrice.selector);
        feed.receivePrice(15, 33e18, block.timestamp - 86_521);
        feed.receivePrice(16, 34e18, block.timestamp - 10);
        vm.expectRevert(ElysiumHypeUsdFeedV1.InvalidPrice.selector);
        feed.receivePrice(15, 33e18, block.timestamp - 5);
        vm.expectRevert(ElysiumHypeUsdFeedV1.InvalidPrice.selector);
        feed.receivePrice(17, 33e18, block.timestamp - 20);
        vm.stopPrank();
    }

    function testInboxFailureRollsBackRelayAndRuntimeChangeRejected() public {
        inbox.setFail(true);
        vm.expectRevert();
        send();
        assertEq(relay.lastRelayedRound(), 0);
        inbox.setFail(false);
        send();
        vm.etch(SOURCE, hex"00");
        vm.expectRevert(ElysiumHypeUsdRelayV1.InvalidConfiguration.selector);
        send();
    }
}
