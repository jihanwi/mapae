// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {CurveFactory} from "../src/CurveFactory.sol";
import {CurveSale} from "../src/CurveSale.sol";
import {CurvePresets as P} from "../src/CurvePresets.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {CurvePriorityBase} from "./CurvePriority.t.sol";

/// @notice v3.5 (C-T5): during the priority window no wallet, the Dev included, may hold more than
///         priorityMaxHolding (2% of supply by default) after a buy; the whole buy reverts. No cap
///         after the window or on sells.
contract CurveHoldingCapTest is CurvePriorityBase {
    uint256 internal constant CAP = 20_000_000e18;

    function _capRevert(CurveSale c, address who, uint256 quoteIn) internal view returns (bytes memory) {
        uint256 after_ = c.token().balanceOf(who) + c.quoteBuy(quoteIn).tokensOut;
        return abi.encodeWithSelector(CurveSale.PriorityHoldingExceeded.selector, after_, c.priorityMaxHolding());
    }

    // ------------------------------------------------------------------ the value

    function test_cap_DefaultIsTwoPercentOnTheCurve() public view {
        assertEq(cf.priorityMaxHoldingBps(), 200);
        assertEq(curve.priorityMaxHolding(), CAP);
        assertEq(CAP, P.TOTAL_SUPPLY * 200 / 10_000);
    }

    function test_cap_FactoryBand() public {
        for (uint16 bad = 49; bad <= 501; bad += 452) {
            vm.expectRevert(abi.encodeWithSelector(CurveFactory.PriorityMaxHoldingOutOfBand.selector, bad));
            new CurveFactory(
                IDojang(address(dojang)), feeRouter, poolFactory, factory, IWETH(address(weth)), address(this), bad
            );
        }
        CurveFactory lo = new CurveFactory(
            IDojang(address(dojang)), feeRouter, poolFactory, factory, IWETH(address(weth)), address(this), 50
        );
        CurveFactory hi = new CurveFactory(
            IDojang(address(dojang)), feeRouter, poolFactory, factory, IWETH(address(weth)), address(this), 500
        );
        assertEq(lo.priorityMaxHoldingBps(), 50);
        assertEq(hi.priorityMaxHoldingBps(), 500);
    }

    function test_cap_SetterOwnerOnlyInBandAndOnlyForNewCurves() public {
        vm.prank(anon);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, anon));
        cf.setPriorityMaxHoldingBps(300);
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.PriorityMaxHoldingOutOfBand.selector, uint16(501)));
        cf.setPriorityMaxHoldingBps(501);

        vm.expectEmit(address(cf));
        emit CurveFactory.PriorityMaxHoldingBpsSet(200, 300);
        cf.setPriorityMaxHoldingBps(300);
        assertEq(curve.priorityMaxHolding(), CAP, "open curve keeps its cap");
        vm.warp(block.timestamp + 7 days + 1); // the Dev's curve rate limit
        (CurveSale c2,) = _open(dev);
        assertEq(c2.priorityMaxHolding(), 30_000_000e18);
    }

    // ------------------------------------------------------------------ buys in the window

    function test_cap_JustUnderPassesOneStepOverReverts() public {
        uint256 q = _maxUnderCap(curve, verified1);
        _fund(curve, verified1, q + 1);
        bytes memory err = _capRevert(curve, verified1, q + 1);
        vm.prank(verified1);
        vm.expectRevert(err);
        curve.buy(q + 1, 0);

        vm.prank(verified1);
        curve.buy(q, 0);
        assertLe(token.balanceOf(verified1), CAP);
        assertGt(token.balanceOf(verified1), CAP - 1e6, "within rounding of the cap");
    }

    function test_cap_TwoBuysSummingPastTheCapRevertTheSecond() public {
        uint256 half = _maxUnderCap(curve, verified1) * 6 / 10;
        _fund(curve, verified1, half * 2);
        vm.prank(verified1);
        curve.buy(half, 0);
        uint256 held = token.balanceOf(verified1);
        bytes memory err = _capRevert(curve, verified1, half);
        vm.prank(verified1);
        vm.expectRevert(err);
        curve.buy(half, 0);
        assertEq(token.balanceOf(verified1), held);
    }

    /// @dev The cap is on the balance after the buy, not on the amount ever bought.
    function test_cap_BuySellBuyWithinTheCapPasses() public {
        uint256 q = _maxUnderCap(curve, verified1);
        _fund(curve, verified1, q * 3);
        vm.prank(verified1);
        curve.buy(q, 0);
        uint256 held = token.balanceOf(verified1);
        vm.prank(verified1);
        curve.sell(held / 2, 0); // sells are never capped
        uint256 again = _maxUnderCap(curve, verified1);
        assertGt(again, 0);
        vm.prank(verified1);
        curve.buy(again, 0);
        assertLe(token.balanceOf(verified1), CAP);
        assertGt(token.balanceOf(verified1), held / 2, "bought back toward the cap");
    }

    /// @dev buyFor counts the recipient, never the payer (the factory).
    function test_cap_BuyForUsesTheRecipient() public {
        uint256 q = _maxUnderCap(curve, verified1);
        _fund(curve, verified1, q);
        vm.prank(verified1);
        curve.buy(q, 0);

        uint256 more = 1000e18;
        deal(address(krw), address(cf), more * 2);
        vm.prank(address(cf));
        krw.approve(address(curve), type(uint256).max);
        bytes memory err = _capRevert(curve, verified1, more);
        vm.prank(address(cf));
        vm.expectRevert(err);
        curve.buyFor(verified1, more, 0);

        vm.prank(address(cf));
        (uint256 out,) = curve.buyFor(verified2, more, 0);
        assertEq(token.balanceOf(verified2), out, "a fresh recipient is fine");
        assertEq(token.balanceOf(address(cf)), 0, "the payer holds nothing");
    }

    function test_cap_BuyWithEthRevertReturnsAllEth() public {
        vm.prank(dev);
        (address ca, address ta) = cf.createCurveWithETH("Eth Cap", "ECAP", 0, CurveFactory.LaunchOptions(0, false));
        CurveSale c = CurveSale(ca);
        address buyer = verified1;
        vm.deal(buyer, 10 ether);
        uint256 q = _maxUnderCapEth(c, buyer);
        vm.prank(buyer);
        cf.buyWithETH{value: q}(c, 0);
        assertLe(MembershipToken(ta).balanceOf(buyer), CAP);

        uint256 before = buyer.balance;
        vm.prank(buyer);
        vm.expectPartialRevert(CurveSale.PriorityHoldingExceeded.selector);
        cf.buyWithETH{value: 1 ether}(c, 0);
        assertEq(buyer.balance, before, "every wei back");
        assertEq(address(cf).balance, 0);
        assertEq(weth.balanceOf(address(cf)), 0);
    }

    function _maxUnderCapEth(CurveSale c, address who) internal view returns (uint256 lo) {
        uint256 room = c.priorityMaxHolding() - c.token().balanceOf(who);
        uint256 hi = 10 ether;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (c.quoteBuy(mid).tokensOut <= room) lo = mid;
            else hi = mid - 1;
        }
    }

    function test_cap_EndsWithTheWindow() public {
        uint256 q = _maxUnderCap(curve, verified1);
        _fund(curve, verified1, q + 1_000_000e18);
        vm.prank(verified1);
        curve.buy(q, 0);

        vm.warp(curve.priorityUntil() - 1); // last second of the window
        vm.prank(verified1);
        vm.expectPartialRevert(CurveSale.PriorityHoldingExceeded.selector);
        curve.buy(1_000_000e18, 0);

        vm.warp(curve.priorityUntil()); // first second after it
        assertFalse(curve.inPriorityWindow());
        vm.prank(verified1);
        curve.buy(1_000_000e18, 0);
        assertGt(token.balanceOf(verified1), CAP);
    }

    // ------------------------------------------------------------------ the Dev

    function test_cap_DevFirstBuyUnderPassesOverRevertsAndRegistersNothing() public {
        // a reference curve gives the quote amounts (every fresh curve prices the same)
        uint256 maxIn = _maxUnderCap(curve, makeAddr("nobody"));
        _fund(curve, dev, 0);
        deal(address(krw), dev, maxIn * 3);
        vm.prank(dev);
        krw.approve(address(cf), type(uint256).max);

        uint256 n = cf.allCurves().length;
        uint256 bal = krw.balanceOf(dev);
        vm.prank(dev);
        vm.expectPartialRevert(CurveFactory.DevFirstBuyTooLarge.selector);
        cf.createCurve(IERC20(address(krw)), "Over", "OVER", maxIn + 1, 0, CurveFactory.LaunchOptions(0, false));
        assertEq(cf.allCurves().length, n, "no curve registered");
        assertEq(krw.balanceOf(dev), bal, "nothing pulled");

        vm.warp(block.timestamp + 7 days + 1); // the Dev's rate limit (setUp opened one)
        vm.prank(dev);
        (address ca, address ta) =
            cf.createCurve(IERC20(address(krw)), "Under", "UNDER", maxIn, 0, CurveFactory.LaunchOptions(0, false));
        assertLe(MembershipToken(ta).balanceOf(dev), CAP);
        assertGt(MembershipToken(ta).balanceOf(dev), CAP - 1e6);

        // the Dev's later buys inside the window count toward the same cap
        CurveSale c = CurveSale(ca);
        _fund(c, dev, 1000e18);
        vm.prank(dev);
        vm.expectPartialRevert(CurveSale.PriorityHoldingExceeded.selector);
        c.buy(1000e18, 0);
    }

    function test_cap_DevFirstBuyErrorCarriesTheCurveCap() public {
        uint256 maxIn = _maxUnderCap(curve, makeAddr("nobody"));
        uint256 over = maxIn * 2;
        deal(address(krw), dev, over);
        vm.prank(dev);
        krw.approve(address(cf), type(uint256).max);
        vm.warp(block.timestamp + 7 days + 1);
        uint256 tokensOut = curve.quoteBuy(over).tokensOut; // fresh-curve quote (curve is untraded)
        vm.prank(dev);
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.DevFirstBuyTooLarge.selector, tokensOut, CAP));
        cf.createCurve(IERC20(address(krw)), "Over", "OVER", over, 0, CurveFactory.LaunchOptions(0, false));
    }

    // ------------------------------------------------------------------ graduation in the window

    /// @dev 40 wallets at the cap fill the curve to within rounding dust (each one's largest buy
    ///      under 2% falls a few hundred wei short of 20M), and a 41st wallet's dust buy closes it,
    ///      all inside the window.
    function test_cap_FortyWalletsFillTheCurveInTheWindow() public {
        _fillWithWallets(curve, 40, "f");
        uint256 left = P.CURVE_SUPPLY - curve.s();
        emit log_named_uint("left after 40 wallets (wei)", left);
        assertLt(left, 1e6, "40 x 2% = the whole curve, up to rounding dust");
        assertFalse(curve.graduated());

        uint256 closing = _sellOutBudget(curve);
        _fund(curve, verified1, closing);
        vm.prank(verified1);
        curve.buy(closing, 0);
        assertTrue(curve.graduated());
        assertTrue(curve.inPriorityWindow(), "graduated inside the window");
        assertEq(token.balanceOf(verified1), left);
    }

    /// @dev 39 wallets leave more than one wallet's cap, so no buy inside the window can close it.
    function test_cap_ThirtyNineWalletsCannotGraduateInTheWindow() public {
        _fillWithWallets(curve, 39, "n");
        uint256 left = P.CURVE_SUPPLY - curve.s();
        assertGt(left, CAP, "more than one cap left");
        uint256 closing = _sellOutBudget(curve);
        _fund(curve, verified1, closing);
        vm.prank(verified1);
        vm.expectPartialRevert(CurveSale.PriorityHoldingExceeded.selector);
        curve.buy(closing, 0);
        assertFalse(curve.graduated());

        // after the window anyone may close it
        vm.warp(curve.priorityUntil());
        vm.prank(verified1);
        curve.buy(closing, 0);
        assertTrue(curve.graduated());
    }
}
