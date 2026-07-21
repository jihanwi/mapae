// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IDojang
/// @notice Minimal view into the Dojang attestation service (GIWA's Verified
///         Address = Upbit KYC proof). The real integration lands in M3 as an
///         EAS adapter; until then MockDojang implements this interface.
/// @dev Callers MUST treat this as fail-closed: any failure to obtain a
///      positive result means the account is NOT verified.
interface IDojang {
    /// @notice Returns true if `account` holds a valid Verified Address attestation.
    function isVerified(address account) external view returns (bool);
}
