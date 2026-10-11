// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
import {VestingWalletCliff} from "@openzeppelin/contracts/finance/VestingWalletCliff.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";

/// @title MapaeVesting
/// @notice Creator allocation vesting (D10): linear + cliff on OZ's audited
///         VestingWalletCliff. Beneficiary = creator (the wallet owner),
///         irrevocable by construction — there is no revoke path and the
///         contract is non-upgradeable (불변식 6: nothing moves before the
///         cliff, releases never exceed the linear schedule).
///
///         Bands are tier-dependent (Step 8): L1/L2 duration 12–48mo, cliff
///         ≥3mo (현행); L0 duration 3–6mo, cliff 0 allowed (fast tier).
/// @dev The factory deploys one per offering with start = offering deadline
///      (≈ settlement time, known at creation). release(token) is pull-style.
contract MapaeVesting is VestingWalletCliff {
    error InvalidVestingConfig();

    /// @notice Premium (L1/L2) duration band: 12–48 months (기본 36mo).
    uint64 public constant MIN_VESTING_DURATION = 360 days;
    uint64 public constant MAX_VESTING_DURATION = 1440 days;
    /// @notice Premium minimum cliff: 3 months (기본 6mo).
    uint64 public constant MIN_CLIFF = 90 days;

    /// @notice L0 duration band: 3–6 months; cliff 0 allowed.
    uint64 public constant MIN_VESTING_DURATION_L0 = 90 days;
    uint64 public constant MAX_VESTING_DURATION_L0 = 180 days;

    constructor(
        address beneficiary,
        uint64 startTimestamp,
        uint64 durationSeconds,
        uint64 cliffSeconds,
        IFeeRouter.UtilityTier tier
    ) VestingWallet(beneficiary, startTimestamp, durationSeconds) VestingWalletCliff(cliffSeconds) {
        if (cliffSeconds > durationSeconds) revert InvalidVestingConfig();
        if (tier == IFeeRouter.UtilityTier.L0) {
            if (durationSeconds < MIN_VESTING_DURATION_L0 || durationSeconds > MAX_VESTING_DURATION_L0) {
                revert InvalidVestingConfig();
            }
            // cliff 0 allowed for L0 — no lower bound.
        } else {
            if (
                durationSeconds < MIN_VESTING_DURATION || durationSeconds > MAX_VESTING_DURATION
                    || cliffSeconds < MIN_CLIFF
            ) revert InvalidVestingConfig();
        }
    }
}
