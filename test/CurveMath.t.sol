// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CurveMath} from "../src/lib/CurveMath.sol";

/// @dev External wrapper so library reverts can be asserted with vm.expectRevert.
contract CurveMathHarness {
    function buy(CurveMath.Params memory p, uint256 r, uint256 s, uint256 q) external pure returns (uint256, uint256) {
        return CurveMath.buyExactQuoteIn(p, r, s, q);
    }

    function sell(CurveMath.Params memory p, uint256 r, uint256 s, uint256 t) external pure returns (uint256) {
        return CurveMath.sellExactTokenIn(p, r, s, t);
    }

    function cost(CurveMath.Params memory p, uint256 r, uint256 s) external pure returns (uint256) {
        return CurveMath.costToSellOut(p, r, s);
    }
}

/// @notice Fuzz invariants I1..I10 for CurveMath (MAPAE v3 / Phase 1 / T2).
///         I7 is covered by running every sequence invariant at quote decimals 6 and 18.
contract CurveMathTest is Test {
    uint256 internal constant TOKEN_UNIT = 1e18;
    uint256 internal constant OPS = 12;

    CurveMathHarness internal h;

    function setUp() public {
        h = new CurveMathHarness();
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /// @dev Random but realistic curve shape. Vq spans 1 .. 1e10 whole quote units, Vt spans
    ///      1e6 .. 1e10 whole tokens, S spans 10% .. 99% of Vt.
    function _params(uint256 seed, uint8 quoteDecimals) internal pure returns (CurveMath.Params memory p) {
        uint256 qUnit = 10 ** quoteDecimals;
        uint256 a = uint256(keccak256(abi.encode(seed, 1)));
        uint256 b = uint256(keccak256(abi.encode(seed, 2)));
        uint256 c = uint256(keccak256(abi.encode(seed, 3)));
        p.vQuote = qUnit + (a % (qUnit * 1e10));
        p.vToken = 1e6 * TOKEN_UNIT + (b % (1e10 * TOKEN_UNIT));
        p.saleSupply = p.vToken / 10 + (c % (p.vToken * 89 / 100));
    }

    function _kHolds(CurveMath.Params memory p, uint256 r, uint256 s) internal pure returns (bool) {
        // Bounds keep both products < 2^256 (X <= 100 * Vq <= ~1e30, Y <= ~1e28).
        return (p.vQuote + r) * (p.vToken - s) >= p.vQuote * p.vToken;
    }

    /// @dev Applies one op to (r, s). Even op => buy with a budget up to 1.2x cost-to-sell-out
    ///      (so the cap path is exercised); odd op => sell up to s.
    function _step(CurveMath.Params memory p, uint256 r, uint256 s, uint256 op)
        internal
        pure
        returns (uint256, uint256)
    {
        if (op % 2 == 0) {
            uint256 c = CurveMath.costToSellOut(p, r, s);
            uint256 q = bound(op >> 1, 1, c + c / 5 + 1);
            (uint256 out, uint256 used) = CurveMath.buyExactQuoteIn(p, r, s, q);
            assert(used <= q);
            // No free tokens except the sub-unit remainder that closes the sale.
            if (out > 0 && s + out < p.saleSupply) assert(used > 0);
            return (r + used, s + out);
        } else {
            uint256 t = s == 0 ? 0 : bound(op >> 1, 0, s);
            uint256 qo = CurveMath.sellExactTokenIn(p, r, s, t);
            assert(qo <= r);
            return (r - qo, s - t);
        }
    }

    function _run(CurveMath.Params memory p, uint256[OPS] memory ops) internal pure returns (uint256 r, uint256 s) {
        for (uint256 i; i < OPS; ++i) {
            (r, s) = _step(p, r, s, ops[i]);
        }
    }

    // ---------------------------------------------------------------------
    // Invariant bodies
    // ---------------------------------------------------------------------

    function _i1(uint256 seed, uint8 dec, uint256[OPS] memory ops) internal pure {
        CurveMath.Params memory p = _params(seed, dec);
        uint256 r;
        uint256 s;
        for (uint256 i; i < OPS; ++i) {
            (r, s) = _step(p, r, s, ops[i]);
            assertTrue(_kHolds(p, r, s), "I1: k decreased");
            // Canonical reserve: no rounding slack accumulates (path independence).
            assertEq(
                p.vQuote + r, Math.mulDiv(p.vQuote, p.vToken, p.vToken - s, Math.Rounding.Ceil), "I1: reserve slack"
            );
        }
    }

    function _i2(uint256 seed, uint8 dec, uint256[OPS] memory ops, uint256 x) internal pure {
        CurveMath.Params memory p = _params(seed, dec);
        (uint256 r, uint256 s) = _run(p, ops);
        x = bound(x, 1, CurveMath.costToSellOut(p, r, s) * 2 + 1);
        (uint256 out, uint256 used) = CurveMath.buyExactQuoteIn(p, r, s, x);
        uint256 back = CurveMath.sellExactTokenIn(p, r + used, s + out, out);
        assertLe(back, used, "I2: round trip profit vs used");
        assertLe(back, x, "I2: round trip profit vs x");
    }

    function _i3(uint256 seed, uint8 dec, uint256[OPS] memory ops, uint256 x) internal pure {
        CurveMath.Params memory p = _params(seed, dec);
        (uint256 r, uint256 s) = _run(p, ops);
        assertLe(s, p.saleSupply, "I3: s > S");
        if (s == p.saleSupply) return;
        uint256 c = CurveMath.costToSellOut(p, r, s);
        // Overshoot: strictly more than the sell-out cost.
        x = bound(x, c + 1, c * 3 + 1e30);
        (uint256 out, uint256 used) = CurveMath.buyExactQuoteIn(p, r, s, x);
        assertEq(out, p.saleSupply - s, "I3: must deliver exactly the remainder");
        assertEq(used, c, "I3: used must equal sell-out cost");
        assertLe(used, x, "I3: used > quoteIn");
        assertTrue(_kHolds(p, r + used, s + out), "I3: k after sell-out");
        assertEq(CurveMath.costToSellOut(p, r + used, s + out), 0);
    }

    function _i4(uint256 seed, uint8 dec, uint256[OPS] memory ops, uint256 a, uint256 b) internal pure {
        CurveMath.Params memory p = _params(seed, dec);
        (uint256 r, uint256 s) = _run(p, ops);
        uint256 c = CurveMath.costToSellOut(p, r, s);
        a = bound(a, 1, c + 1);
        b = bound(b, 1, c + 1);
        (uint256 one,) = CurveMath.buyExactQuoteIn(p, r, s, a + b);
        (uint256 o1, uint256 u1) = CurveMath.buyExactQuoteIn(p, r, s, a);
        (uint256 o2,) = CurveMath.buyExactQuoteIn(p, r + u1, s + o1, b);
        assertLe(o1 + o2, one, "I4: split buy got more tokens");
    }

    function _i5(uint256 seed, uint8 dec, uint256[OPS] memory ops) internal pure {
        CurveMath.Params memory p = _params(seed, dec);
        uint256 r;
        uint256 s;
        for (uint256 i; i < OPS; ++i) {
            (r, s) = _step(p, r, s, ops[i]);
            uint256 all = CurveMath.sellExactTokenIn(p, r, s, s);
            assertLe(all, r, "I5: insolvent");
            // Stronger: full exit returns exactly r (ceil(k / Vt) == Vq).
            assertEq(all, r, "I5: full exit != r");
        }
    }

    // ---------------------------------------------------------------------
    // I1..I5 at 6 and 18 quote decimals (I7)
    // ---------------------------------------------------------------------

    function testFuzz_I1_kNonDecreasing_dec6(uint256 seed, uint256[OPS] memory ops) public pure {
        _i1(seed, 6, ops);
    }

    function testFuzz_I1_kNonDecreasing_dec18(uint256 seed, uint256[OPS] memory ops) public pure {
        _i1(seed, 18, ops);
    }

    function testFuzz_I2_roundTripNoProfit_dec6(uint256 seed, uint256[OPS] memory ops, uint256 x) public pure {
        _i2(seed, 6, ops, x);
    }

    function testFuzz_I2_roundTripNoProfit_dec18(uint256 seed, uint256[OPS] memory ops, uint256 x) public pure {
        _i2(seed, 18, ops, x);
    }

    function testFuzz_I3_supplyCap_dec6(uint256 seed, uint256[OPS] memory ops, uint256 x) public pure {
        _i3(seed, 6, ops, x);
    }

    function testFuzz_I3_supplyCap_dec18(uint256 seed, uint256[OPS] memory ops, uint256 x) public pure {
        _i3(seed, 18, ops, x);
    }

    function testFuzz_I4_splitNoGain_dec6(uint256 seed, uint256[OPS] memory ops, uint256 a, uint256 b) public pure {
        _i4(seed, 6, ops, a, b);
    }

    function testFuzz_I4_splitNoGain_dec18(uint256 seed, uint256[OPS] memory ops, uint256 a, uint256 b) public pure {
        _i4(seed, 18, ops, a, b);
    }

    function testFuzz_I5_solvency_dec6(uint256 seed, uint256[OPS] memory ops) public pure {
        _i5(seed, 6, ops);
    }

    function testFuzz_I5_solvency_dec18(uint256 seed, uint256[OPS] memory ops) public pure {
        _i5(seed, 18, ops);
    }

    // ---------------------------------------------------------------------
    // I6 closed form
    // ---------------------------------------------------------------------

    function testFuzz_I6_closedForm(uint256 seed, bool hiDec) public pure {
        CurveMath.Params memory p = _params(seed, hiDec ? 18 : 6);
        uint256 expected = Math.mulDiv(p.vQuote, p.saleSupply, p.vToken - p.saleSupply, Math.Rounding.Ceil);
        assertEq(CurveMath.costToSellOut(p, 0, 0), expected, "I6");
        // Buying exactly that amount from genesis sells out the curve.
        (uint256 out, uint256 used) = CurveMath.buyExactQuoteIn(p, 0, 0, expected);
        assertEq(out, p.saleSupply);
        assertEq(used, expected);
    }

    /// @dev Reference vector from the T2 ticket: Vq 2,000,000 / Vt 1,073M / S 800M (6-dec quote)
    ///      -> sell-out cost 5,860,805.860806 (ticket rounds to 5,860,806).
    function test_I6_ticketReferenceVector() public pure {
        CurveMath.Params memory p = CurveMath.Params({
            vQuote: 2_000_000 * 1e6, vToken: 1_073_000_000 * TOKEN_UNIT, saleSupply: 800_000_000 * TOKEN_UNIT
        });
        uint256 c = CurveMath.costToSellOut(p, 0, 0);
        assertEq(c, 5_860_805_860_806);
        assertEq(Math.ceilDiv(c, 1e6), 5_860_806);
    }

    // ---------------------------------------------------------------------
    // I8 state invariant, I9 zero-quote buy, I10 free remainder bound
    // ---------------------------------------------------------------------

    function _canonicalR(CurveMath.Params memory p, uint256 s) internal pure returns (uint256) {
        return Math.mulDiv(p.vQuote, p.vToken, p.vToken - s, Math.Rounding.Ceil) - p.vQuote;
    }

    /// @dev Canonical state with s biased toward the tail (where sub-unit dust lives).
    function _state(CurveMath.Params memory p, uint256 sSeed) internal pure returns (uint256 r, uint256 s) {
        if (sSeed % 2 == 0) {
            s = p.saleSupply - bound(sSeed >> 1, 0, 1e18);
        } else {
            s = bound(sSeed >> 1, 0, p.saleSupply);
        }
        r = _canonicalR(p, s);
    }

    function _i8(uint256 seed, uint8 dec, uint256[OPS] memory ops) internal pure {
        CurveMath.Params memory p = _params(seed, dec);
        uint256 r;
        uint256 s;
        for (uint256 i; i < OPS; ++i) {
            (r, s) = _step(p, r, s, ops[i]);
            assertEq(p.vQuote + r, Math.mulDiv(p.vQuote, p.vToken, p.vToken - s, Math.Rounding.Ceil), "I8");
        }
    }

    function _i9(uint256 seed, uint8 dec, uint256 sSeed) internal pure {
        CurveMath.Params memory p = _params(seed, dec);
        (uint256 r, uint256 s) = _state(p, sSeed);
        (uint256 out, uint256 used) = CurveMath.buyExactQuoteIn(p, r, s, 0);
        assertEq(used, 0, "I9: zero buy spent quote");
        if (s < p.saleSupply && CurveMath.costToSellOut(p, r, s) == 0) {
            assertEq(out, p.saleSupply - s, "I9: free remainder not delivered");
        } else {
            assertEq(out, 0, "I9: zero buy got tokens");
        }
    }

    function _i10(uint256 seed, uint8 dec, uint256 sSeed, uint256 q) internal pure {
        CurveMath.Params memory p = _params(seed, dec);
        (uint256 r, uint256 s) = _state(p, sSeed);
        uint256 c = CurveMath.costToSellOut(p, r, s);
        q = bound(q, 0, c * 2 + 1e6);
        (uint256 out, uint256 used) = CurveMath.buyExactQuoteIn(p, r, s, q);
        if (out > 0 && used == 0) {
            assertEq(out, p.saleSupply - s, "I10: free tokens not the full remainder");
            assertEq(c, 0, "I10: free tokens while remainder has a cost");
        }
    }

    function testFuzz_I8_canonicalReserve_dec6(uint256 seed, uint256[OPS] memory ops) public pure {
        _i8(seed, 6, ops);
    }

    function testFuzz_I8_canonicalReserve_dec18(uint256 seed, uint256[OPS] memory ops) public pure {
        _i8(seed, 18, ops);
    }

    function testFuzz_I9_zeroQuoteBuy_dec6(uint256 seed, uint256 sSeed) public pure {
        _i9(seed, 6, sSeed);
    }

    function testFuzz_I9_zeroQuoteBuy_dec18(uint256 seed, uint256 sSeed) public pure {
        _i9(seed, 18, sSeed);
    }

    function testFuzz_I10_freeRemainderBound_dec6(uint256 seed, uint256 sSeed, uint256 q) public pure {
        _i10(seed, 6, sSeed, q);
    }

    function testFuzz_I10_freeRemainderBound_dec18(uint256 seed, uint256 sSeed, uint256 q) public pure {
        _i10(seed, 18, sSeed, q);
    }

    /// @dev Concrete free-tail case: 6-dec quote, 1 token-wei left is worth < 1 quote unit, so a
    ///      zero-quote buy closes the sale (I9 positive branch is actually reachable).
    function test_I9_freeTailClosesSale() public pure {
        CurveMath.Params memory p = CurveMath.Params({
            vQuote: 2_000_000 * 1e6, vToken: 1_066_666_666_666_666_666_666_666_667, saleSupply: 800_000_000e18
        });
        uint256 s = p.saleSupply - 1;
        uint256 r = _canonicalR(p, s);
        assertEq(CurveMath.costToSellOut(p, r, s), 0);
        (uint256 out, uint256 used) = CurveMath.buyExactQuoteIn(p, r, s, 0);
        assertEq(out, 1);
        assertEq(used, 0);
        // A non-closing dust buy right after genesis still gets nothing.
        (out, used) = CurveMath.buyExactQuoteIn(p, 0, 0, 0);
        assertEq(out, 0);
        assertEq(used, 0);
    }

    // ---------------------------------------------------------------------
    // Edge cases and reverts
    // ---------------------------------------------------------------------

    function test_zeroAmounts() public pure {
        CurveMath.Params memory p = _params(1, 6);
        (uint256 out, uint256 used) = CurveMath.buyExactQuoteIn(p, 0, 0, 0);
        assertEq(out, 0);
        assertEq(used, 0);
        assertEq(CurveMath.sellExactTokenIn(p, 0, 0, 0), 0);
    }

    function test_buyAfterSoldOutReturnsZero() public pure {
        CurveMath.Params memory p = _params(7, 18);
        uint256 c = CurveMath.costToSellOut(p, 0, 0);
        (uint256 out, uint256 used) = CurveMath.buyExactQuoteIn(p, 0, 0, c);
        (uint256 out2, uint256 used2) = CurveMath.buyExactQuoteIn(p, used, out, 1e18);
        assertEq(out2, 0);
        assertEq(used2, 0);
    }

    function test_revert_sellMoreThanSold() public {
        CurveMath.Params memory p = _params(3, 6);
        vm.expectRevert(abi.encodeWithSelector(CurveMath.SellExceedsSold.selector, 11, 10));
        h.sell(p, 1, 10, 11);
    }

    function test_revert_soldAboveSupply() public {
        CurveMath.Params memory p = _params(3, 6);
        vm.expectRevert(abi.encodeWithSelector(CurveMath.SoldExceedsSupply.selector, p.saleSupply + 1, p.saleSupply));
        h.buy(p, 0, p.saleSupply + 1, 1);
    }

    function test_revert_invalidParams() public {
        vm.expectRevert(CurveMath.InvalidParams.selector);
        h.cost(CurveMath.Params({vQuote: 0, vToken: 10, saleSupply: 5}), 0, 0);
        vm.expectRevert(CurveMath.InvalidParams.selector);
        h.cost(CurveMath.Params({vQuote: 1, vToken: 10, saleSupply: 10}), 0, 0);
        vm.expectRevert(CurveMath.InvalidParams.selector);
        h.cost(CurveMath.Params({vQuote: 1, vToken: 10, saleSupply: 0}), 0, 0);
    }
}
