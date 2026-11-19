// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {CurveFactory} from "../src/CurveFactory.sol";
import {CurveSale} from "../src/CurveSale.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {CurvePriorityBase} from "./CurvePriority.t.sol";

/// @dev Dojang that can be switched to revert after the curves are open (fail-closed checks).
contract SwitchDojang is IDojang {
    mapping(address => bool) public verifiedOf;
    bool public down;

    function setVerified(address a, bool v) external {
        verifiedOf[a] = v;
    }

    function setDown(bool d) external {
        down = d;
    }

    function isVerified(address a) external view returns (bool) {
        if (down) revert("dojang down");
        return verifiedOf[a];
    }
}

/// @notice v3.6 (C-T6): verified-only curves (LaunchOptions.verifiedOnly). Numbered as in the
///         ticket (V10..V15).
contract CurveVerifiedOnlyTest is CurvePriorityBase {
    function _opts(uint64 start, bool vo) internal pure returns (CurveFactory.LaunchOptions memory) {
        return CurveFactory.LaunchOptions({startTime: start, verifiedOnly: vo});
    }

    function _openVo(address who) internal returns (CurveSale c) {
        dojang.setVerified(who, true);
        vm.prank(who);
        (address ca,) = cf.createCurve(IERC20(address(krw)), "Verified Only", "VO", 0, 0, _opts(0, true));
        return CurveSale(ca);
    }

    // ------------------------------------------------------------------ V10

    function test_V10_AfterWindowOnlyVerifiedBuy() public {
        CurveSale c = _openVo(verified1);
        assertTrue(c.verifiedOnly());
        vm.warp(c.priorityUntil() + 1 days);
        assertFalse(c.inPriorityWindow());
        _fund(c, anon, 1000e18);
        vm.prank(anon);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotVerified.selector, anon));
        c.buy(1000e18, 0);
        assertTrue(_buy(c, verified2, 1000e18), "Buy.verified");

        // native ETH path: the gate is on msg.sender (the trader passed to buyFor)
        dojang.setVerified(verified1, true);
        vm.prank(verified1);
        (address ea,) = cf.createCurveWithETH("Vo Eth", "VOE", 0, _opts(0, true));
        CurveSale e = CurveSale(ea);
        vm.warp(e.priorityUntil() + 1);
        vm.deal(anon, 1 ether);
        vm.prank(anon);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotVerified.selector, anon));
        cf.buyWithETH{value: 0.01 ether}(e, 0);
        assertEq(anon.balance, 1 ether, "ETH back");
        vm.deal(verified2, 1 ether);
        vm.prank(verified2);
        (uint256 out,) = cf.buyWithETH{value: 0.01 ether}(e, 0);
        assertGt(out, 0);
    }

    // ------------------------------------------------------------------ V11

    function test_V11_NoHoldingCapAfterWindow() public {
        CurveSale c = _openVo(verified1);
        vm.warp(c.priorityUntil());
        uint256 q = _maxUnderCap(c, verified2) * 2;
        _fund(c, verified2, q);
        vm.prank(verified2);
        c.buy(q, 0);
        assertGt(c.token().balanceOf(verified2), c.priorityMaxHolding(), "past 2% after the window");
    }

    // ------------------------------------------------------------------ V12

    function test_V12_FailClosedAfterWindowOnlyWhenVerifiedOnly() public {
        SwitchDojang sd = new SwitchDojang();
        CurveFactory f = new CurveFactory(
            IDojang(address(sd)), feeRouter, poolFactory, factory, IWETH(address(weth)), address(this), 200
        );
        sd.setVerified(verified1, true);
        sd.setVerified(verified2, true);
        vm.prank(verified1);
        (address voA,) = f.createCurve(IERC20(address(krw)), "Vo", "VO", 0, 0, _opts(0, true));
        vm.prank(verified2);
        (address plainA,) = f.createCurve(IERC20(address(krw)), "Plain", "PL", 0, 0, _opts(0, false));
        CurveSale vo = CurveSale(voA);
        CurveSale plain = CurveSale(plainA);
        vm.warp(vo.priorityUntil());
        sd.setDown(true);

        _fund(vo, verified1, 1000e18);
        vm.prank(verified1);
        vm.expectRevert(bytes("dojang down"));
        vo.buy(1000e18, 0);

        // not verified-only: a reverting Dojang reads as "not verified" after the window
        _fund(plain, verified1, 1000e18);
        vm.prank(verified1);
        plain.buy(1000e18, 0);
        assertGt(plain.token().balanceOf(verified1), 0);
        assertEq(plain.verifiedBuyerCount(), 0);
    }

    // ------------------------------------------------------------------ V13

    function test_V13_UnverifiedHolderCanSell() public {
        CurveSale c = _openVo(verified1);
        _buy(c, verified2, 1000e18);
        uint256 bal = c.token().balanceOf(verified2);
        dojang.setVerified(verified2, false);
        vm.prank(verified2);
        c.sell(bal / 2, 0); // inside the window
        vm.warp(c.priorityUntil() + 1 days);
        vm.prank(verified2);
        uint256 out = c.sell(bal / 4, 0);
        assertGt(out, 0);
        // but it can no longer buy
        _fund(c, verified2, 100e18);
        vm.prank(verified2);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotVerified.selector, verified2));
        c.buy(100e18, 0);
    }

    // ------------------------------------------------------------------ V14

    function test_V14_GraduatedPoolIsOpen() public {
        CurveSale c = _openVo(verified1);
        vm.warp(c.priorityUntil());
        uint256 closing = _sellOutBudget(c);
        _fund(c, verified2, closing);
        vm.prank(verified2);
        c.buy(closing, 0);
        assertTrue(c.graduated());

        MapaePool pool = c.pool();
        deal(address(krw), anon, 10_000e18);
        vm.startPrank(anon);
        krw.approve(address(pool), type(uint256).max);
        uint256 out = pool.swapQuoteForToken(10_000e18, 0, anon);
        assertGt(out, 0);
        c.token().approve(address(pool), type(uint256).max);
        assertGt(pool.swapTokenForQuote(out / 2, 0, anon), 0);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ V15

    function test_V15_ScheduledAndVerifiedOnly() public {
        uint64 start = uint64(block.timestamp + 2 hours);
        dojang.setVerified(verified1, true);
        vm.prank(verified1);
        (address ca,) = cf.createCurve(IERC20(address(krw)), "Both", "BOTH", 0, 0, _opts(start, true));
        CurveSale c = CurveSale(ca);
        assertTrue(c.verifiedOnly());
        assertEq(c.startTime(), start);

        _fund(c, verified2, 3000e18);
        _fund(c, anon, 3000e18);
        vm.prank(verified2);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotStarted.selector, start));
        c.buy(1000e18, 0);

        vm.warp(start);
        vm.prank(anon);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotVerified.selector, anon));
        c.buy(1000e18, 0);
        vm.prank(verified2);
        c.buy(1000e18, 0);

        vm.warp(c.priorityUntil() + 3 days);
        vm.prank(anon);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotVerified.selector, anon));
        c.buy(1000e18, 0);
        vm.prank(verified2);
        c.buy(1000e18, 0);
    }
}
