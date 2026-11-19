// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CurveFactory} from "../src/CurveFactory.sol";
import {CurveSale} from "../src/CurveSale.sol";
import {CurvePriorityBase} from "./CurvePriority.t.sol";

/// @notice v3.6 (C-T6): scheduled launch (LaunchOptions.startTime). Numbered as in the ticket (S1..S9, S16).
contract CurveScheduledTest is CurvePriorityBase {
    bytes32 internal constant CREATED_SIG_V36 =
        keccak256("CurveCreated(address,address,address,address,uint256,string,string,uint64,uint64,bool)");

    function _opts(uint64 start, bool vo) internal pure returns (CurveFactory.LaunchOptions memory) {
        return CurveFactory.LaunchOptions({startTime: start, verifiedOnly: vo});
    }

    function _openAt(address who, uint64 start, bool vo) internal returns (CurveSale c) {
        dojang.setVerified(who, true);
        vm.prank(who);
        (address ca,) = cf.createCurve(IERC20(address(krw)), "Scheduled", "SCH", 0, 0, _opts(start, vo));
        return CurveSale(ca);
    }

    function _openEthAt(address who, uint64 start) internal returns (CurveSale c) {
        dojang.setVerified(who, true);
        vm.prank(who);
        (address ca,) = cf.createCurveWithETH("Scheduled Eth", "SCHE", 0, _opts(start, false));
        return CurveSale(ca);
    }

    function _inOneHour() internal view returns (uint64) {
        return uint64(block.timestamp + 1 hours);
    }

    // ------------------------------------------------------------------ S1

    function test_S1_ImmediateWhenZero() public {
        CurveSale c = _openAt(verified1, 0, false);
        assertEq(c.startTime(), block.timestamp, "startTime = creation");
        assertTrue(c.started());
        assertEq(c.priorityUntil(), block.timestamp + 600);
        assertFalse(c.verifiedOnly());
        assertTrue(_buy(c, verified2, 1000e18), "buy right away");
    }

    // ------------------------------------------------------------------ S2

    function test_S2_StartTimeBand() public {
        uint64 early = uint64(block.timestamp + cf.MIN_START_DELAY() - 1);
        uint64 late = uint64(block.timestamp + cf.MAX_START_DELAY() + 1);
        vm.startPrank(verified1);
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.StartTimeOutOfBand.selector, early));
        cf.createCurve(IERC20(address(krw)), "Early", "E", 0, 0, _opts(early, false));
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.StartTimeOutOfBand.selector, late));
        cf.createCurve(IERC20(address(krw)), "Late", "L", 0, 0, _opts(late, false));
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.StartTimeOutOfBand.selector, uint64(block.timestamp)));
        cf.createCurve(IERC20(address(krw)), "Now", "N", 0, 0, _opts(uint64(block.timestamp), false));
        // both edges are inside the band
        (address a,) =
            cf.createCurve(IERC20(address(krw)), "Min", "MIN", 0, 0, _opts(uint64(block.timestamp + 10 minutes), false));
        (address b,) =
            cf.createCurve(IERC20(address(krw)), "Max", "MAX", 0, 0, _opts(uint64(block.timestamp + 7 days), false));
        vm.stopPrank();
        assertEq(CurveSale(a).startTime(), block.timestamp + 10 minutes);
        assertEq(CurveSale(b).startTime(), block.timestamp + 7 days);
        assertEq(cf.MIN_START_DELAY(), 10 minutes);
        assertEq(cf.MAX_START_DELAY(), 7 days);
    }

    // ------------------------------------------------------------------ S3

    function test_S3_NothingTradesBeforeStart_ViewsWork() public {
        uint64 start = _inOneHour();
        CurveSale c = _openAt(verified1, start, false);
        assertFalse(c.started());
        assertGt(c.quoteBuy(1000e18).tokensOut, 0, "quoteBuy works");
        (uint256 num, uint256 den) = c.spotPrice();
        assertGt(num, 0);
        assertGt(den, 0);

        bytes memory err = abi.encodeWithSelector(CurveSale.NotStarted.selector, start);
        _fund(c, verified2, 1000e18);
        vm.prank(verified2);
        vm.expectRevert(err);
        c.buy(1000e18, 0);

        vm.prank(verified2);
        vm.expectRevert(err);
        c.sell(1, 0);

        deal(address(krw), address(cf), 1000e18);
        vm.prank(address(cf));
        krw.approve(address(c), type(uint256).max);
        vm.prank(address(cf));
        vm.expectRevert(err);
        c.buyFor(verified2, 1000e18, 0);

        CurveSale e = _openEthAt(verified2, start);
        vm.deal(verified1, 1 ether);
        vm.prank(verified1);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotStarted.selector, start));
        cf.buyWithETH{value: 0.01 ether}(e, 0);
        assertEq(verified1.balance, 1 ether, "ETH stays with the buyer");
    }

    // ------------------------------------------------------------------ S4

    function test_S4_AtStartVerifiedBuysUnverifiedReverts() public {
        uint64 start = _inOneHour();
        CurveSale c = _openAt(verified1, start, false);
        vm.warp(start);
        assertTrue(c.started());
        assertTrue(c.inPriorityWindow());
        assertTrue(_buy(c, verified2, 1000e18));
        _fund(c, anon, 1000e18);
        vm.prank(anon);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotVerified.selector, anon));
        c.buy(1000e18, 0);
    }

    // ------------------------------------------------------------------ S5

    function test_S5_PriorityCountsFromStart() public {
        uint64 start = _inOneHour();
        CurveSale c = _openAt(verified1, start, false);
        assertEq(c.priorityUntil(), uint256(start) + 600);
        _fund(c, anon, 2000e18);
        vm.warp(uint256(start) + 599);
        vm.prank(anon);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotVerified.selector, anon));
        c.buy(1000e18, 0);
        vm.warp(uint256(start) + 600);
        assertFalse(c.inPriorityWindow());
        vm.prank(anon);
        c.buy(1000e18, 0);
        assertGt(c.token().balanceOf(anon), 0);
    }

    // ------------------------------------------------------------------ S6

    function test_S6_NoDevFirstBuyWhenScheduled() public {
        deal(address(krw), verified1, 1000e18);
        vm.prank(verified1);
        krw.approve(address(cf), type(uint256).max);
        uint256 n = cf.allCurves().length;
        vm.prank(verified1);
        vm.expectRevert(CurveFactory.DevBuyNotAllowedWhenScheduled.selector);
        cf.createCurve(IERC20(address(krw)), "Sched Buy", "SB", 1000e18, 0, _opts(_inOneHour(), false));
        assertEq(krw.balanceOf(verified1), 1000e18, "nothing pulled");

        vm.deal(verified1, 1 ether);
        vm.prank(verified1);
        vm.expectRevert(CurveFactory.DevBuyNotAllowedWhenScheduled.selector);
        cf.createCurveWithETH{value: 0.01 ether}("Sched Eth", "SE", 0, _opts(_inOneHour(), false));
        assertEq(verified1.balance, 1 ether, "ETH stays with the Dev");
        assertEq(address(cf).balance, 0);
        assertEq(cf.allCurves().length, n, "no curve registered");
    }

    // ------------------------------------------------------------------ S7

    function test_S7_DevCapAfterScheduledStart() public {
        uint64 start = _inOneHour();
        CurveSale c = _openAt(verified1, start, false);
        vm.warp(start);
        uint256 q = _maxUnderCap(c, verified1);
        _fund(c, verified1, q + 1);
        bytes memory err = abi.encodeWithSelector(
            CurveSale.PriorityHoldingExceeded.selector, c.quoteBuy(q + 1).tokensOut, c.priorityMaxHolding()
        );
        vm.prank(verified1);
        vm.expectRevert(err);
        c.buy(q + 1, 0);
        vm.prank(verified1);
        c.buy(q, 0);
        assertLe(c.token().balanceOf(verified1), c.priorityMaxHolding());
    }

    // ------------------------------------------------------------------ S8

    function test_S8_ScheduledUsesTheRateLimitAtCreation() public {
        uint256 t0 = curve.startTime(); // setUp: the Dev's first curve, created now
        vm.startPrank(dev);
        cf.createCurve(IERC20(address(krw)), "S2", "S2", 0, 0, _opts(_inOneHour(), false));
        cf.createCurve(IERC20(address(krw)), "S3", "S3", 0, 0, _opts(uint64(block.timestamp + 3 days), true));
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.CurveRateLimited.selector, t0 + 7 days));
        cf.createCurve(IERC20(address(krw)), "S4", "S4", 0, 0, _opts(_inOneHour(), false));
        vm.stopPrank();
        assertEq(cf.curvesByDev(dev).length, 3);
    }

    // ------------------------------------------------------------------ S9

    function test_S9_CurveCreatedCarriesStartAndVerifiedOnly() public {
        uint64 start = _inOneHour();
        vm.recordLogs();
        CurveSale c = _openAt(verified1, start, true);
        CurveSale d = _openAt(verified2, 0, false);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(cf) || logs[i].topics[0] != CREATED_SIG_V36) continue;
            address ca = address(uint160(uint256(logs[i].topics[2])));
            (,, string memory name,, uint64 until, uint64 st, bool vo) =
                abi.decode(logs[i].data, (address, uint256, string, string, uint64, uint64, bool));
            if (ca == address(c)) {
                assertEq(st, start);
                assertTrue(vo);
                assertEq(until, uint256(start) + 600);
            } else {
                assertEq(ca, address(d));
                assertEq(st, block.timestamp);
                assertFalse(vo);
            }
            assertEq(name, "Scheduled");
            ++found;
        }
        assertEq(found, 2);
    }

    // ------------------------------------------------------------------ S16 (fuzz)

    /// @dev Before startTime no buy succeeds, whoever buys and whatever the amount.
    function testFuzz_S16_NoBuyBeforeStart(uint32 delay, uint32 elapsed, bool verified, uint96 amount, bool eth)
        public
    {
        delay = uint32(bound(delay, cf.MIN_START_DELAY(), cf.MAX_START_DELAY()));
        elapsed = uint32(bound(elapsed, 0, delay - 1));
        amount = uint96(bound(amount, 1, 1_000_000e18));
        uint64 start = uint64(block.timestamp + delay);
        CurveSale c = eth ? _openEthAt(verified1, start) : _openAt(verified1, start, verified);
        address who = verified ? verified2 : anon;
        vm.warp(block.timestamp + elapsed);
        bytes memory err = abi.encodeWithSelector(CurveSale.NotStarted.selector, start);
        if (eth) {
            vm.deal(who, amount);
            vm.prank(who);
            vm.expectRevert(err);
            cf.buyWithETH{value: amount}(c, 0);
        } else {
            _fund(c, who, amount);
            vm.prank(who);
            vm.expectRevert(err);
            c.buy(amount, 0);
        }
        assertEq(c.s(), 0, "nothing sold");
        assertEq(c.token().balanceOf(who), 0);
    }
}
