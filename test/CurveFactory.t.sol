// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {CurveFactory} from "../src/CurveFactory.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {CurveSale} from "../src/CurveSale.sol";
import {CurvePresets as P} from "../src/CurvePresets.sol";
import {CurveMath} from "../src/lib/CurveMath.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {BuybackVault} from "../src/BuybackVault.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {MapaeFactoryTestBase} from "./MapaeFactory.t.sol";
import {TestQuote, RevertingDojangCS} from "./CurveSale.t.sol";

/// @notice CurveFactory (MAPAE v3 / Phase 1 / T8) K1..K10, once per quote asset
///         (KRWs 18-dec, 6-dec quote, WETH 18-dec Vq 0.6e18) via the concrete suites below.
abstract contract CurveFactoryTestBase is MapaeFactoryTestBase {
    uint16 internal constant BPS = 10_000;

    CurveFactory internal cf;
    IERC20 internal quote;
    TestQuote internal otherQuote; // registered but used for enable/disable tests
    address internal dev = makeAddr("dev");
    address internal stranger = makeAddr("stranger");

    function _quote() internal virtual returns (IERC20 q, uint256 vq);

    function setUp() public virtual override {
        super.setUp();
        cf = new CurveFactory(
            IDojang(address(dojang)), feeRouter, poolFactory, factory, IWETH(address(0xEeeE)), address(this)
        );
        (IERC20 q, uint256 vq) = _quote();
        quote = q;
        factory.allowQuote(quote, vq);
        otherQuote = new TestQuote("OTHER", 18);
        dojang.setVerified(dev, true);
    }

    function _vq() internal view returns (uint256) {
        return factory.quoteConfig(address(quote)).curveVirtualQuote;
    }

    function _create(address who) internal returns (CurveSale c, MembershipToken t) {
        vm.prank(who);
        (address ca, address ta) = cf.createCurve(quote, "Curve Coin", "CC", 0, 0);
        return (CurveSale(ca), MembershipToken(ta));
    }

    function _sellOutBudget(CurveSale c) internal view returns (uint256) {
        CurveMath.Params memory p =
            CurveMath.Params({vQuote: c.virtualQuote(), vToken: P.VIRTUAL_TOKEN_RESERVE, saleSupply: P.CURVE_SUPPLY});
        uint256 cost = CurveMath.costToSellOut(p, c.r(), c.s());
        return Math.mulDiv(cost, BPS, BPS - c.totalFeeBps(), Math.Rounding.Ceil) + 1;
    }

    function _fund(address who, address spender, uint256 amount) internal {
        deal(address(quote), who, quote.balanceOf(who) + amount);
        vm.prank(who);
        quote.approve(spender, type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // K1 real-name gate
    // ---------------------------------------------------------------------

    function testFuzz_K1_UnverifiedCannotCreate(address who) public {
        vm.assume(who != address(0) && !dojang.isVerified(who));
        vm.prank(who);
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.NotVerified.selector, who));
        cf.createCurve(quote, "Curve Coin", "CC", 0, 0);
    }

    function test_K1_RevertingDojangFailsClosed() public {
        CurveFactory bad = new CurveFactory(
            IDojang(address(new RevertingDojangCS())),
            feeRouter,
            poolFactory,
            factory,
            IWETH(address(0xEeeE)),
            address(this)
        );
        vm.prank(dev);
        vm.expectRevert(bytes("dojang down"));
        bad.createCurve(quote, "Curve Coin", "CC", 0, 0);
    }

    // ---------------------------------------------------------------------
    // K2 quote whitelist
    // ---------------------------------------------------------------------

    function test_K2_QuoteWhitelist() public {
        vm.prank(dev);
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.QuoteNotAllowed.selector, address(otherQuote)));
        cf.createCurve(IERC20(address(otherQuote)), "Curve Coin", "CC", 0, 0);

        (CurveSale c,) = _create(dev);
        assertEq(c.virtualQuote(), _vq(), "virtualQuote from registry");
        assertEq(address(c.quote()), address(quote));

        factory.setQuoteEnabled(address(quote), false);
        vm.prank(dev);
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.QuoteNotAllowed.selector, address(quote)));
        cf.createCurve(quote, "Curve Coin", "CC", 0, 0);

        // disabled quote: existing curve still trades and graduates
        address buyer = makeAddr("k2buyer");
        dojang.setVerified(buyer, true);
        uint256 b = _sellOutBudget(c);
        _fund(buyer, address(c), b);
        vm.prank(buyer);
        c.buy(b / 10, 0);
        uint256 closing = _sellOutBudget(c);
        vm.prank(buyer);
        c.buy(closing, 0);
        assertTrue(c.graduated());
    }

    // ---------------------------------------------------------------------
    // K3 curveEnabled
    // ---------------------------------------------------------------------

    function test_K3_CurveEnabled() public {
        assertTrue(cf.curveEnabled());
        (CurveSale c,) = _create(dev);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        cf.setCurveEnabled(false);

        vm.expectEmit(false, false, false, true, address(cf));
        emit CurveFactory.CurveEnabledSet(false);
        cf.setCurveEnabled(false);
        vm.prank(dev);
        vm.expectRevert(CurveFactory.CurvesDisabled.selector);
        cf.createCurve(quote, "Curve Coin", "CC", 0, 0);

        // existing curve unaffected
        uint256 budget = _sellOutBudget(c);
        _fund(dev, address(c), budget);
        vm.prank(dev);
        c.buy(budget, 0);
        assertTrue(c.graduated());

        cf.setCurveEnabled(true);
        _create(dev);
    }

    // ---------------------------------------------------------------------
    // K4 rate limit
    // ---------------------------------------------------------------------

    function testFuzz_K4_RateLimit(uint32 g1, uint32 g2, uint32 g3) public {
        g1 = uint32(bound(g1, 0, 4 days));
        g2 = uint32(bound(g2, 0, 4 days));
        g3 = uint32(bound(g3, 0, 10 days));
        uint256 t0 = block.timestamp;
        _create(dev);
        vm.warp(t0 + g1);
        _create(dev);
        vm.warp(t0 + g1 + g2);
        _create(dev);

        // another wallet is independent
        address other = makeAddr("otherDev");
        dojang.setVerified(other, true);
        _create(other);

        uint256 t3 = t0 + uint256(g1) + g2 + g3;
        vm.warp(t3);
        if (t3 < t0 + 7 days) {
            assertEq(cf.nextAllowedAt(dev), t0 + 7 days);
            vm.prank(dev);
            vm.expectRevert(abi.encodeWithSelector(CurveFactory.CurveRateLimited.selector, t0 + 7 days));
            cf.createCurve(quote, "Curve Coin", "CC", 0, 0);
            vm.warp(t0 + 7 days); // oldest creation leaves the window
        }
        _create(dev);
        assertEq(cf.curvesByDev(dev).length, 4);
    }

    function test_K4_FourthWithinWeekReverts() public {
        uint256 t0 = block.timestamp;
        _create(dev);
        _create(dev);
        _create(dev);
        vm.warp(t0 + 7 days - 1);
        vm.prank(dev);
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.CurveRateLimited.selector, t0 + 7 days));
        cf.createCurve(quote, "Curve Coin", "CC", 0, 0);
        vm.warp(t0 + 7 days);
        _create(dev);
    }

    // ---------------------------------------------------------------------
    // K5 dev first buy
    // ---------------------------------------------------------------------

    bytes32 internal constant BUY_SIG =
        keccak256("Buy(address,bool,bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256)");

    function test_K5_DevFirstBuy() public {
        uint256 amount = 1000 * 10 ** _decimals();
        _fund(dev, address(cf), amount);
        uint256 before = quote.balanceOf(dev);
        vm.recordLogs();
        vm.prank(dev);
        (address ca, address ta) = cf.createCurve(quote, "Curve Coin", "CC", amount, 1);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        CurveSale c = CurveSale(ca);

        (bool found, bool isDev, uint256 spent, uint256 out) = _findBuy(logs, ca);
        assertTrue(found, "Buy event");
        assertTrue(isDev, "isDev");
        assertEq(before - quote.balanceOf(dev), spent, "dev paid exactly quoteSpent");
        assertEq(MembershipToken(ta).balanceOf(dev), out, "tokens to dev");
        assertGt(out, 0);
        assertEq(c.verifiedBuyerCount(), 0, "dev not counted");
        assertFalse(c.countedVerifiedBuyer(dev), "dev never counted");
        assertEq(quote.balanceOf(address(cf)), 0, "factory holds no quote");
        assertEq(quote.allowance(address(cf), ca), 0, "allowance reset");
    }

    function test_K5_NoDevBuyWhenZero() public {
        (CurveSale c, MembershipToken t) = _create(dev);
        assertEq(c.s(), 0);
        assertEq(t.balanceOf(dev), 0);
        assertFalse(c.countedVerifiedBuyer(dev));
    }

    function test_K5_DevFirstBuyGraduatesInCreateTx() public {
        // budget well above the sell-out cost from genesis
        uint256 vq = _vq();
        uint256 cost = Math.mulDiv(vq, P.CURVE_SUPPLY, P.VIRTUAL_TOKEN_RESERVE - P.CURVE_SUPPLY, Math.Rounding.Ceil);
        uint256 amount = cost * 2;
        _fund(dev, address(cf), amount);
        uint256 before = quote.balanceOf(dev);
        vm.prank(dev);
        (address ca, address ta) = cf.createCurve(quote, "Curve Coin", "CC", amount, 0);
        CurveSale c = CurveSale(ca);
        assertTrue(c.graduated(), "graduated in create tx");
        assertEq(MembershipToken(ta).balanceOf(dev), P.CURVE_SUPPLY);
        uint256 paid = before - quote.balanceOf(dev);
        assertLt(paid, amount, "unspent refunded");
        assertApproxEqRel(paid, cost * BPS / (BPS - c.totalFeeBps()), 1e12);
        assertEq(quote.balanceOf(address(cf)), 0);
        assertEq(quote.allowance(address(cf), ca), 0);
    }

    function _findBuy(Vm.Log[] memory logs, address emitter)
        internal
        pure
        returns (bool found, bool isDev, uint256 spent, uint256 out)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == emitter && logs[i].topics[0] == BUY_SIG) {
                (isDev,, spent, out) = abi.decode(logs[i].data, (bool, bool, uint256, uint256));
                return (true, isDev, spent, out);
            }
        }
    }

    function _decimals() internal view returns (uint8) {
        return factory.quoteConfig(address(quote)).decimals;
    }

    // ---------------------------------------------------------------------
    // K6 buyFor
    // ---------------------------------------------------------------------

    function test_K6_BuyForFactoryOnly() public {
        (CurveSale c,) = _create(dev);
        vm.prank(dev);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotFactory.selector, dev));
        c.buyFor(dev, 1e18, 0);

        vm.prank(address(cf));
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotVerified.selector, stranger));
        c.buyFor(stranger, 1e18, 0);
        assertEq(c.factory(), address(cf));
    }

    // ---------------------------------------------------------------------
    // K7 registry
    // ---------------------------------------------------------------------

    function test_K7_Registry() public {
        (CurveSale c1, MembershipToken t1) = _create(dev);
        address other = makeAddr("k7");
        dojang.setVerified(other, true);
        (CurveSale c2, MembershipToken t2) = _create(other);
        (CurveSale c3,) = _create(dev);

        address[] memory all = cf.allCurves();
        assertEq(all.length, 3);
        assertEq(all[0], address(c1));
        assertEq(all[1], address(c2));
        assertEq(all[2], address(c3));
        address[] memory mine = cf.curvesByDev(dev);
        assertEq(mine.length, 2);
        assertEq(mine[0], address(c1));
        assertEq(mine[1], address(c3));
        assertEq(cf.curveOf(address(t1)), address(c1));
        assertEq(cf.curveOf(address(t2)), address(c2));
        assertEq(cf.devOf(address(t2)), other);
        assertTrue(cf.isCurve(address(c1)));
        assertFalse(cf.isCurve(address(t1)));
        assertEq(c2.dev(), other);
        assertEq(address(c1.token()), address(t1));
    }

    // ---------------------------------------------------------------------
    // K8 name / symbol bounds
    // ---------------------------------------------------------------------

    function test_K8_NameSymbolBounds() public {
        string memory n32 = "abcdefghijklmnopqrstuvwxyz012345";
        string memory n33 = "abcdefghijklmnopqrstuvwxyz0123456";
        assertEq(bytes(n32).length, 32);

        vm.startPrank(dev);
        vm.expectRevert(CurveFactory.InvalidName.selector);
        cf.createCurve(quote, "", "CC", 0, 0);
        vm.expectRevert(CurveFactory.InvalidName.selector);
        cf.createCurve(quote, n33, "CC", 0, 0);
        vm.expectRevert(CurveFactory.InvalidSymbol.selector);
        cf.createCurve(quote, "N", "", 0, 0);
        vm.expectRevert(CurveFactory.InvalidSymbol.selector);
        cf.createCurve(quote, "N", "ABCDEFGHIJK", 0, 0);
        // failed attempts do not consume the rate limit
        cf.createCurve(quote, "N", "A", 0, 0);
        cf.createCurve(quote, n32, "ABCDEFGHIJ", 0, 0);
        vm.stopPrank();
        assertEq(cf.curvesByDev(dev).length, 2);
    }

    // ---------------------------------------------------------------------
    // K10 curve tokens cannot use L1 modules
    // ---------------------------------------------------------------------

    function test_K10_BuybackVaultRejectsCurveToken() public {
        (CurveSale c, MembershipToken t) = _create(dev);
        assertEq(uint8(c.tier()), uint8(IFeeRouter.UtilityTier.L0));
        vm.expectRevert(BuybackVault.TierNotAllowed.selector);
        buybackVault.route(address(t), 1);
        vm.expectRevert(BuybackVault.TierNotAllowed.selector);
        buybackVault.topUp(address(t), 1);
    }
}

