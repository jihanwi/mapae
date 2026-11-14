// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title CurveMath
/// @notice Pure virtual-reserve constant-product bonding curve math for the L0 CurveSale rail.
///
///         Model: (Vq + r) * (Vt - s) >= Vq * Vt = k
///           Vq = virtual quote reserve, Vt = virtual token reserve,
///           r  = real accumulated quote reserve, s = cumulative tokens sold,
///           S  = tokens available on the curve (sale supply), S < Vt.
///
///         Rounding rules (always curve-favorable, OZ Math.mulDiv with Rounding.Ceil):
///           A. Buy: tokensOut = (Vt - s) - ceil(k / (Vq + r + quoteIn))  (rounded down), and
///              quoteUsed = ceil(k / (Vt - s - tokensOut)) - (Vq + r), the ceil cost of exactly
///              tokensOut, also outside the supply cap. quoteUsed <= quoteIn; the dust is refunded.
///           B. Dust guard: a buy whose cost rounds to 0 returns (0, 0), unless it takes the whole
///              remainder S - s. That remainder can only be free when costToSellOut() == 0 (it is
///              worth < 1 quote unit), and handing it out is what makes sell-out (graduation)
///              reachable. A zero-quote buy therefore yields tokens only in that case.
///           Sell: quoteOut = (Vq + r) - ceil(k / (Vt - s + tokenIn))  (rounded down).
///
///         State invariant (I8): starting from (r, s) = (0, 0) and applying only results of this
///         library, Vq + r == ceil(k / (Vt - s)) holds after every trade. Hence the curve is path
///         independent, carries no rounding slack, k never drops below Vq * Vt (I1), and selling
///         all s tokens returns exactly r (solvency, I5).
///
///         Caller obligations (CurveSale):
///           - treat a buy with tokensOut == 0 as a revert (never take quote for nothing);
///           - collect only quoteUsed, or refund quoteIn - quoteUsed to the buyer in the same tx;
///           - persist r += quoteUsed, s += tokensOut (buy) / r -= quoteOut, s -= tokenIn (sell)
///             exactly as returned, and pass the stored (r, s) back unmodified (no donations in r).
///
///         No storage, no fees, no token transfers. Amounts are raw units of whatever ERC-20s the
///         caller uses; decimals are applied by the caller (see CurvePresets).
library CurveMath {
    using Math for uint256;

    /// @notice Curve shape. All values are raw units (quote units for vQuote, token units otherwise).
    struct Params {
        uint256 vQuote; // Vq
        uint256 vToken; // Vt
        uint256 saleSupply; // S
    }

    error InvalidParams();
    error SoldExceedsSupply(uint256 sold, uint256 saleSupply);
    error SellExceedsSold(uint256 tokenIn, uint256 sold);

    /// @notice Reverts unless 0 < Vq, 0 < S < Vt.
    function validate(Params memory p) internal pure {
        if (p.vQuote == 0 || p.saleSupply == 0 || p.saleSupply >= p.vToken) revert InvalidParams();
    }

    /// @notice Buy with an exact quote budget.
    /// @param p Curve params.
    /// @param r Real quote reserve held by the curve.
    /// @param s Tokens sold so far (must be <= S).
    /// @param quoteIn Quote budget offered by the buyer.
    /// @return tokensOut Tokens the buyer receives (rounded down, capped at S - s).
    /// @return quoteUsed Ceil cost of exactly tokensOut (<= quoteIn). When capped by the remaining
    ///         supply this is the cost of the remainder. The caller refunds quoteIn - quoteUsed.
    /// @dev r must be a reserve produced by this library starting from (r, s) = (0, 0); the library
    ///      then maintains Vq + r == ceil(k / (Vt - s)).
    function buyExactQuoteIn(Params memory p, uint256 r, uint256 s, uint256 quoteIn)
        internal
        pure
        returns (uint256 tokensOut, uint256 quoteUsed)
    {
        validate(p);
        if (s > p.saleSupply) revert SoldExceedsSupply(s, p.saleSupply);
        if (s == p.saleSupply) return (0, 0);

        uint256 x = p.vQuote + r;
        uint256 y = p.vToken - s;

        // y' = ceil(k / (x + quoteIn)); tokensOut = y - y'  (floor of the exact amount)
        uint256 yNew = p.vQuote.mulDiv(p.vToken, x + quoteIn, Math.Rounding.Ceil);
        // x * y >= k implies yNew <= y; guarded anyway so a malformed (r, s) cannot underflow.
        tokensOut = y > yNew ? y - yNew : 0;

        uint256 remaining = p.saleSupply - s;
        // ">=": a buy that takes exactly the remainder is the closing buy (dust-guard exemption).
        bool closes = tokensOut >= remaining;
        if (closes) {
            tokensOut = remaining;
            yNew = p.vToken - p.saleSupply;
        }

        // quoteUsed = ceil cost of exactly tokensOut: x_end = ceil(k / y'), quoteUsed = x_end - x.
        // Charging the exact ceil cost (instead of keeping quoteIn) keeps the reserve canonical,
        // Vq + r == ceil(k / (Vt - s)), so the curve is path independent and holds no rounding slack
        // that a later trader could extract. x_end <= x + quoteIn because k / y' <= x + quoteIn.
        uint256 xEnd = p.vQuote.mulDiv(p.vToken, yNew, Math.Rounding.Ceil);
        quoteUsed = xEnd > x ? xEnd - x : 0;

        // Dust guard: tokens whose value rounds to zero quote are not handed out for free, except to
        // close the sale (the whole remainder is worth < 1 quote unit), so graduation is reachable.
        if (quoteUsed == 0 && !closes) return (0, 0);
    }

    /// @notice Sell an exact token amount back to the curve.
    /// @return quoteOut Quote paid to the seller (rounded down). Never exceeds r.
    function sellExactTokenIn(Params memory p, uint256 r, uint256 s, uint256 tokenIn)
        internal
        pure
        returns (uint256 quoteOut)
    {
        validate(p);
        if (s > p.saleSupply) revert SoldExceedsSupply(s, p.saleSupply);
        if (tokenIn > s) revert SellExceedsSold(tokenIn, s);
        if (tokenIn == 0) return 0;

        uint256 x = p.vQuote + r;
        // x' = ceil(k / (y + tokenIn)); quoteOut = x - x'  (floor of the exact amount)
        uint256 xNew = p.vQuote.mulDiv(p.vToken, p.vToken - s + tokenIn, Math.Rounding.Ceil);
        quoteOut = x > xNew ? x - xNew : 0;
    }

    /// @notice Quote needed to buy every remaining token (ceil). Zero once sold out.
    function costToSellOut(Params memory p, uint256 r, uint256 s) internal pure returns (uint256) {
        validate(p);
        if (s > p.saleSupply) revert SoldExceedsSupply(s, p.saleSupply);
        if (s == p.saleSupply) return 0;
        uint256 x = p.vQuote + r;
        uint256 xEnd = p.vQuote.mulDiv(p.vToken, p.vToken - p.saleSupply, Math.Rounding.Ceil);
        return xEnd > x ? xEnd - x : 0;
    }

    /// @notice Spot price as a ratio (numerator, denominator) = (Vq + r) / (Vt - s), in raw units of
    ///         quote per raw unit of token. Returned unreduced so callers choose their own rounding.
    function spotPrice(Params memory p, uint256 r, uint256 s) internal pure returns (uint256 num, uint256 den) {
        validate(p);
        if (s > p.saleSupply) revert SoldExceedsSupply(s, p.saleSupply);
        return (p.vQuote + r, p.vToken - s);
    }
}
