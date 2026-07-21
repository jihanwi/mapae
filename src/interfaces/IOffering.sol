// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IOffering
/// @notice Fixed-price single offering for a MembershipToken. No bonding curves,
///         no variable pricing. Allocation (equal share + weighted lottery) is
///         computed deterministically off-chain and committed on-chain as a
///         Merkle root; participants claim allocations/refunds pull-style.
interface IOffering {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice Behavior when the raise target R is not met.
    /// @dev AllOrNothing = mode A (full refund, no tokens issued),
    ///      Partial      = mode B (issue sold portion, burn unsold).
    enum RefundMode {
        AllOrNothing,
        Partial
    }

    /// @notice Offering lifecycle.
    /// @dev Open      — commits and cancels accepted (cancel only until freeze).
    ///      Frozen    — final 2h window before deadline; cancels rejected.
    ///      Settled   — allocation root committed; claims open.
    ///      Finalized — proceeds distributed, token transfers enabled.
    ///      Refunding — mode A target missed; deposits refundable.
    enum Phase {
        Open,
        Frozen,
        Settled,
        Finalized,
        Refunding
    }

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted when a participant deposits payment tokens.
    /// @param participant The committing wallet (Dojang-verified at commit time).
    /// @param amount Payment tokens deposited in this call.
    /// @param cumulative Participant's total committed after this call (<= L).
    event Committed(address indexed participant, uint256 amount, uint256 cumulative);

    /// @notice Emitted when a participant reduces their commitment (only until freeze).
    /// @param participant The cancelling wallet.
    /// @param amount Payment tokens returned in this call.
    /// @param cumulative Participant's total committed after this call.
    event Cancelled(address indexed participant, uint256 amount, uint256 cumulative);

    /// @notice Emitted when the allocation Merkle root is committed after the deadline.
    /// @param allocationRoot Merkle root of (participant, allocation, refundAmount) leaves.
    /// @param totalSold Token amount actually sold (== Q_sale unless mode B undersell).
    /// @param totalRaised Payment tokens corresponding to totalSold.
    event Settled(bytes32 indexed allocationRoot, uint256 totalSold, uint256 totalRaised);

    /// @notice Emitted when a participant claims their allocation (and any refund).
    /// @param participant The claiming wallet.
    /// @param allocation Membership tokens received.
    /// @param refundAmount Payment tokens refunded (excess over allocation).
    event Claimed(address indexed participant, uint256 allocation, uint256 refundAmount);

    /// @notice Emitted when a participant withdraws their full deposit in mode A failure.
    /// @param participant The refunded wallet.
    /// @param amount Payment tokens returned.
    event Refunded(address indexed participant, uint256 amount);

    /// @notice Emitted when unsold tokens are burned in mode B.
    /// @param amount Membership tokens burned.
    event UnsoldBurned(uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /// @notice Caller does not hold a valid Dojang Verified Address attestation.
    error NotVerified(address account);
    /// @notice Commit would push the wallet's cumulative deposit above the per-wallet limit L.
    error OverWalletLimit(address account, uint256 attempted, uint256 limit);
    /// @notice Action rejected inside the pre-deadline freeze window (or after close).
    error CommitFrozen();
    /// @notice The issuing creator's wallet cannot participate in its own offering.
    error IssuerCannotCommit();
    /// @notice Action requires the offering to be settled first.
    error NotSettled();
    /// @notice Action is not valid in the current phase.
    error InvalidPhase(Phase current);
    /// @notice Commit amount is below the platform minimum.
    error BelowMinCommit(uint256 amount, uint256 minimum);
    /// @notice Merkle proof does not match the committed allocation root.
    error InvalidProof();
    /// @notice Participant has already claimed or been refunded.
    error AlreadyClaimed(address account);
    /// @notice Refunds are only available in mode A after the target is missed.
    error RefundNotAvailable();

    // ---------------------------------------------------------------------
    // Functions
    // ---------------------------------------------------------------------

    /// @notice Deposit `amount` payment tokens toward the offering.
    /// @dev Requires Dojang verification (snapshot at commit time), enforces
    ///      cumulative <= L, and reverts for the issuer's own wallet.
    function commit(uint256 amount) external;

    /// @notice Withdraw `amount` of a prior commitment.
    /// @dev Only allowed until 2 hours before the deadline (anti last-minute
    ///      mass-cancel abuse); reverts with CommitFrozen afterwards.
    function cancel(uint256 amount) external;

    /// @notice Commit the off-chain computed allocation Merkle root.
    /// @param allocationRoot Merkle root of (participant, allocation, refundAmount) leaves.
    /// @param totalSold Token amount actually sold.
    function settle(bytes32 allocationRoot, uint256 totalSold) external;

    /// @notice Claim allocated tokens plus any refund, pull-style, with a Merkle proof.
    /// @param allocation Membership tokens allocated to the caller.
    /// @param refundAmount Payment tokens to refund to the caller.
    /// @param proof Merkle proof for the (caller, allocation, refundAmount) leaf.
    function claim(uint256 allocation, uint256 refundAmount, bytes32[] calldata proof) external;

    /// @notice Withdraw the full deposit after a mode A (all-or-nothing) failure.
    function refund() external;

    /// @notice Burn unsold tokens after a mode B (partial) settlement.
    function burnUnsold() external;
}
