// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {IPrimaryMarket} from "../src/interfaces/IPrimaryMarket.sol";
import {ISettlerRegistry} from "../src/interfaces/ISettlerRegistry.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {Offering} from "../src/Offering.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MapaeFactoryTestBase} from "./MapaeFactory.t.sol";

/// @notice v3.4-L1: decision 62 (settle-only settler read from the factory at settle time),
///         the zero-commit refund path, and decision 63 (only Open/Frozen L1/L2 offerings
///         count toward the membership live cap).
contract SettlerL1Test is MapaeFactoryTestBase {
    address internal settlerA = makeAddr("settlerA");
    address internal settlerB = makeAddr("settlerB");
    address internal stranger = makeAddr("stranger");

    event SettlerUpdated(address oldSettler, address newSettler);

    function setUp() public override {
        super.setUp();
        factory.setSettler(settlerA);
    }

    /// @dev Fill the default L1 offering to exactly R (four fans), then pass the deadline.
    function _filled(address who) internal returns (Offering o) {
        (o,,) = createAs(who);
        commitAs(o, makeAddr(string.concat("f1", vm.toString(who))), WALLET_LIMIT);
        commitAs(o, makeAddr(string.concat("f2", vm.toString(who))), WALLET_LIMIT);
        commitAs(o, makeAddr(string.concat("f3", vm.toString(who))), WALLET_LIMIT);
        commitAs(o, makeAddr(string.concat("f4", vm.toString(who))), 100_000e18); // total 1M = R
        vm.warp(o.deadline());
    }

    function _settle(Offering o, address caller) internal {
        vm.prank(caller);
        o.settle(leafFor(fan1, 30e18, 0), 100e18, 1_000_000e18, bytes32(0));
    }

    function _nse(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IOffering.NotSettleAuthority.selector, who);
    }

    // ------------------------------------------------------------------
    // wiring
    // ------------------------------------------------------------------

    function test_Wiring_RegistryIsFactory() public {
        (Offering o,,) = createAs(creator);
        assertEq(address(o.settlerRegistry()), address(factory));
        assertEq(ISettlerRegistry(address(factory)).settler(), settlerA);
        assertEq(o.owner(), address(this));
    }

    // ------------------------------------------------------------------
    // settle authority
    // ------------------------------------------------------------------

    function test_Settle_BySettler() public {
        Offering o = _filled(creator);
        _settle(o, settlerA);
        assertTrue(o.settled());
    }

    function test_Settle_ByOwnerWhileSettlerSet() public {
        Offering o = _filled(creator);
        _settle(o, address(this));
        assertTrue(o.settled());
    }

    function test_Settle_RevertThirdParty() public {
        Offering o = _filled(creator);
        vm.prank(stranger);
        vm.expectRevert(_nse(stranger));
        o.settle(leafFor(fan1, 30e18, 0), 100e18, 1_000_000e18, bytes32(0));
    }

    function test_Settle_RevertIssuer() public {
        Offering o = _filled(creator);
        vm.prank(creator);
        vm.expectRevert(_nse(creator));
        o.settle(leafFor(fan1, 30e18, 0), 100e18, 1_000_000e18, bytes32(0));
    }

    /// @dev The settler gets settle and nothing else: the owner-only surface stays owner-only.
    function test_Settler_NoOtherOwnerPower() public {
        Offering o = _filled(creator);
        vm.prank(settlerA);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, settlerA));
        o.transferOwnership(settlerA);
        vm.prank(settlerA);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, settlerA));
        factory.setSettler(settlerB);
    }

    // ------------------------------------------------------------------
    // setSettler
    // ------------------------------------------------------------------

    function test_SetSettler_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.setSettler(stranger);
        assertEq(factory.settler(), settlerA);
    }

    function test_SetSettler_EmitsAndAllowsZero() public {
        vm.expectEmit(address(factory));
        emit SettlerUpdated(settlerA, settlerB);
        factory.setSettler(settlerB);
        assertEq(factory.settler(), settlerB);
        vm.expectEmit(address(factory));
        emit SettlerUpdated(settlerB, address(0));
        factory.setSettler(address(0));
        assertEq(factory.settler(), address(0));
    }

    /// @dev Read at settle time: a change on the factory reaches an offering created earlier.
    function test_SetSettler_AppliesToOpenOffering() public {
        Offering o = _filled(creator); // created while settlerA was set
        factory.setSettler(settlerB);
        vm.prank(settlerA);
        vm.expectRevert(_nse(settlerA));
        o.settle(leafFor(fan1, 30e18, 0), 100e18, 1_000_000e18, bytes32(0));
        _settle(o, settlerB);
        assertTrue(o.settled());
    }

    function test_SetSettler_ZeroMeansOwnerOnly() public {
        Offering o = _filled(creator);
        factory.setSettler(address(0));
        vm.prank(settlerA);
        vm.expectRevert(_nse(settlerA));
        o.settle(leafFor(fan1, 30e18, 0), 100e18, 1_000_000e18, bytes32(0));
        vm.prank(address(0));
        vm.expectRevert(_nse(address(0)));
        o.settle(leafFor(fan1, 30e18, 0), 100e18, 1_000_000e18, bytes32(0));
        _settle(o, address(this));
        assertTrue(o.settled());
    }

    // ------------------------------------------------------------------
    // same result whoever settles
    // ------------------------------------------------------------------

    function _settleAndRecord(Offering o, address caller)
        internal
        returns (Vm.Log[] memory logs, uint256[4] memory bal)
    {
        vm.recordLogs();
        _settle(o, caller);
        logs = vm.getRecordedLogs();
        MembershipToken t = MembershipToken(address(o.token()));
        bal[0] = krw.balanceOf(platform);
        bal[1] = krw.balanceOf(factory.proceedsLockOf(address(o)));
        bal[2] = t.totalSupply();
        bal[3] = t.balanceOf(factory.vestingOf(address(o)));
    }

    function test_Settle_SameDistributionAndEvents() public {
        Offering o = _filled(creator);
        uint256 snap = vm.snapshotState();
        (Vm.Log[] memory a, uint256[4] memory ba) = _settleAndRecord(o, address(this));
        vm.revertToState(snap);
        (Vm.Log[] memory b, uint256[4] memory bb) = _settleAndRecord(o, settlerA);

        for (uint256 i = 0; i < 4; i++) {
            assertEq(ba[i], bb[i]);
        }
        assertGt(ba[2], 0);
        assertGt(a.length, 0);
        assertEq(a.length, b.length);
        for (uint256 i = 0; i < a.length; i++) {
            assertEq(a[i].emitter, b[i].emitter);
            assertEq(a[i].data, b[i].data);
            assertEq(a[i].topics.length, b[i].topics.length);
            for (uint256 j = 0; j < a[i].topics.length; j++) {
                assertEq(a[i].topics[j], b[i].topics[j]);
            }
        }
    }

    // ------------------------------------------------------------------
    // zero-commit refunds (v3.4-L1)
    // ------------------------------------------------------------------

    function _partialParams() internal view returns (MapaeFactory.CreateParams memory cp) {
        cp = defaultCreateParams();
        cp.refundMode = IOffering.RefundMode.Partial;
    }

    function test_ZeroCommit_Partial_BeforeDeadlineReverts() public {
        vm.prank(creator);
        (address oa,,) = factory.createOffering(_partialParams());
        Offering o = Offering(oa);
        vm.expectRevert(IOffering.DeadlineNotReached.selector);
        o.enableRefunds();
    }

    function test_ZeroCommit_Partial_AfterDeadlineRefundsAndFreesSlot() public {
        vm.prank(creator);
        (address oa,,) = factory.createOffering(_partialParams());
        Offering o = Offering(oa);
        vm.warp(o.deadline());
        // the slot is still held while the offering sits Frozen at its deadline
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.ActiveOfferingExists.selector, creator, oa));
        factory.createOffering(defaultCreateParams());

        vm.expectEmit(oa);
        emit IOffering.RefundsEnabled(false);
        vm.prank(stranger); // anyone
        o.enableRefunds();
        assertEq(uint8(o.phase()), uint8(IPrimaryMarket.Phase.Refunding));

        vm.prank(creator);
        factory.createOffering(defaultCreateParams());
        assertEq(factory.offeringsByCreator(creator).length, 2);
    }

    function test_ZeroCommit_AllOrNothing_AfterDeadline() public {
        (Offering o,,) = createAs(creator);
        vm.warp(o.deadline());
        o.enableRefunds();
        assertEq(uint8(o.phase()), uint8(IPrimaryMarket.Phase.Refunding));
    }

    function test_Partial_WithCommitsStillReverts() public {
        vm.prank(creator);
        (address oa,,) = factory.createOffering(_partialParams());
        Offering o = Offering(oa);
        commitAs(o, fan1, 100_000e18);
        vm.warp(o.deadline());
        vm.expectRevert(IOffering.RefundNotAvailable.selector);
        o.enableRefunds();
    }

    // ------------------------------------------------------------------
    // live cap (decision 63)
    // ------------------------------------------------------------------

    function test_LiveCap_OpenBlocks() public {
        (Offering o,,) = createAs(creator);
        assertEq(uint8(o.phase()), uint8(IPrimaryMarket.Phase.Open));
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.ActiveOfferingExists.selector, creator, address(o)));
        factory.createOffering(defaultCreateParams());
    }

    function test_LiveCap_FrozenBlocks() public {
        (Offering o,,) = createAs(creator);
        vm.warp(o.deadline() - 1 hours);
        assertEq(uint8(o.phase()), uint8(IPrimaryMarket.Phase.Frozen));
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.ActiveOfferingExists.selector, creator, address(o)));
        factory.createOffering(defaultCreateParams());
    }

    function test_LiveCap_SettledAllows() public {
        Offering o = _filled(creator);
        _settle(o, settlerA);
        assertEq(uint8(o.phase()), uint8(IPrimaryMarket.Phase.Settled));
        vm.prank(creator);
        factory.createOffering(defaultCreateParams());
        assertEq(factory.offeringsByCreator(creator).length, 2);
    }

    function test_LiveCap_RefundingAllows() public {
        (Offering o,,) = createAs(creator);
        commitAs(o, fan1, 100_000e18); // << R
        vm.warp(o.deadline());
        o.enableRefunds();
        vm.prank(creator);
        factory.createOffering(defaultCreateParams());
        assertEq(factory.offeringsByCreator(creator).length, 2);
    }

    function test_LiveCap_SecondLiveBlocksThird() public {
        Offering o = _filled(creator);
        _settle(o, settlerA);
        vm.prank(creator);
        (address second,,) = factory.createOffering(defaultCreateParams());
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.ActiveOfferingExists.selector, creator, second));
        factory.createOffering(defaultCreateParams());
    }

    /// @dev The L0 bucket is unchanged: three live L0 still block a fourth, whatever the L1 state.
    function test_LiveCap_L0BucketUnchanged() public {
        Offering o = _filled(creator);
        _settle(o, settlerA);
        vm.startPrank(creator);
        factory.createOffering(l0CreateParams());
        factory.createOffering(l0CreateParams());
        factory.createOffering(l0CreateParams());
        vm.expectRevert();
        factory.createOffering(l0CreateParams());
        vm.stopPrank();
    }
}