contract CurveFactoryKrws18Test is CurveFactoryTestBase {
    function _quote() internal view override returns (IERC20, uint256) {
        return (IERC20(address(krw)), P.krwsVirtualQuote(krw.decimals()));
    }

    /// @dev K9 full lifecycle on KRWs: create → 12 real-name buyers → graduate → 2 pool swaps →
    ///      dev claims. Logs gas for createCurve, a regular buy and the graduating buy.
    function test_K9_FullLifecycle() public {
        uint256 g = gasleft();
        vm.prank(dev);
        (address ca, address ta) = cf.createCurve(quote, "Curve Coin", "CC", 0, 0);
        emit log_named_uint("gas createCurve", g - gasleft());
        CurveSale c = CurveSale(ca);
        MembershipToken t = MembershipToken(ta);

        uint256 slice = _sellOutBudget(c) / 13;
        uint256 regularGas;
        for (uint256 i; i < 11; ++i) {
            address w = makeAddr(string.concat("w", vm.toString(i)));
            dojang.setVerified(w, true);
            _fund(w, address(c), slice);
            vm.prank(w);
            g = gasleft();
            c.buy(slice, 0);
            if (i == 5) regularGas = g - gasleft();
        }
        emit log_named_uint("gas buy (regular)", regularGas);
        assertFalse(c.graduated());

        address last = makeAddr("w11");
        dojang.setVerified(last, true);
        uint256 closing = _sellOutBudget(c);
        _fund(last, address(c), closing);
        vm.prank(last);
        g = gasleft();
        c.buy(closing, 0);
        emit log_named_uint("gas buy (graduating)", g - gasleft());
        assertTrue(c.graduated());
        assertEq(c.verifiedBuyerCount(), 12);

        MapaePool pool = c.pool();
        address swapper = makeAddr("w3");
        uint256 amt = pool.reserveQuote() / 100;
        deal(address(quote), swapper, amt);
        vm.startPrank(swapper);
        quote.approve(address(pool), amt);
        uint256 got = pool.swapQuoteForToken(amt, 0, swapper);
        t.approve(address(pool), got);
        pool.swapTokenForQuote(got / 2, 0, swapper);
        vm.stopPrank();

        uint256 devAcc = c.devAccrued();
        uint256 devBal = quote.balanceOf(dev);
        vm.prank(dev);
        c.claimDevFees();
        assertEq(quote.balanceOf(dev) - devBal, devAcc + 0);
        assertGt(devAcc, 0);

        assertEq(t.balanceOf(treasury), 0, "treasury holds no issued token");
        assertEq(pool.balanceOf(pool.DEAD()), pool.totalSupply(), "LP all at dEaD");
    }
}

contract CurveFactoryQuote6Test is CurveFactoryTestBase {
    function _quote() internal override returns (IERC20, uint256) {
        TestQuote q6 = new TestQuote("KRW6", 6);
        return (IERC20(address(q6)), P.krwsVirtualQuote(6));
    }
}

contract CurveFactoryWethTest is CurveFactoryTestBase {
    function _quote() internal override returns (IERC20, uint256) {
        TestQuote w = new TestQuote("WETH", 18);
        return (IERC20(address(w)), P.VIRTUAL_QUOTE_RESERVE_WETH);
    }
}
