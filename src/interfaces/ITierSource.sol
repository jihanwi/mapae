// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IFeeRouter} from "./IFeeRouter.sol";

/// @title ITierSource
/// @notice Minimal surface for reading a sale's utility tier. An Offering
///         exposes `tier()` via its public immutable, so peripherals can gate
///         on tier by going token → offering → tier() without depending on the
///         MapaeFactory (avoids a construction-order cycle with the vault).
interface ITierSource {
    function tier() external view returns (IFeeRouter.UtilityTier);
}
