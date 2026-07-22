// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
import {VestingWalletCliff} from "@openzeppelin/contracts/finance/VestingWalletCliff.sol";

/// @title MapaeVesting
/// @notice Creator allocation vesting (D10): linear + cliff on OZ's audited
///         VestingWalletCliff. Beneficiary = creator (the wallet owner),
///         irrevocable by construction — there is no revoke path and the
///         contract is non-upgradeable (불변식 6: nothing moves before the
///         cliff, releases never exceed the linear schedule).
/// @dev The factory deploys one per offering with start = offering deadline
///      (≈ settlement time, known at creation). release(token) is pull-style.
contract MapaeVesting is VestingWalletCliff {
    error InvalidVestingConfig();

    /// @notice Vesting duration band: 12–48 months (기본 36mo).
    uint64 public constant MIN_VESTING_DURATION = 360 days;
    uint64 public constant MAX_VESTING_DURATION = 1440 days;
    /// @notice Minimum cliff: 3 months (기본 6mo).
    uint64 public constant MIN_CLIFF = 90 days;

    constructor(address beneficiary, uint64 startTimestamp, uint64 durationSeconds, uint64 cliffSeconds)
        VestingWallet(beneficiary, startTimestamp, durationSeconds)
        VestingWalletCliff(cliffSeconds)
    {
        if (
            durationSeconds < MIN_VESTING_DURATION || durationSeconds > MAX_VESTING_DURATION || cliffSeconds < MIN_CLIFF
                || cliffSeconds > durationSeconds
        ) revert InvalidVestingConfig();
    }
}
