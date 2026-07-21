// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title IMembershipToken
/// @notice Fixed-supply, transferable creator membership ERC-20.
///         Supply is minted exactly once when the offering settles, after which
///         mint authority is permanently burned. Only burning can change supply.
interface IMembershipToken is IERC20, IERC20Metadata {
    /// @notice Destroys `amount` tokens from the caller.
    function burn(uint256 amount) external;

    /// @notice Destroys `amount` tokens from `account`, deducting from the caller's allowance.
    function burnFrom(address account, uint256 amount) external;

    /// @notice Optional per-wallet holding cap (e.g. 3% of total supply).
    /// @return cap Maximum balance a single wallet may hold; 0 means no cap.
    function holdingCap() external view returns (uint256 cap);

    /// @notice Optional post-listing transfer lock.
    /// @return timestamp Unix time until which transfers are locked; 0 means no lock.
    function transferLockUntil() external view returns (uint256 timestamp);
}
