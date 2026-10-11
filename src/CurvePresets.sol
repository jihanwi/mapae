// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title CurvePresets
/// @notice v3 L0 bonding-curve platform presets (v6.1 §12 / C0). PM-fixed values —
///         Devs cannot change any of them. Contracts consume these directly; the
///         only per-deployment knobs are the graduation N (testnet / mainnet) and
///         the refund-floor deadline (testnet may shorten it via deploy arg).
library CurvePresets {
    // ---------------------------------------------------------------------
    // Curve geometry (token units, 18 decimals — MembershipToken is fixed 18)
    // ---------------------------------------------------------------------

    /// @notice Total supply minted at creation.
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000e18;

    /// @notice Tokens sold along the curve.
    uint256 internal constant CURVE_SUPPLY = 800_000_000e18;

    /// @notice Tokens seeded into the AMM pool at graduation.
    uint256 internal constant DEX_SUPPLY = 200_000_000e18;

    /// @notice Virtual token reserve of the constant-product curve.
    uint256 internal constant VIRTUAL_TOKEN_RESERVE = 1_073_000_000e18;

    // ---------------------------------------------------------------------
    // Virtual quote reserves (per quote asset; factory maps quote → preset)
    // ---------------------------------------------------------------------

    /// @notice KRWs virtual quote reserve (KRWs / MockKRW, 18 decimals).
    uint256 internal constant VIRTUAL_QUOTE_RESERVE_KRWS = 2_000_000e18;

    /// @notice WETH virtual quote reserve (18 decimals). ETH input is wrapped.
    uint256 internal constant VIRTUAL_QUOTE_RESERVE_WETH = 0.6e18;

    // ---------------------------------------------------------------------
    // Graduation N (Dev-excluded verified buyers) — factory constructor arg
    // ---------------------------------------------------------------------

    uint32 internal constant GRADUATION_N_TESTNET = 10;
    uint32 internal constant GRADUATION_N_MAINNET = 30;

    // ---------------------------------------------------------------------
    // Per-wallet cumulative buy cap (bps of TOTAL_SUPPLY) by curve progress
    // ---------------------------------------------------------------------

    /// @notice Progress thresholds (bps of CURVE_SUPPLY sold).
    uint16 internal constant CAP_PROGRESS_MID_BPS = 2500;
    uint16 internal constant CAP_PROGRESS_LATE_BPS = 7500;

    /// @notice Cap while progress < 25%.
    uint16 internal constant CAP_EARLY_BPS = 100;
    /// @notice Cap while 25% ≤ progress < 75%.
    uint16 internal constant CAP_MID_BPS = 200;
    /// @notice Cap while progress ≥ 75%.
    uint16 internal constant CAP_LATE_BPS = 300;

    // ---------------------------------------------------------------------
    // Fees (bps of trade size; curve and AMM both total 1.00%)
    // ---------------------------------------------------------------------

    uint16 internal constant CURVE_FEE_PLATFORM_BPS = 50;
    uint16 internal constant CURVE_FEE_DEV_BPS = 35;
    uint16 internal constant CURVE_FEE_LP_SEED_BPS = 15;

    uint16 internal constant SWAP_FEE_PLATFORM_BPS = 40;
    uint16 internal constant SWAP_FEE_DEV_BPS = 30;
    uint16 internal constant SWAP_FEE_LP_BPS = 30;

    // ---------------------------------------------------------------------
    // Refund floor
    // ---------------------------------------------------------------------

    /// @notice Share of each buy's net quote held in escrow when the floor is on.
    uint16 internal constant REFUND_FLOOR_BPS = 5000;

    /// @notice Graduation deadline for refund-floor curves (mainnet value).
    uint256 internal constant REFUND_DEADLINE = 72 hours;

    // ---------------------------------------------------------------------
    // Buyback
    // ---------------------------------------------------------------------

    /// @notice Share of the platform fee take routed to BuybackVault.
    uint16 internal constant BUYBACK_BPS = 5000;

    uint16 internal constant BPS = 10_000;
}
