// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IBurnerRegistry
/// @notice Minimal registry surface the MapaePool consults to gate
///         swapForBurn(): only contracts the MapaeFactory has registered as
///         burners (Sponsorship instances + the BuybackVault) may drive the
///         0%-fee burn path. Everyone else reverts.
/// @dev A registered burner spending its own funds to buy-and-burn on ANY pool
///      only ever reduces that token's supply at its own cost — there is no
///      value-extraction path — so a global (not per-token) allow-list is safe.
interface IBurnerRegistry {
    function isBurner(address account) external view returns (bool);
}
