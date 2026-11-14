// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IFeeRouter
/// @notice Read-side surface of the FeeRouter: the utility-tier enum, the
///         per-tier fee schedule, and the platform treasury. Consumers
///         (Offering, MapaePool, RedeemManager) depend only on this interface
///         so they never pull in the owner/band-validation machinery.
///
///         Sponsorship deliberately does NOT import this interface — its burn
///         path routes through MapaePool.swapForBurn (0% fee), so "sponsorship
///         fee = 0%" is proven by the absence of any FeeRouter call path.
interface IFeeRouter {
    /// @notice Utility grade of a token/offering. L0 is the lightweight tier
    ///         (fast, self-serve, no merch/sponsorship/buyback); L1/L2 are the
    ///         curated premium tiers.
    enum UtilityTier {
        L0,
        L1,
        L2
    }

    /// @notice Per-tier fee schedule, all in basis points.
    /// @dev swapPlatformBps/swapRoyaltyBps/swapBurnBps/swapLpBps are the four
    ///      shares of the swap fee (their sum is the total swap fee). merchFeeBps
    ///      is the platform cut on RedeemManager paid drops. offeringFeeBps is
    ///      the platform cut on primary-offering proceeds (snapshotted at
    ///      offering creation — never applied retroactively).
    struct TierFees {
        uint16 offeringFeeBps;
        uint16 swapPlatformBps;
        uint16 swapRoyaltyBps;
        uint16 swapBurnBps;
        uint16 swapLpBps;
        uint16 merchFeeBps;
    }

    /// @notice The current fee schedule for `tier`.
    function getFees(UtilityTier tier) external view returns (TierFees memory);

    /// @notice v3 bonding-curve trade fee split (bps of trade size), consumed by CurveSale.
    ///         platform → treasury, dev → issuer royalty, lpSeed → accrued in the curve and
    ///         added to the pool at graduation.
    struct CurveFees {
        uint16 platformBps;
        uint16 devBps;
        uint16 lpSeedBps;
    }

    /// @notice Current curve fee split.
    function getCurveFees() external view returns (CurveFees memory);

    /// @notice Destination for all platform-side fee flows.
    function platformTreasury() external view returns (address);
}
