// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
import {VestingWalletCliff} from "@openzeppelin/contracts/finance/VestingWalletCliff.sol";

/// @title ProceedsLock
/// @notice Time lock on the issuer's share of an L1/L2 raise (decision 56), built like
///         MapaeVesting on OZ's audited VestingWalletCliff: linear release after a cliff,
///         beneficiary = the issuer, start = the offering deadline, duration and cliff fixed at
///         offering creation (within the factory's immutable ProceedsBand).
///
///         No one else can move the funds: there is no revoke path, no admin and no upgrade
///         path. `release(token)` is permissionless but always pays the beneficiary (OZ
///         VestingWallet pays `owner()`), and the beneficiary is fixed for life:
///         transferOwnership / renounceOwnership revert, so neither the issuer nor anyone else
///         can redirect or strand the locked proceeds. Native ETH is refused (the proceeds are the
///         offering's payment token).
contract ProceedsLock is VestingWalletCliff {
    error BeneficiaryFixed();
    error NoNativeCurrency();

    constructor(address beneficiary, uint64 startTimestamp, uint64 durationSeconds, uint64 cliffSeconds)
        VestingWallet(beneficiary, startTimestamp, durationSeconds)
        VestingWalletCliff(cliffSeconds)
    {}

    /// @dev Proceeds are an ERC-20; refusing ETH keeps everything on the token path.
    receive() external payable override {
        revert NoNativeCurrency();
    }

    /// @notice The beneficiary cannot be changed by anyone.
    function transferOwnership(address) public pure override {
        revert BeneficiaryFixed();
    }

    /// @notice Renouncing would strand the locked proceeds; disabled.
    function renounceOwnership() public pure override {
        revert BeneficiaryFixed();
    }
}
