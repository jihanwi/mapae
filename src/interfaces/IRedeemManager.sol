// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IRedeemManager
/// @notice Redeemables are creator-defined perks purchased by burning membership
///         tokens. The burn amount per redeemable is fixed in token units,
///         independent of market price (KRW-fixed pricing happens off-chain).
/// @dev A wallet may redeem the same redeemable multiple times by design;
///      maxClaims bounds the total count, not per-wallet usage.
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

    /// @notice Only the creator can manage redeemables.
    error NotCreator(address account);
    /// @notice A redeemable with this id already exists.
    error RedeemableExists(uint256 id);
    /// @notice No redeemable with this id.
    error UnknownRedeemable(uint256 id);
    /// @notice The redeemable's deadline has passed.
    error RedeemClosed(uint256 id, uint256 deadline);
    /// @notice The redeemable's claim budget is exhausted.
    error MaxClaimsReached(uint256 id, uint256 maxClaims);
    /// @notice burnAmount must be non-zero.
    error ZeroBurnAmount();

    /// @notice Register a redeemable. Creator only.
    function createRedeemable(uint256 id, uint256 burnAmount, uint256 maxClaims, uint256 deadline) external;

    /// @notice Burn the redeemable's burnAmount from the caller (requires prior
    ///         allowance) and record the claim.
    function redeem(uint256 id) external;

    /// @notice Same as redeem(), but sets the allowance in the same transaction
    ///         via EIP-2612 permit (one-tap redeem even during transfer lock).
    function redeemWithPermit(uint256 id, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s) external;

    /// @notice Redeemable metadata + running claim count.
    function redeemables(uint256 id)
        external
        view
        returns (uint256 burnAmount, uint256 maxClaims, uint256 deadline, uint256 claimCount, bool exists);
}
