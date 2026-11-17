// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ISettlerRegistry
/// @notice Decision 62 (v3.4-L1): where an offering asks, at settle time, who besides its owner may
///         settle it. The MapaeFactory implements it, so changing the settler there applies to every
///         offering it already opened.
interface ISettlerRegistry {
    /// @notice The settle-only address; address(0) means none (only the owner settles).
    function settler() external view returns (address);
}
