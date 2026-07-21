// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IRedeemManager
/// @notice Redeemables are creator-defined perks purchased by burning membership
///         tokens. The burn amount per redeemable is fixed in token units,
///         independent of market price (KRW-fixed pricing happens off-chain).
interface IRedeemManager {
    /// @notice Emitted when a creator registers a new redeemable.
    /// @param id Creator-chosen redeemable identifier.
    /// @param creator The creator registering the redeemable.
    /// @param burnAmount Membership tokens burned per redemption.
    /// @param maxClaims Maximum number of redemptions; 0 means unlimited.
    /// @param deadline Unix time after which redemption closes; 0 means no deadline.
    event RedeemableCreated(
        uint256 indexed id, address indexed creator, uint256 burnAmount, uint256 maxClaims, uint256 deadline
    );

    /// @notice Emitted when a holder redeems.
    /// @param id The redeemable identifier.
    /// @param redeemer The wallet whose tokens were burned.
    /// @param burnAmount Membership tokens burned.
    event Redeemed(uint256 indexed id, address indexed redeemer, uint256 burnAmount);

    /// @notice Register a redeemable. Creator only.
    function createRedeemable(uint256 id, uint256 burnAmount, uint256 maxClaims, uint256 deadline) external;

    /// @notice Burn the redeemable's burnAmount from the caller and record the claim.
    function redeem(uint256 id) external;
}
