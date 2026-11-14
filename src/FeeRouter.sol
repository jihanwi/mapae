// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";

/// @title FeeRouter
/// @notice Single source of truth for MAPAE's tiered fee model. Every fee an
///         offering, pool or redeem-drop charges is read from here by tier.
///
///         On-chain bands (hard-coded constants below) bound what the owner can
///         ever set — setFees reverts outside the band, so even a compromised
///         owner cannot, e.g., push the L0 swap-platform floor below 40 bps or
///         mint a platform token cut where none is allowed. The bands ARE the
///         trust guarantee; the initial presets sit strictly inside them.
///
///         Non-upgradeable, no mint authority, no funds held — this contract
///         only stores numbers and the treasury address.
contract FeeRouter is Ownable, IFeeRouter {
    // ---------------------------------------------------------------------
    // Errors / events
    // ---------------------------------------------------------------------

    error ZeroAddress();
    /// @notice A proposed fee value (or their combination) fell outside the
    ///         tier's hard band. Fee schedules can never leave the band.
    error OutOfBand();

    event FeesUpdated(UtilityTier indexed tier, TierFees oldFees, TierFees newFees);
    event CurveFeesUpdated(CurveFees oldFees, CurveFees newFees);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    // ---------------------------------------------------------------------
    // Hard bands (owner cannot violate — the core trust invariant)
    // ---------------------------------------------------------------------

    // L0: lightweight tier. Absolute platform floor 40 (v3, was 60); swap split
    // total in [80,100]; offering fee in [0,500]; merch disabled (must be 0 — [Q1]).
    uint16 internal constant L0_SWAP_PLATFORM_MIN = 40;
    uint16 internal constant L0_SWAP_PLATFORM_MAX = 70;
    /// @dev Router share (platform + lp) caps (decision 28). Pools add their own royalty+burn
    ///      share (L0 ≤ 30, L1/L2 ≤ 90, enforced by MapaePool), so the pool total stays
    ///      ≤ 100 bps on L0 and ≤ 150 bps on L1/L2 whatever the owner sets within the bands.
    uint16 internal constant L0_ROUTER_SHARE_MAX = 70;
    uint16 internal constant PREMIUM_ROUTER_SHARE_MAX = 60;
    uint16 internal constant L0_SWAP_SUM_MIN = 80;
    uint16 internal constant L0_SWAP_SUM_MAX = 100;
    uint16 internal constant L0_OFFERING_MIN = 0;
    uint16 internal constant L0_OFFERING_MAX = 500;

    // L1/L2: premium tiers. Swap split total in [100,150]; platform in [20,60];
    // offering fee in [500,1000]; merch in [0,500].
    uint16 internal constant PREMIUM_SWAP_SUM_MIN = 100;
    uint16 internal constant PREMIUM_SWAP_SUM_MAX = 150;
    uint16 internal constant PREMIUM_SWAP_PLATFORM_MIN = 20;
    uint16 internal constant PREMIUM_SWAP_PLATFORM_MAX = 60;
    uint16 internal constant PREMIUM_OFFERING_MIN = 500;
    uint16 internal constant PREMIUM_OFFERING_MAX = 1000;
    uint16 internal constant PREMIUM_MERCH_MAX = 500;

    // v3 curve (CurveSale, L0 only): platform [40,60], dev [20,40], lpSeed [0,20],
    // total [80,100].
    uint16 internal constant CURVE_PLATFORM_MIN = 40;
    uint16 internal constant CURVE_PLATFORM_MAX = 60;
    uint16 internal constant CURVE_DEV_MIN = 20;
    uint16 internal constant CURVE_DEV_MAX = 40;
    uint16 internal constant CURVE_LP_SEED_MAX = 20;
    uint16 internal constant CURVE_SUM_MIN = 80;
    uint16 internal constant CURVE_SUM_MAX = 100;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    address public platformTreasury;
    mapping(UtilityTier => TierFees) internal _fees;
    CurveFees internal _curveFees;

    constructor(address owner_, address platformTreasury_) Ownable(owner_) {
        if (platformTreasury_ == address(0)) revert ZeroAddress();
        platformTreasury = platformTreasury_;

        // Initial presets (spec §Step 1). Each is validated against its band so
        // a mistyped preset cannot ship.
        // L0 (v3): AMM 1.00% = platform 0.40 / dev royalty 0.30 / LP 0.30 (= CurvePresets SWAP_FEE_*).
        _set(UtilityTier.L0, TierFees(500, 40, 30, 0, 30, 0));
        _set(UtilityTier.L1, TierFees(750, 40, 60, 30, 20, 400));
        _set(UtilityTier.L2, TierFees(750, 40, 60, 30, 20, 300));
        // Curve (v3): 1.00% = platform 0.50 / dev 0.35 / LP seed 0.15 (= CurvePresets CURVE_FEE_*).
        _setCurve(CurveFees(50, 35, 15));
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @inheritdoc IFeeRouter
    function getFees(UtilityTier tier) external view returns (TierFees memory) {
        return _fees[tier];
    }

    /// @inheritdoc IFeeRouter
    function getCurveFees() external view returns (CurveFees memory) {
        return _curveFees;
    }

    /// @notice Sum of the four swap-fee shares for `tier` (total swap fee, bps).
    function swapTotalBps(UtilityTier tier) external view returns (uint16) {
        TierFees memory f = _fees[tier];
        return f.swapPlatformBps + f.swapRoyaltyBps + f.swapBurnBps + f.swapLpBps;
    }

    // ---------------------------------------------------------------------
    // Owner
    // ---------------------------------------------------------------------

    /// @notice Replace a tier's fee schedule. Reverts (OutOfBand) if the new
    ///         values leave the tier's hard band — the owner cannot escape it.
    function setFees(UtilityTier tier, TierFees calldata newFees) external onlyOwner {
        _set(tier, newFees);
    }

    function _set(UtilityTier tier, TierFees memory f) internal {
        _validate(tier, f);
        TierFees memory old = _fees[tier];
        _fees[tier] = f;
        emit FeesUpdated(tier, old, f);
    }

    /// @dev The band check. Pure of storage so the constructor presets and
    ///      setFees share exactly one code path (invariant 6/7).
    function _validate(UtilityTier tier, TierFees memory f) internal pure {
        uint256 swapSum = uint256(f.swapPlatformBps) + f.swapRoyaltyBps + f.swapBurnBps + f.swapLpBps;
        if (tier == UtilityTier.L0) {
            if (f.swapPlatformBps < L0_SWAP_PLATFORM_MIN || f.swapPlatformBps > L0_SWAP_PLATFORM_MAX) {
                revert OutOfBand();
            }
            if (swapSum < L0_SWAP_SUM_MIN || swapSum > L0_SWAP_SUM_MAX) revert OutOfBand();
            if (uint256(f.swapPlatformBps) + f.swapLpBps > L0_ROUTER_SHARE_MAX) revert OutOfBand();
            if (f.offeringFeeBps < L0_OFFERING_MIN || f.offeringFeeBps > L0_OFFERING_MAX) revert OutOfBand();
            if (f.merchFeeBps != 0) revert OutOfBand(); // [Q1] L0 has no merch path
        } else {
            if (swapSum < PREMIUM_SWAP_SUM_MIN || swapSum > PREMIUM_SWAP_SUM_MAX) revert OutOfBand();
            if (uint256(f.swapPlatformBps) + f.swapLpBps > PREMIUM_ROUTER_SHARE_MAX) revert OutOfBand();
            if (f.swapPlatformBps < PREMIUM_SWAP_PLATFORM_MIN || f.swapPlatformBps > PREMIUM_SWAP_PLATFORM_MAX) {
                revert OutOfBand();
            }
            if (f.offeringFeeBps < PREMIUM_OFFERING_MIN || f.offeringFeeBps > PREMIUM_OFFERING_MAX) revert OutOfBand();
            if (f.merchFeeBps > PREMIUM_MERCH_MAX) revert OutOfBand();
        }
    }

    /// @notice Replace the curve fee split. Reverts (OutOfBand) outside the curve band.
    function setCurveFees(CurveFees calldata newFees) external onlyOwner {
        _setCurve(newFees);
    }

    function _setCurve(CurveFees memory f) internal {
        _validateCurve(f);
        CurveFees memory old = _curveFees;
        _curveFees = f;
        emit CurveFeesUpdated(old, f);
    }

    /// @dev Curve band check shared by the constructor preset and setCurveFees.
    function _validateCurve(CurveFees memory f) internal pure {
        uint256 sum = uint256(f.platformBps) + f.devBps + f.lpSeedBps;
        if (f.platformBps < CURVE_PLATFORM_MIN || f.platformBps > CURVE_PLATFORM_MAX) revert OutOfBand();
        if (f.devBps < CURVE_DEV_MIN || f.devBps > CURVE_DEV_MAX) revert OutOfBand();
        if (f.lpSeedBps > CURVE_LP_SEED_MAX) revert OutOfBand();
        if (sum < CURVE_SUM_MIN || sum > CURVE_SUM_MAX) revert OutOfBand();
    }

    /// @notice Point all platform fee flows at a new treasury.
    function setPlatformTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(platformTreasury, newTreasury);
        platformTreasury = newTreasury;
    }
}
