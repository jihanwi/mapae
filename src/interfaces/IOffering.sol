// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "./IDojang.sol";

/// @title IOffering
/// @notice Fixed-price single offering for a MembershipToken. No bonding curves,
///         no variable pricing. Allocation (equal share + weighted lottery) is
///         computed deterministically off-chain and committed on-chain as a
///         Merkle root; participants claim allocations/refunds pull-style.
/// @dev Settlement is atomic (D4): mint sold+unsold, burn unsold, distribute
///      token allocations, enable transfers, and distribute proceeds happen in
///      a single settle() call — there is no separate burnUnsold() step.
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
    /// @dev Open      — commits and cancels accepted.
    ///      Frozen    — cancel freeze (deadline − 2h) reached; commits still
    ///                  accepted until the deadline, cancels rejected.
    ///      Settled   — allocation root committed; settlement was atomic, so
    ///                  tokens are minted, unsold burned, transfers enabled,
    ///                  proceeds distributed; claims open.
    ///      Finalized — reserved (settlement is atomic in M1; unused).
    ///      Refunding — mode A target missed or settle timeout; deposits refundable.
    enum Phase {
        Open,
        Frozen,
        Settled,
        Finalized,
        Refunding
    }

    /// @notice Token allocation recipients, injected at construction (D4).
    ///         M1: EOAs; M2: wired by the Factory; M4: Vesting/LP contracts.
    struct AllocationRecipients {
        address creatorVesting;
        address lpEscrow;
        address platform;
        address reserve;
    }

    /// @notice Full constructor configuration for an Offering.
    struct OfferingParams {
        IERC20 paymentToken;
        IDojang dojang;
        address creator;
        address platformOwner; // settle authority (Ownable owner) — always the platform ops wallet
        string tokenName;
        string tokenSymbol;
        uint256 price; // P: payment-token wei per 1e18 token wei
        uint256 raiseTarget; // R: payment-token wei
        uint256 deadline; // unix timestamp; duration must be within [12h, 48h]
        uint256 walletLimit; // L: max cumulative commit per wallet (payment wei)
        uint256 minCommit; // minimum first commit (payment wei)
        uint16 fBps; // sale fraction of total supply, in bps (5000–7000)
        uint16 cBps; // LP share of proceeds, in bps (1500–3000); token side l = c × f
        uint16 creatorTokenBps; // creator share of S', in bps (1500–3000)
        RefundMode refundMode;
        uint256 transferLockDuration; // optional post-settle transfer lock; 0 = none
        uint16 holdingCapBps; // optional per-wallet holding cap in bps of supply; 0 = none
        AllocationRecipients recipients;
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
    /// @param totalSold Token amount actually sold (== qSale unless mode B undersell).
    /// @param totalRaised Payment tokens corresponding to totalSold (Σ cost_i).
    /// @param seed Randomness seed used by the off-chain allocator (for public re-computation).
    event Settled(bytes32 indexed allocationRoot, uint256 totalSold, uint256 totalRaised, bytes32 seed);

    /// @notice Emitted when a participant claims their allocation (and any refund).
    /// @param participant The claiming wallet.
    /// @param allocation Membership tokens received.
    /// @param refundAmount Payment tokens refunded (excess over cost).
    event Claimed(address indexed participant, uint256 allocation, uint256 refundAmount);

    /// @notice Emitted when a participant withdraws their full deposit while Refunding.
    /// @param participant The refunded wallet.
    /// @param amount Payment tokens returned.
    event Refunded(address indexed participant, uint256 amount);

    /// @notice Emitted when unsold tokens are burned during settlement.
    /// @param amount Membership tokens burned.
    event UnsoldBurned(uint256 amount);

    /// @notice Emitted when the offering enters Refunding.
    /// @param emergency False = mode A target missed (enableRefunds),
    ///                  true = settle timeout escape hatch (emergencyRefund).
    event RefundsEnabled(bool emergency);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /// @notice Caller does not hold a valid Dojang Verified Address attestation.
    error NotVerified(address account);
    /// @notice Commit would push the wallet's cumulative deposit above the per-wallet limit L.
    error OverWalletLimit(address account, uint256 attempted, uint256 limit);
    /// @notice Cancel rejected inside the freeze window (deadline − 2h onwards).
    error CommitFrozen();
    /// @notice The issuing creator's wallet cannot participate in its own offering.
    error IssuerCannotCommit();
    /// @notice Action requires the offering to be settled first.
    error NotSettled();
    /// @notice Action is not valid in the current phase.
    error InvalidPhase(Phase current);
    /// @notice First commit must reach the platform minimum.
    error BelowMinCommit(uint256 amount, uint256 minimum);
    /// @notice Merkle proof does not match the committed allocation root.
    error InvalidProof();
    /// @notice Participant has already claimed.
    error AlreadyClaimed(address account);
    /// @notice Refunds are only available while Refunding.
    error RefundNotAvailable();
    /// @notice Amount must be non-zero.
    error ZeroAmount();
    /// @notice Commits are closed once the deadline has passed.
    error DeadlinePassed();
    /// @notice Action requires the deadline to have passed.
    error DeadlineNotReached();
    /// @notice Offering duration must be within [MIN_DURATION, MAX_DURATION].
    error InvalidDuration();
    /// @notice Constructor parameter validation failed.
    error InvalidConfig();
    /// @notice Cancel amount exceeds the wallet's current commitment.
    error ExceedsCommitted(uint256 requested, uint256 current);
    /// @notice Cancel must leave either zero or at least minCommit — a dust
    ///         residue would inflate the equal-share participant count (A1).
    error ResidualBelowMinCommit(uint256 remaining, uint256 minimum);
    /// @notice Mode A settle requires the raise target to have been met.
    error TargetNotReached();
    /// @notice Mode A refunds require the raise target to have been missed.
    error TargetReached();
    /// @notice Emergency refund requires deadline + SETTLE_TIMEOUT to have passed.
    error SettleTimeoutNotReached();
    /// @notice Settle inputs failed on-chain sanity checks (D2).
    error SettleSanityFailed();
    /// @notice Claim would exceed the on-chain accounting caps (D2).
    error AccountingCapExceeded();
    /// @notice Caller has no deposit to refund.
    error NothingToRefund();

    // ---------------------------------------------------------------------
    // Mutating functions
    // ---------------------------------------------------------------------

    /// @notice Deposit `amount` payment tokens toward the offering.
    /// @dev Allowed until the deadline (commits are NOT frozen — only cancels are).
    ///      Requires Dojang verification (snapshot at commit time), enforces
    ///      cumulative <= L and first-commit >= minCommit, and reverts for the
    ///      issuer's own wallet.
    function commit(uint256 amount) external;

    /// @notice Withdraw `amount` of a prior commitment.
    /// @dev Only allowed until 2 hours before the deadline (anti last-minute
    ///      mass-cancel abuse); reverts with CommitFrozen afterwards.
    function cancel(uint256 amount) external;

    /// @notice Commit the off-chain computed allocation and settle atomically (D4):
    ///         sanity-check inputs, mint sold+unsold+allocations, burn unsold,
    ///         enable transfers, and distribute proceeds (80/10/10).
    /// @param allocationRoot Merkle root of (participant, allocation, refundAmount) leaves.
    /// @param totalSold Token amount actually sold (Σ allocation_i).
    /// @param totalRaised Payment tokens kept for the raise (Σ cost_i).
    /// @param seed Randomness seed used by the allocator, recorded for public verification.
    function settle(bytes32 allocationRoot, uint256 totalSold, uint256 totalRaised, bytes32 seed) external;

    /// @notice Claim allocated tokens plus any refund, pull-style, with a Merkle proof.
    /// @dev Leaf = keccak256(bytes.concat(keccak256(abi.encode(account, allocation,
    ///      refundAmount)))) — double-hashed (OZ MerkleProof standard).
    /// @param allocation Membership tokens allocated to the caller.
    /// @param refundAmount Payment tokens to refund to the caller.
    /// @param proof Merkle proof for the caller's leaf.
    function claim(uint256 allocation, uint256 refundAmount, bytes32[] calldata proof) external;

    /// @notice Mode A only: after the deadline, if totalCommitted < R, anyone can
    ///         switch the offering to Refunding (the fact is on-chain verifiable,
    ///         so no owner involvement is needed — D3).
    function enableRefunds() external;

    /// @notice Escape hatch (D3): if the owner has not settled within
    ///         SETTLE_TIMEOUT after the deadline, anyone can switch to Refunding.
    function emergencyRefund() external;

    /// @notice Withdraw the caller's full deposit while Refunding (pull-style).
    function refund() external;

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice The ERC-20 used for payment (injected; decimals never hardcoded).
    function paymentToken() external view returns (IERC20);

    /// @notice Current lifecycle phase (derived from time + settle/refund state).
    function phase() external view returns (Phase);

    /// @notice Cumulative committed amount for `account` (zeroed after refund()).
    function committed(address account) external view returns (uint256);

    /// @notice Whether `account` has already claimed.
    function hasClaimed(address account) external view returns (bool);

    /// @notice Sum of all outstanding commitments.
    function totalCommitted() external view returns (uint256);

    /// @notice Core offering parameters.
    function params()
        external
        view
        returns (
            uint256 price,
            uint256 raiseTarget,
            uint256 deadline,
            uint256 walletLimit,
            RefundMode refundMode,
            uint256 minCommit
        );

    /// @notice Tokens offered for sale: qSale = R × 1e18 / P (floor).
    function qSale() external view returns (uint256);

    /// @notice Cancel freeze window before the deadline (absolute, 2h).
    function freezeWindow() external view returns (uint256);
}
