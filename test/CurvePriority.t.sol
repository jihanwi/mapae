// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {CurveFactory} from "../src/CurveFactory.sol";
import {CurveSale} from "../src/CurveSale.sol";
import {CurvePresets as P} from "../src/CurvePresets.sol";
import {CurveMath} from "../src/lib/CurveMath.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MapaeFactoryTestBase} from "./MapaeFactory.t.sol";
import {TestWETH9} from "./CurveFactoryETH.t.sol";

/// @notice v3.1 real-name priority window on CurveSale / CurveFactory.
/// @dev Shared setup: a KRWs curve on a CurveFactory with the default 600 s window and 2% cap.
abstract contract CurvePriorityBase is MapaeFactoryTestBase {
    uint16 internal constant BPS = 10_000;
    bytes32 internal constant BUY_SIG =
        keccak256("Buy(address,bool,bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256)");
    bytes32 internal constant CREATED_SIG =
        keccak256("CurveCreated(address,address,address,address,uint256,string,string,uint64)");

    TestWETH9 internal weth;
    CurveFactory internal cf;
    CurveSale internal curve;
    MembershipToken internal token;
    address internal dev = makeAddr("dev");
    address internal verified1 = makeAddr("verified1");
    address internal verified2 = makeAddr("verified2");
    address internal anon = makeAddr("anon");

    function setUp() public override {
        super.setUp();
        weth = new TestWETH9();
        factory.allowQuote(IERC20(address(krw)), P.krwsVirtualQuote(krw.decimals()));
        factory.allowQuote(IERC20(address(weth)), P.VIRTUAL_QUOTE_RESERVE_WETH);
        cf = new CurveFactory(
            IDojang(address(dojang)), feeRouter, poolFactory, factory, IWETH(address(weth)), address(this), 200
        );
        dojang.setVerified(dev, true);
        dojang.setVerified(verified1, true);
        dojang.setVerified(verified2, true);
        (curve, token) = _open(dev);
    }

    // ------------------------------------------------------------------ helpers

    function _open(address who) internal returns (CurveSale c, MembershipToken t) {
        vm.prank(who);
        (address ca, address ta) = cf.createCurve(IERC20(address(krw)), "Priority", "PRI", 0, 0);
        return (CurveSale(ca), MembershipToken(ta));
    }

    function _fund(CurveSale c, address who, uint256 amount) internal {
        deal(address(krw), who, krw.balanceOf(who) + amount);
        vm.startPrank(who);
        krw.approve(address(c), type(uint256).max);
        c.token().approve(address(c), type(uint256).max);
        vm.stopPrank();
    }

    function _buy(CurveSale c, address who, uint256 amount) internal returns (bool verified) {
        _fund(c, who, amount);
        vm.recordLogs();
        vm.prank(who);
        c.buy(amount, 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(c) && logs[i].topics[0] == BUY_SIG) {
                (, verified) = abi.decode(logs[i].data, (bool, bool));
                return verified;
            }
        }
        revert("no Buy event");
    }

    function _afterWindow() internal {
        vm.warp(curve.priorityUntil());
    }

    function _sellOutBudget(CurveSale c) internal view returns (uint256) {
        CurveMath.Params memory p =
            CurveMath.Params({vQuote: c.virtualQuote(), vToken: P.VIRTUAL_TOKEN_RESERVE, saleSupply: P.CURVE_SUPPLY});
        uint256 cost = CurveMath.costToSellOut(p, c.r(), c.s());
        return Math.mulDiv(cost, BPS, BPS - c.totalFeeBps(), Math.Rounding.Ceil) + 1;
    }

    /// @dev v3.5: the largest quote budget whose buy keeps `who` at or under the holding cap.
    function _maxUnderCap(CurveSale c, address who) internal view returns (uint256 lo) {
        uint256 room = c.priorityMaxHolding() - c.token().balanceOf(who);
        uint256 hi = _sellOutBudget(c);
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (c.quoteBuy(mid).tokensOut <= room) lo = mid;
            else hi = mid - 1;
        }
    }

    /// @dev v3.5: `n` fresh verified wallets each buy the most they can under the cap.
    function _fillWithWallets(CurveSale c, uint256 n, string memory tag) internal {
        for (uint256 i; i < n; ++i) {
            address w = makeAddr(string.concat(tag, vm.toString(i)));
            dojang.setVerified(w, true);
            uint256 q = _maxUnderCap(c, w);
            _fund(c, w, q);
            vm.prank(w);
            c.buy(q, 0);
        }
    }
}

