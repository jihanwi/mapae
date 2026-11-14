// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CurveSale} from "../src/CurveSale.sol";
import {CurvePresets as P} from "../src/CurvePresets.sol";
import {CurveMath} from "../src/lib/CurveMath.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IPrimaryMarket} from "../src/interfaces/IPrimaryMarket.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

/// @dev Quote stand-in with configurable decimals (6-dec KRWs variant, WETH-like 18-dec).
contract TestQuote is ERC20 {
    uint8 internal immutable _dec;

    constructor(string memory n, uint8 d) ERC20(n, n) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }
}

contract RevertingDojangCS is IDojang {
    function isVerified(address) external pure returns (bool) {
        revert("dojang down");
    }
}

/// @notice CurveSale (MAPAE v3 / Phase 1 / T7) C1..C13. Run once per quote asset via the
///         concrete suites at the bottom (KRWs 18-dec, 6-dec quote, WETH 18-dec Vq 0.6e18).
abstract contract CurveSaleTestBase is Test {
    uint256 internal constant N_OPS = 10;
    uint16 internal constant BPS = 10_000;

    IERC20 internal quote;
    uint256 internal vq;
    MockDojang internal dojang;
    FeeRouter internal feeRouter;
    PoolFactory internal poolFactory;
    CurveSale internal curve;
    MembershipToken internal token;

    address internal treasury = makeAddr("treasury");
    address internal dev = makeAddr("dev");
    address internal mapaeFactory = makeAddr("mapaeFactory");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal stranger = makeAddr("stranger");

    /// @dev Concrete suites supply the quote asset and its virtual quote reserve.
    function _deployQuote() internal virtual returns (IERC20 q, uint256 virtualQuote);

    uint32 internal constant PRIORITY_WINDOW = 600;

    function setUp() public {
        vm.warp(1_750_000_000);
        (quote, vq) = _deployQuote();
        dojang = new MockDojang();
        dojang.setVerified(dev, true);
        dojang.setVerified(alice, true);
        dojang.setVerified(bob, true);
        dojang.setVerified(carol, true);
        feeRouter = new FeeRouter(address(this), treasury);
        poolFactory = new PoolFactory();
        curve = _newCurve(IDojang(address(dojang)));
        token = curve.token();
    }

    function _newCurve(IDojang d) internal returns (CurveSale c) {
        c = new CurveSale(
            CurveSale.InitParams({
                quote: quote,
                dojang: d,
                dev: dev,
                feeRouter: feeRouter,
                poolFactory: poolFactory,
                mapaeFactory: mapaeFactory,
                tokenName: "Curve Token",
                tokenSymbol: "CRV",
                virtualQuote: vq,
                priorityWindow: PRIORITY_WINDOW
            })
        );
    }

    function _params() internal view returns (CurveMath.Params memory) {
        return CurveMath.Params({vQuote: vq, vToken: P.VIRTUAL_TOKEN_RESERVE, saleSupply: P.CURVE_SUPPLY});
    }

    /// @dev Gross quote budget that certainly sells out the curve from the current state.
    function _sellOutBudget(CurveSale c) internal view returns (uint256) {
        uint256 cost = CurveMath.costToSellOut(_params(), c.r(), c.s());
        return Math.mulDiv(cost, BPS, BPS - c.totalFeeBps(), Math.Rounding.Ceil) + 1;
    }

    function _fund(address who, uint256 amount) internal {
        deal(address(quote), who, quote.balanceOf(who) + amount);
        vm.prank(who);
        quote.approve(address(curve), type(uint256).max);
        vm.prank(who);
        token.approve(address(curve), type(uint256).max);
    }

    function _accrued() internal view returns (uint256) {
        return curve.devAccrued() + curve.platformAccrued() + curve.lpSeedAccrued();
    }

    // ---------------------------------------------------------------------
    // Random-sequence engine (C2, C3, C4, C5 checked on every step)
    // ---------------------------------------------------------------------

    uint256 internal devNet; // dev tokens bought − sold

    function _trader(uint256 seed) internal view returns (address) {
        uint256 i = seed % 4;
        return i == 0 ? alice : i == 1 ? bob : i == 2 ? carol : dev;
    }

    /// @return graduatedNow true when this step graduated the curve
    function _step(uint256 seed) internal returns (bool graduatedNow) {
        address who = _trader(seed);
        bool isBuy = (seed >> 8) % 3 != 0 || token.balanceOf(who) == 0;
        if (isBuy) {
            uint256 budget = _sellOutBudget(curve);
            // mostly partial buys; ~1/16 of buys may overshoot and graduate
            uint256 cap = (seed >> 16) % 16 == 0 ? budget * 2 : budget / 8 + 1;
            uint256 quoteIn = bound(seed >> 24, 1, cap);
            _fund(who, quoteIn);
            CurveSale.BuyQuote memory q = curve.quoteBuy(quoteIn);
            if (q.tokensOut == 0) return false;
            _checkBuy(who, quoteIn, q);
            if (who == dev) devNet += q.tokensOut;
            return q.graduates;
        } else {
            uint256 bal = token.balanceOf(who);
            uint256 tokenIn = bound(seed >> 24, 1, bal);
            _checkSell(who, tokenIn);
            if (who == dev) devNet -= tokenIn;
            return false;
        }
    }

    function _checkBuy(address who, uint256 quoteIn, CurveSale.BuyQuote memory q) internal {
        _checkBuyFormula(quoteIn, q);
        _checkBuyExec(who, quoteIn, q);
        _checkAccounting();
    }

    /// @dev C4: preview matches the fee formula from first principles.
    function _checkBuyFormula(uint256 quoteIn, CurveSale.BuyQuote memory q) internal view {
        uint256 t = curve.totalFeeBps();
        uint256 net = quoteIn - quoteIn * t / BPS;
        (uint256 expOut, uint256 used) = CurveMath.buyExactQuoteIn(_params(), curve.r(), curve.s(), net);
        uint256 expP = Math.min(quoteIn, Math.mulDiv(used, BPS, BPS - t, Math.Rounding.Ceil));
        assertEq(q.tokensOut, expOut, "C4 tokensOut");
        assertEq(q.quoteSpent, expP, "C4 P");
        assertEq(q.platformFee, expP * curve.platformBps() / BPS, "C4 platform");
        assertEq(q.devFee, expP * curve.devBps() / BPS, "C4 dev");
        assertEq(q.platformFee + q.devFee + q.lpSeedFee, expP - used, "C4 split sum");
        assertEq(q.refund, quoteIn - expP, "C4 refund");
    }

    /// @dev C3 + C4: execution pulls exactly quoteSpent and matches the preview wei for wei.
    function _checkBuyExec(address who, uint256 quoteIn, CurveSale.BuyQuote memory q) internal {
        uint256 balBefore = quote.balanceOf(who);
        uint256 tokBefore = token.balanceOf(who);
        uint256[3] memory accBefore = [curve.platformAccrued(), curve.devAccrued(), curve.lpSeedAccrued()];
        vm.prank(who);
        (uint256 out, uint256 spent) = curve.buy(quoteIn, 0);

        assertEq(balBefore - quote.balanceOf(who), spent, "C3 pulled != spent");
        assertLe(spent, quoteIn, "C3 overpay");
        assertEq(out, q.tokensOut, "C4 out");
        assertEq(spent, q.quoteSpent, "C4 spent");
        assertEq(token.balanceOf(who) - tokBefore, out);
        assertEq(curve.platformAccrued() - accBefore[0], q.platformFee);
        assertEq(curve.devAccrued() - accBefore[1], q.devFee);
        if (!q.graduates) {
            assertEq(curve.lpSeedAccrued() - accBefore[2], q.lpSeedFee);
            assertEq(curve.r(), q.nextR);
            assertEq(curve.s(), q.nextS);
        }
    }

    function _checkSell(address who, uint256 tokenIn) internal {
        CurveSale.SellQuote memory q = curve.quoteSell(tokenIn);
        uint256 gross = CurveMath.sellExactTokenIn(_params(), curve.r(), curve.s(), tokenIn);
        uint256 t = curve.totalFeeBps();
        assertEq(q.platformFee, gross * curve.platformBps() / BPS, "C4 sell platform");
        assertEq(q.devFee, gross * curve.devBps() / BPS, "C4 sell dev");
        assertEq(q.platformFee + q.devFee + q.lpSeedFee, gross * t / BPS, "C4 sell split");
        assertEq(q.quoteOut, gross - gross * t / BPS, "C4 sell out");

        uint256 balBefore = quote.balanceOf(who);
        uint256 accBefore = _accrued();
        vm.prank(who);
        uint256 got = curve.sell(tokenIn, 0);
        assertEq(got, q.quoteOut, "C4 sell exec");
        assertEq(quote.balanceOf(who) - balBefore, got);
        assertEq(_accrued() - accBefore, gross * t / BPS);
        assertEq(curve.r(), q.nextR);
        assertEq(curve.s(), q.nextS);
        _checkAccounting();
    }

    function _checkAccounting() internal view {
        if (curve.graduated()) {
            // post-graduation: only accrued dev/platform fees remain; no tokens left
            assertEq(quote.balanceOf(address(curve)), curve.devAccrued() + curve.platformAccrued(), "C2 post");
            assertEq(token.balanceOf(address(curve)), 0, "C2 post tokens");
        } else {
            assertEq(quote.balanceOf(address(curve)), curve.r() + _accrued(), "C2 quote");
            assertEq(token.balanceOf(address(curve)), P.TOTAL_SUPPLY - curve.s(), "C2 token");
        }
        // C5: no issued token ever reaches the treasury
        assertEq(token.balanceOf(treasury), 0, "C5 treasury");
    }

    function _runSequence(uint256[N_OPS] memory seeds) internal {
        for (uint256 i; i < N_OPS; ++i) {
            if (_step(seeds[i])) break;
        }
        // C5: dev holds exactly what dev bought − sold (no fee paid in tokens)
        assertEq(token.balanceOf(dev), devNet, "C5 dev");
    }

    // ---------------------------------------------------------------------
    // C1 real-name gate
    // ---------------------------------------------------------------------

    function testFuzz_C1_priority_UnverifiedCannotBuyInWindow(address who, uint256 amount) public {
        vm.assume(who != address(0) && !dojang.isVerified(who));
        amount = bound(amount, 1, 1e30);
        vm.prank(who);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotVerified.selector, who));
        curve.buy(amount, 0);
    }

    function test_C1_priority_RevertingDojangFailsClosedInWindow() public {
        CurveSale bad = _newCurve(IDojang(address(new RevertingDojangCS())));
        vm.prank(alice);
        vm.expectRevert(bytes("dojang down"));
        bad.buy(1e18, 0);
    }

    // ---------------------------------------------------------------------
    // C2 – C5 random sequences
    // ---------------------------------------------------------------------

    function testFuzz_C2_C3_C4_C5_RandomSequence(uint256[N_OPS] memory seeds) public {
        _runSequence(seeds);
    }

    function test_C3_OversizedClosingBuyPullsOnlyNeeded() public {
        uint256 budget = _sellOutBudget(curve);
        uint256 quoteIn = budget * 100;
        _fund(alice, quoteIn);
        CurveSale.BuyQuote memory q = curve.quoteBuy(quoteIn);
        uint256 before = quote.balanceOf(alice);
        vm.prank(alice);
        (uint256 out, uint256 spent) = curve.buy(quoteIn, 0);
        assertEq(out, P.CURVE_SUPPLY);
        assertEq(spent, q.quoteSpent);
        assertLe(spent, budget);
        assertEq(before - quote.balanceOf(alice), spent);
        assertTrue(curve.graduated());
    }

    // ---------------------------------------------------------------------
    // C6 single-wallet self-graduation
    // ---------------------------------------------------------------------

    function test_C6_SingleWalletSelfGraduates() public {
        uint256 budget = _sellOutBudget(curve);
        _fund(alice, budget);
        vm.prank(alice);
        (uint256 out,) = curve.buy(budget, 0);
        assertEq(out, P.CURVE_SUPPLY);
        assertEq(token.balanceOf(alice), P.CURVE_SUPPLY);
        assertTrue(curve.graduated());
        assertTrue(address(curve.pool()) != address(0));
        assertEq(uint8(curve.phase()), uint8(IPrimaryMarket.Phase.Settled));
        assertEq(curve.verifiedBuyerCount(), 1);
    }

    // ---------------------------------------------------------------------
    // C7 verified buyer count
    // ---------------------------------------------------------------------

    function test_C7_VerifiedBuyerCount() public {
        uint256 small = _sellOutBudget(curve) / 100;
        _fund(alice, small * 3);
        _fund(bob, small);
        _fund(dev, small * 2);

        vm.prank(dev);
        curve.buy(small, 0);
        assertEq(curve.verifiedBuyerCount(), 0, "dev excluded");

        vm.expectEmit(true, false, false, true, address(curve));
        emit CurveSale.VerifiedBuyerCounted(alice, 1);
        vm.prank(alice);
        curve.buy(small, 0);
        assertEq(curve.verifiedBuyerCount(), 1);

        vm.startPrank(alice);
        curve.sell(token.balanceOf(alice), 0);
        curve.buy(small, 0);
        curve.buy(small, 0);
        vm.stopPrank();
        assertEq(curve.verifiedBuyerCount(), 1, "rebuy does not recount");

        vm.prank(bob);
        curve.buy(small, 0);
        assertEq(curve.verifiedBuyerCount(), 2);

        vm.prank(dev);
        curve.buy(small, 0);
        assertEq(curve.verifiedBuyerCount(), 2, "dev never counted");
        assertFalse(curve.countedVerifiedBuyer(dev));
    }

    function testFuzz_C7_CountMonotonic(uint256[N_OPS] memory seeds) public {
        uint32 last;
        for (uint256 i; i < N_OPS; ++i) {
            bool g = _step(seeds[i]);
            uint32 c = curve.verifiedBuyerCount();
            assertGe(c, last, "C7 monotonic");
            assertLe(c, 3, "C7 at most 3 non-dev wallets");
            last = c;
            if (g) break;
        }
    }

    // ---------------------------------------------------------------------
    // C8 graduation
    // ---------------------------------------------------------------------

    /// @dev Graduates with a mixed history; returns (rFinal, lpSeedFinal) moved into the pool.
    function _graduateWithHistory() internal returns (uint256 rFinal, uint256 lpFinal) {
        uint256 b = _sellOutBudget(curve) / 10;
        _fund(alice, b);
        vm.prank(alice);
        curve.buy(b, 0);
        vm.startPrank(alice);
        curve.sell(token.balanceOf(alice) / 2, 0);
        vm.stopPrank();
        uint256 closing = _sellOutBudget(curve);
        _fund(bob, closing);
        CurveSale.BuyQuote memory q = curve.quoteBuy(closing);
        uint256 lpBefore = curve.lpSeedAccrued();
        vm.prank(bob);
        curve.buy(closing, 0);
        assertTrue(curve.graduated());
        rFinal = q.nextR;
        lpFinal = lpBefore + q.lpSeedFee;
    }

    function test_C8_GraduationPoolSeedAndPrice() public {
        (uint256 rF, uint256 lpF) = _graduateWithHistory();
        MapaePool pool = curve.pool();
        assertEq(pool.balanceOf(pool.DEAD()), pool.totalSupply(), "LP all at dEaD");
        assertGt(pool.totalSupply(), 0);
        assertEq(pool.reserveToken(), P.DEX_SUPPLY);
        assertEq(pool.reserveQuote(), rF + lpF);
        assertEq(curve.graduationReserve(), rF);
        assertEq(curve.r(), 0);
        assertEq(curve.lpSeedAccrued(), 0);

        // price: pool spot ≥ curve close; (pool − close)/close ≈ lpF / rF within 1e-9
        uint256 closeNum = vq + rF;
        uint256 closeDen = P.VIRTUAL_TOKEN_RESERVE - P.CURVE_SUPPLY;
        assertGe(pool.reserveQuote() * closeDen, closeNum * pool.reserveToken(), "pool >= close");
        uint256 ratio = Math.mulDiv(pool.reserveQuote() * 1e18, closeDen, closeNum * pool.reserveToken());
        uint256 rel = ratio - 1e18;
        uint256 expected = lpF * 1e18 / rF;
        assertApproxEqAbs(rel, expected, 1e9, "C8 premium == lpSeed / r");
        emit log_named_uint("C8 rel premium (1e18)", rel);
        emit log_named_uint("C8 lpSeed/r      (1e18)", expected);
    }

    function test_C8_ZeroLpSeedPriceContinuity() public {
        feeRouter.setCurveFees(IFeeRouter.CurveFees({platformBps: 60, devBps: 40, lpSeedBps: 0}));
        curve = _newCurve(IDojang(address(dojang)));
        token = curve.token();
        assertEq(curve.lpSeedBps(), 0);
        (uint256 rF, uint256 lpF) = _graduateWithHistory();
        MapaePool pool = curve.pool();
        // lpSeedBps == 0: only floor-rounding dust of the platform/dev split lands in lpSeed.
        assertLt(lpF * 1e9, rF, "lpSeed dust only");
        uint256 closeNum = vq + rF;
        uint256 closeDen = P.VIRTUAL_TOKEN_RESERVE - P.CURVE_SUPPLY;
        assertGe(pool.reserveQuote() * closeDen, closeNum * pool.reserveToken(), "pool >= close");
        uint256 ratio = Math.mulDiv(pool.reserveQuote() * 1e18, closeDen, closeNum * pool.reserveToken());
        assertLt(ratio - 1e18, 1e9, "C8 rel error < 1e-9");
        emit log_named_uint("C8 lpSeed=0 rel error (1e18)", ratio - 1e18);
    }

    // ---------------------------------------------------------------------
    // C9 transfer lock
    // ---------------------------------------------------------------------

    function test_C9_TransferLockUntilGraduation() public {
        uint256 b = _sellOutBudget(curve) / 10;
        _fund(alice, b);
        vm.prank(alice);
        curve.buy(b, 0);

        uint256 until = token.transferLockUntil();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MembershipToken.TransferLocked.selector, until));
        token.transfer(bob, 1);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PoolFactory.NotTokenOffering.selector, stranger, address(curve)));
        poolFactory.createPool(token, quote, stranger, feeRouter, IFeeRouter.UtilityTier.L0, mapaeFactory, 30, 0);

        uint256 closing = _sellOutBudget(curve);
        _fund(bob, closing);
        vm.prank(bob);
        curve.buy(closing, 0);
        assertTrue(curve.graduated());

        vm.prank(alice);
        assertTrue(token.transfer(stranger, 1));
        assertEq(token.balanceOf(stranger), 1);
    }

    // ---------------------------------------------------------------------
    // C10 after graduation
    // ---------------------------------------------------------------------

    function test_C10_AfterGraduation() public {
        _graduateWithHistory();
        _fund(alice, 1e18);
        vm.startPrank(alice);
        vm.expectRevert(CurveSale.AlreadyGraduated.selector);
        curve.buy(1e18, 0);
        vm.expectRevert(CurveSale.AlreadyGraduated.selector);
        curve.sell(1, 0);
        vm.stopPrank();

        uint256 devAcc = curve.devAccrued();
        uint256 platAcc = curve.platformAccrued();
        assertGt(devAcc, 0);
        assertGt(platAcc, 0);
        uint256 devBal = quote.balanceOf(dev);
        vm.prank(dev);
        assertEq(curve.claimDevFees(), devAcc);
        assertEq(quote.balanceOf(dev) - devBal, devAcc);
        vm.prank(stranger);
        assertEq(curve.sweepPlatformFees(), platAcc);
        assertEq(quote.balanceOf(treasury), platAcc);
        assertEq(quote.balanceOf(address(curve)), 0);

        MapaePool pool = curve.pool();
        assertEq(pool.totalFeeBps(), 100);
        uint256 amt = pool.reserveQuote() / 100;
        deal(address(quote), carol, amt);
        vm.startPrank(carol);
        quote.approve(address(pool), amt);
        uint256 got = pool.swapQuoteForToken(amt, 0, carol);
        assertGt(got, 0);
        token.approve(address(pool), got);
        assertGt(pool.swapTokenForQuote(got / 2, 0, carol), 0);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // C11 solvency
    // ---------------------------------------------------------------------

    function test_C11_EveryoneExitsInFull() public {
        uint256 b = _sellOutBudget(curve) / 5;
        address[3] memory w = [alice, bob, carol];
        for (uint256 i; i < 3; ++i) {
            _fund(w[i], b);
            vm.prank(w[i]);
            curve.buy(b, 0);
        }
        assertFalse(curve.graduated());
        uint256 accBefore;
        for (uint256 i; i < 3; ++i) {
            uint256 bal = token.balanceOf(w[i]);
            uint256 qBefore = quote.balanceOf(w[i]);
            accBefore = _accrued();
            vm.prank(w[i]);
            uint256 got = curve.sell(bal, 0);
            assertGt(got, 0);
            assertEq(quote.balanceOf(w[i]) - qBefore, got);
            assertGe(_accrued(), accBefore, "accrued fees untouched by payouts");
        }
        assertEq(curve.s(), 0);
        assertEq(curve.r(), 0);
        assertEq(quote.balanceOf(address(curve)), _accrued());
        assertGt(_accrued(), 0);
    }

    // ---------------------------------------------------------------------
    // C12 slippage
    // ---------------------------------------------------------------------

    function test_C12_Slippage() public {
        uint256 b = _sellOutBudget(curve) / 10;
        _fund(alice, b);
        CurveSale.BuyQuote memory q = curve.quoteBuy(b);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.InsufficientOutput.selector, q.tokensOut, q.tokensOut + 1));
        curve.buy(b, q.tokensOut + 1);
        vm.prank(alice);
        curve.buy(b, q.tokensOut);

        uint256 sellAmt = token.balanceOf(alice) / 2;
        CurveSale.SellQuote memory sq = curve.quoteSell(sellAmt);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.InsufficientOutput.selector, sq.quoteOut, sq.quoteOut + 1));
        curve.sell(sellAmt, sq.quoteOut + 1);

        vm.prank(alice);
        vm.expectRevert(CurveSale.ZeroTokensOut.selector);
        curve.buy(0, 0);
        vm.prank(alice);
        vm.expectRevert(CurveSale.ZeroAmount.selector);
        curve.sell(0, 0);
    }

    // ---------------------------------------------------------------------
    // C13 permissions
    // ---------------------------------------------------------------------

    function test_C13_FeeWithdrawalPermissions() public {
        uint256 b = _sellOutBudget(curve) / 10;
        _fund(alice, b);
        vm.prank(alice);
        curve.buy(b, 0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotDev.selector, alice));
        curve.claimDevFees();

        uint256 plat = curve.platformAccrued();
        uint256 aliceBal = quote.balanceOf(alice);
        vm.prank(alice);
        curve.sweepPlatformFees();
        assertEq(quote.balanceOf(treasury), plat, "sweep goes to treasury");
        assertEq(quote.balanceOf(alice), aliceBal, "caller gets nothing");

        address newTreasury = makeAddr("newTreasury");
        feeRouter.setPlatformTreasury(newTreasury);
        _fund(bob, b);
        vm.prank(bob);
        curve.buy(b, 0);
        uint256 plat2 = curve.platformAccrued();
        curve.sweepPlatformFees();
        assertEq(quote.balanceOf(newTreasury), plat2, "follows FeeRouter treasury");
    }

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    function test_Construction() public {
        assertEq(token.totalSupply(), P.TOTAL_SUPPLY);
        assertEq(token.balanceOf(address(curve)), P.TOTAL_SUPPLY);
        assertEq(token.minter(), address(0), "mint authority burned");
        assertEq(token.offering(), address(curve));
        assertEq(curve.platformBps(), 50);
        assertEq(curve.devBps(), 35);
        assertEq(curve.lpSeedBps(), 15);
        assertEq(address(curve.settlementToken()), address(quote));
        assertEq(uint8(curve.phase()), uint8(IPrimaryMarket.Phase.Open));
        (uint256 n, uint256 d) = curve.spotPrice();
        assertEq(n, vq);
        assertEq(d, P.VIRTUAL_TOKEN_RESERVE);

        // fee snapshot: later FeeRouter changes do not affect an existing curve
        feeRouter.setCurveFees(IFeeRouter.CurveFees({platformBps: 60, devBps: 40, lpSeedBps: 0}));
        assertEq(curve.platformBps(), 50);

        vm.expectRevert(CurveSale.InvalidConfig.selector);
        new CurveSale(
            CurveSale.InitParams({
                quote: quote,
                dojang: IDojang(address(dojang)),
                dev: dev,
                feeRouter: feeRouter,
                poolFactory: poolFactory,
                mapaeFactory: mapaeFactory,
                tokenName: "X",
                tokenSymbol: "X",
                virtualQuote: 0,
                priorityWindow: PRIORITY_WINDOW
            })
        );
        vm.expectRevert(CurveSale.ZeroAddress.selector);
        new CurveSale(
            CurveSale.InitParams({
                quote: quote,
                dojang: IDojang(address(0)),
                dev: dev,
                feeRouter: feeRouter,
                poolFactory: poolFactory,
                mapaeFactory: mapaeFactory,
                tokenName: "X",
                tokenSymbol: "X",
                virtualQuote: vq,
                priorityWindow: PRIORITY_WINDOW
            })
        );
    }
}

contract CurveSaleKrws18Test is CurveSaleTestBase {
    function _deployQuote() internal override returns (IERC20, uint256) {
        MockKRW k = new MockKRW();
        return (IERC20(address(k)), P.krwsVirtualQuote(k.decimals()));
    }
}

contract CurveSaleQuote6Test is CurveSaleTestBase {
    function _deployQuote() internal override returns (IERC20, uint256) {
        TestQuote q6 = new TestQuote("KRW6", 6);
        return (IERC20(address(q6)), P.krwsVirtualQuote(6));
    }
}

contract CurveSaleWethTest is CurveSaleTestBase {
    function _deployQuote() internal override returns (IERC20, uint256) {
        TestQuote w = new TestQuote("WETH", 18);
        return (IERC20(address(w)), P.VIRTUAL_QUOTE_RESERVE_WETH);
    }
}
