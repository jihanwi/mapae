// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title CurvePresets
/// @notice v3 L0 bonding-curve platform presets (v6.2 §12 / 지시서 v3.1 C0).
///         PM-fixed values — Devs cannot change any of them. L0 is a single
///         standard-curve format: no graduation headcount, no per-wallet cap,
///         no refund floor (STATUS 결정 18·19·20). Graduation = curve sold out.
library CurvePresets {
    // ---------------------------------------------------------------------
    // Curve geometry (token units, 18 decimals — MembershipToken is fixed 18)
    // ---------------------------------------------------------------------

    /// @notice Total supply minted at creation.
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000e18;

    /// @notice Tokens sold along the curve. Selling all of them is the only
    ///         graduation trigger.
    uint256 internal constant CURVE_SUPPLY = 800_000_000e18;

    /// @notice Tokens seeded into the AMM pool at graduation.
    uint256 internal constant DEX_SUPPLY = 200_000_000e18;

    /// @notice Virtual token reserve of the constant-product curve.
    /// @dev Chosen so the AMM seed price equals the curve closing price (PM 2026-11-14).
    ///      At sell-out the curve holds r = Vq·S/(Vt−S) and quotes (Vq + r)/(Vt − S) = Vq·Vt/(Vt−S)².
    ///      The pool is seeded with r against DEX_SUPPLY, i.e. price r/DEX = Vq·S/((Vt−S)·DEX).
    ///      Equal prices ⇔ DEX = S·(Vt−S)/Vt ⇔ Vt = S²/(S − DEX).
    ///      S = 800M, DEX = 200M ⇒ Vt = 3.2B/3 (rounded up to the next wei).
    ///      Consequences: threshold = 3·Vq, closing FDV = 15·Vq, closing/start price = (Vt/(Vt−S))² = 16.
    ///      Previous value 1,073M left the seed price 1.77% above the curve close.
    uint256 internal constant VIRTUAL_TOKEN_RESERVE = 1_066_666_666_666_666_666_666_666_667;

    // ---------------------------------------------------------------------
    // Virtual quote reserves (per quote asset; factory maps quote → preset)
    // ---------------------------------------------------------------------

    /// @notice KRWs virtual quote reserve (KRWs / MockKRW, 18 decimals).
    uint256 internal constant VIRTUAL_QUOTE_RESERVE_KRWS = 2_000_000e18;

    /// @notice WETH virtual quote reserve (18 decimals). ETH input is wrapped.
    uint256 internal constant VIRTUAL_QUOTE_RESERVE_WETH = 0.6e18;

    // ---------------------------------------------------------------------
    // Fees (bps of trade size; curve and AMM both total 1.00%)
    // ---------------------------------------------------------------------

    uint16 internal constant CURVE_FEE_PLATFORM_BPS = 50;
    /// @notice Dev royalty on curve trades.
    uint16 internal constant CURVE_FEE_DEV_BPS = 35;
    /// @notice Accrued in the curve, joins the pool at graduation (LP burned).
    uint16 internal constant CURVE_FEE_LP_SEED_BPS = 15;

    uint16 internal constant SWAP_FEE_PLATFORM_BPS = 40;
    /// @notice Dev royalty on AMM swaps.
    uint16 internal constant SWAP_FEE_DEV_BPS = 30;
    uint16 internal constant SWAP_FEE_LP_BPS = 30;

    // ---------------------------------------------------------------------
    // Buyback
    // ---------------------------------------------------------------------

    /// @notice Share of the platform fee take routed to BuybackVault.
    uint16 internal constant BUYBACK_BPS = 5000;

    uint16 internal constant BPS = 10_000;

    // ---------------------------------------------------------------------
    // Derived
    // ---------------------------------------------------------------------

    /// @notice Net quote (fees excluded) the curve must absorb to sell
    ///         CURVE_SUPPLY from `virtualQuote`: the graduation threshold.
    ///         Constant product: Δq = vq · curve / (vToken − curve).
    function graduationThreshold(uint256 virtualQuote) internal pure returns (uint256) {
        return virtualQuote * CURVE_SUPPLY / (VIRTUAL_TOKEN_RESERVE - CURVE_SUPPLY);
    }
}