contract CurvePriorityTest is CurvePriorityBase {
    // ------------------------------------------------------------------ window

    function test_priority_InWindow_VerifiedBuysUnverifiedReverts() public {
        assertTrue(curve.inPriorityWindow());
        assertEq(curve.priorityUntil(), block.timestamp + 600);
        assertTrue(_buy(curve, verified1, 1000e18), "Buy.verified inside the window");
        assertEq(curve.verifiedBuyerCount(), 1);

        _fund(curve, anon, 1000e18);
        vm.prank(anon);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotVerified.selector, anon));
        curve.buy(1000e18, 0);
    }

    function test_priority_Boundary() public {
        _fund(curve, anon, 2000e18);
        vm.warp(curve.priorityUntil() - 1);
        assertTrue(curve.inPriorityWindow());
        vm.prank(anon);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotVerified.selector, anon));
        curve.buy(1000e18, 0);

        vm.warp(curve.priorityUntil());
        assertFalse(curve.inPriorityWindow());
        vm.prank(anon);
        curve.buy(1000e18, 0);
        assertGt(token.balanceOf(anon), 0);
    }

    function test_priority_DojangRevertInWindowRevertsBuy() public {
        _fund(curve, verified1, 1000e18);
        vm.mockCallRevert(address(dojang), abi.encodeWithSelector(IDojang.isVerified.selector), bytes("dojang down"));
        vm.prank(verified1);
        vm.expectRevert(bytes("dojang down"));
        curve.buy(1000e18, 0);
    }

    function test_priority_DojangRevertAfterWindowStillBuys() public {
        _afterWindow();
        vm.mockCallRevert(address(dojang), abi.encodeWithSelector(IDojang.isVerified.selector), bytes("dojang down"));
        assertFalse(_buy(curve, verified1, 1000e18), "reverting Dojang reads as unverified");
        assertEq(curve.verifiedBuyerCount(), 0);
        assertGt(token.balanceOf(verified1), 0);
        vm.clearMockedCalls();
    }

    function test_priority_AfterWindow_CountsVerifiedOnly() public {
        _afterWindow();
        assertFalse(_buy(curve, anon, 1000e18));
        assertEq(curve.verifiedBuyerCount(), 0, "unverified not counted");
        assertFalse(curve.countedVerifiedBuyer(anon));
        assertTrue(_buy(curve, verified1, 1000e18));
        assertEq(curve.verifiedBuyerCount(), 1, "verified counted after the window");
    }

    function test_priority_LateVerificationCountedOnce() public {
        _afterWindow();
        _buy(curve, anon, 1000e18);
        assertEq(curve.verifiedBuyerCount(), 0);
        dojang.setVerified(anon, true);
        assertTrue(_buy(curve, anon, 1000e18));
        assertEq(curve.verifiedBuyerCount(), 1, "counted on the first verified buy");
        _buy(curve, anon, 1000e18);
        assertEq(curve.verifiedBuyerCount(), 1, "never twice");
    }

    function test_priority_SellOpenToAnyHolder() public {
        _buy(curve, verified1, 1000e18);
        _afterWindow();
        _buy(curve, anon, 1000e18);

        uint256 bal = token.balanceOf(anon);
        vm.prank(anon);
        curve.sell(bal, 0);
        assertEq(token.balanceOf(anon), 0, "unverified holder sold");

        dojang.setVerified(verified1, false);
        bal = token.balanceOf(verified1);
        vm.prank(verified1);
        curve.sell(bal, 0);
        assertEq(token.balanceOf(verified1), 0, "revoked holder sold");
    }

    function test_priority_DevFirstBuyErc20AndEth() public {
        uint256 amount = 1000e18;
        deal(address(krw), dev, amount);
        vm.prank(dev);
        krw.approve(address(cf), amount);
        // rate limit: dev already opened one curve in setUp
        vm.prank(dev);
        (address ca,) = cf.createCurve(IERC20(address(krw)), "Dev Buy", "DB", amount, 1);
        CurveSale c = CurveSale(ca);
        assertGt(c.s(), 0, "dev bought inside the window");
        assertEq(c.verifiedBuyerCount(), 0, "dev not counted");

        vm.deal(dev, 1 ether);
        vm.prank(dev);
        (address ce,) = cf.createCurveWithETH{value: 0.01 ether}("Dev Eth", "DE", 1); // v3.5: under the 2% first-buy cap
        assertGt(CurveSale(ce).s(), 0, "dev ETH buy inside the window");
        assertEq(CurveSale(ce).verifiedBuyerCount(), 0);
        assertFalse(CurveSale(ce).countedVerifiedBuyer(dev));
    }

    function test_priority_EthBuyRespectsWindow() public {
        vm.prank(dev);
        (address ce,) = cf.createCurveWithETH("Eth", "ETH1", 0);
        vm.deal(anon, 1 ether);
        vm.prank(anon);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotVerified.selector, anon));
        cf.buyWithETH{value: 0.1 ether}(CurveSale(ce), 0);
        vm.warp(CurveSale(ce).priorityUntil());
        vm.prank(anon);
        cf.buyWithETH{value: 0.1 ether}(CurveSale(ce), 0);
        assertEq(CurveSale(ce).verifiedBuyerCount(), 0);
    }

    // ------------------------------------------------------------------ factory setting

    function test_priority_SetPriorityWindow() public {
        vm.prank(anon);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, anon));
        cf.setPriorityWindow(900);

        vm.expectRevert(abi.encodeWithSelector(CurveFactory.PriorityWindowOutOfBand.selector, uint32(59)));
        cf.setPriorityWindow(59);
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.PriorityWindowOutOfBand.selector, uint32(3601)));
        cf.setPriorityWindow(3601);

        vm.expectEmit(false, false, false, true, address(cf));
        emit CurveFactory.PriorityWindowSet(600, 60);
        cf.setPriorityWindow(60);
        assertEq(cf.priorityWindow(), 60);
        vm.expectEmit(false, false, false, true, address(cf));
        emit CurveFactory.PriorityWindowSet(60, 3600);
        cf.setPriorityWindow(3600);
        assertEq(cf.priorityWindow(), 3600);
    }

    function test_priority_ChangeDoesNotAffectOpenCurves() public {
        uint64 before = curve.priorityUntil();
        cf.setPriorityWindow(3600);
        assertEq(curve.priorityUntil(), before, "open curve keeps its window");
        (CurveSale c2,) = _open(verified1);
        assertEq(c2.priorityUntil(), block.timestamp + 3600, "new curve uses the new window");
    }

    function test_priority_CurveCreatedCarriesPriorityUntil() public {
        vm.recordLogs();
        vm.prank(verified1);
        (address ca,) = cf.createCurve(IERC20(address(krw)), "Event", "EVT", 0, 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(cf) && logs[i].topics[0] == CREATED_SIG) {
                (,,,, uint64 until) = abi.decode(logs[i].data, (address, uint256, string, string, uint64));
                assertEq(until, CurveSale(ca).priorityUntil());
                found = true;
            }
        }
        assertTrue(found);
    }

    function test_priority_GraduateInWindowPoolOpenToAnyone() public {
        // v3.5: no single wallet can sell out the curve inside the window; 40 wallets at the 2%
        // cap fill it to within rounding dust and a 41st buys the dust (CurveHoldingCap.t.sol)
        _fillWithWallets(curve, 40, "g");
        uint256 closing = _sellOutBudget(curve);
        _fund(curve, verified1, closing);
        vm.prank(verified1);
        curve.buy(closing, 0);
        assertTrue(curve.graduated());
        assertTrue(curve.inPriorityWindow(), "graduated inside the window");

        MapaePool pool = curve.pool();
        deal(address(krw), anon, 10_000e18);
        vm.startPrank(anon);
        krw.approve(address(pool), type(uint256).max);
        uint256 out = pool.swapQuoteForToken(10_000e18, 0, anon);
        assertGt(out, 0);
        token.approve(address(pool), type(uint256).max);
        assertGt(pool.swapTokenForQuote(out / 2, 0, anon), 0);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ fuzz

    /// @dev buy succeeds <=> (after the window) or (verified).
    function testFuzz_priority_BuyIffOpenOrVerified(uint32 dt, bool isVerified, uint96 amount) public {
        dt = uint32(bound(dt, 0, 7200));
        amount = uint96(bound(amount, 1e18, 30_000e18)); // v3.5: stays under the 2% holding cap
        address who = makeAddr("fuzzer");
        dojang.setVerified(who, isVerified);
        _fund(curve, who, amount);
        vm.warp(block.timestamp + dt);
        bool open = block.timestamp >= curve.priorityUntil();
        vm.prank(who);
        try curve.buy(amount, 0) {
            assertTrue(open || isVerified, "bought while closed and unverified");
            assertEq(curve.verifiedBuyerCount(), isVerified ? 1 : 0);
        } catch (bytes memory reason) {
            assertFalse(open || isVerified, "blocked while it should be allowed");
            assertEq(bytes4(reason), CurveSale.NotVerified.selector);
        }
    }
}
