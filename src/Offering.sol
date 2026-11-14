// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IDojang} from "./interfaces/IDojang.sol";
import {IOffering} from "./interfaces/IOffering.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";
import {MembershipToken} from "./MembershipToken.sol";
import {MembershipTokenDeployer} from "./MembershipTokenDeployer.sol";
import {MapaePool} from "./MapaePool.sol";
import {PoolFactory} from "./PoolFactory.sol";

/// @title Offering
/// @notice Fixed-price single offering. Deploys its own MembershipToken; the
///         token's sole minter is this contract, and minting happens exactly
///         once inside settle() (D4 atomic settlement).
///
///         Trust model (docs/TRUST.md): allocation is computed off-chain
///         deterministically and committed as a Merkle root by the platform
///         owner; on-chain sanity checks and claim-side accounting caps (D2)
///         make over-withdrawal impossible even under a manipulated root.
///         A challenge period is roadmap, not M1.
contract Offering is IOffering, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Duration band lower bound for premium tiers (L1/L2), 기획 v4.5.
    uint256 public constant MIN_DURATION = 12 hours;
    /// @notice Duration band lower bound for L0 (fast, same-day offerings).
    uint256 public constant MIN_DURATION_L0 = 1 hours;
    /// @notice Offering duration band upper bound (all tiers).
    uint256 public constant MAX_DURATION = 48 hours;
    /// @notice Cancel freeze before the deadline — absolute 2h, never proportional.
    ///         L0 disables cancel entirely, so the freeze never applies there.
    uint256 public constant CANCEL_FREEZE = 2 hours;
    /// @notice After deadline + this timeout without settle, anyone can trigger refunds (D3).
    uint256 public constant SETTLE_TIMEOUT = 7 days;

    // Tokenomics bands — premium tiers (L1/L2): f 50–70%, issuer 15–30%.
    uint16 public constant MIN_F_BPS = 5000;
    uint16 public constant MAX_F_BPS = 7000;
    uint16 public constant MIN_CREATOR_TOKEN_BPS = 1500;
    uint16 public constant MAX_CREATOR_TOKEN_BPS = 3000;

    // Tokenomics bands — L0: f 70–80%, issuer 5–15%. No platform token share on any tier (decision 21).
    uint16 public constant MIN_F_BPS_L0 = 7000;
    uint16 public constant MAX_F_BPS_L0 = 8000;
    uint16 public constant MIN_CREATOR_TOKEN_BPS_L0 = 500;
    uint16 public constant MAX_CREATOR_TOKEN_BPS_L0 = 1500;

    // c band shared across tiers ([Q3]); preset default 25%.
    uint16 public constant MIN_C_BPS = 1500;
    uint16 public constant MAX_C_BPS = 3000;

    // Per-pool swap royalty/burn bands (R2 — creator-set within tier band,
    // snapshotted at construction). platform/LP shares stay FeeRouter-sourced.
    uint16 public constant MAX_SWAP_ROYALTY_BPS = 80; // L1/L2
    uint16 public constant MAX_SWAP_ROYALTY_BPS_L0 = 30; // L0
    uint16 public constant MAX_SWAP_BURN_BPS = 50; // all tiers

    uint16 public constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;

    // ---------------------------------------------------------------------
    // Immutable configuration
    // ---------------------------------------------------------------------

    /// @inheritdoc IOffering
    IERC20 public immutable paymentToken;
    IDojang public immutable dojang;
    address public immutable creator;
    MembershipToken public immutable token;

    /// @notice P: payment-token wei per 1e18 token wei.
    uint256 public immutable price;
    /// @notice R: raise target in payment-token wei.
    uint256 public immutable raiseTarget;
    uint256 public immutable deadline;
    /// @notice L: per-wallet cumulative commit limit.
    uint256 public immutable walletLimit;
    uint256 public immutable minCommit;
    /// @notice Sale fraction of total supply in bps.
    uint16 public immutable fBps;
    /// @notice LP share of proceeds in bps (parameterized, band 1500–3000).
    uint16 public immutable cBps;
    /// @notice Creator share of S' in bps (parameterized, band 1500–3000).
    uint16 public immutable creatorTokenBps;
    /// @notice LP token share of S' in bps = cBps × fBps / BPS (invariant 11: l = c × f).
    uint16 public immutable lpTokenBps;
    RefundMode public immutable refundMode;
    /// @inheritdoc IOffering
    uint256 public immutable qSale;
    /// @notice Deploys the AMM pool at settle (D8 at-par listing).
    PoolFactory public immutable poolFactory;
    /// @notice Tiered fee source. Swap fees are read live by the pool; the
    ///         offering fee below is snapshotted here at construction.
    IFeeRouter public immutable feeRouter;
    /// @notice Utility grade — selects fee schedule and tokenomics/duration bands.
    IFeeRouter.UtilityTier public immutable tier;
    /// @notice Platform proceeds cut, SNAPSHOTTED from FeeRouter at construction —
    ///         a later FeeRouter change never affects this offering (invariant 11).
    uint16 public immutable offeringFeeBps;
    /// @notice Hard raise floor: raiseTarget < minRaise reverts (invariant 5).
    uint256 public immutable minRaise;
    /// @notice MapaeFactory address, forwarded to the pool as its burner registry.
    address public immutable mapaeFactory;
    /// @notice Per-pool creator swap royalty, snapshotted (tier band). The pool's
    ///         platform/LP shares still come from the FeeRouter live.
    uint16 public immutable swapRoyaltyBps;
    /// @notice Per-pool creator swap burn, snapshotted (tier band).
    uint16 public immutable swapBurnBps;

    AllocationRecipients public recipients;

    /// @notice The AMM pool, set at settle (address(0) before, or if the seed
    ///         rounded to zero on a dust-sized raise).
    MapaePool public pool;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @inheritdoc IOffering
    mapping(address account => uint256) public committed;
    /// @inheritdoc IOffering
    mapping(address account => bool) public hasClaimed;
    /// @inheritdoc IOffering
    uint256 public totalCommitted;

    bool public settled;
    bool public refunding;

    bytes32 public allocationRoot;
    bytes32 public seed;
    uint256 public totalSold;
    uint256 public totalRaised;

    /// @dev D2 claim-side accounting caps: cumulative claimed tokens can never
    ///      exceed totalSold, cumulative claim refunds can never exceed
    ///      totalCommitted − totalRaised — even under a manipulated root.
    uint256 public claimedTokens;
    uint256 public refundedPayment;

    constructor(OfferingParams memory p) Ownable(p.platformOwner) {
        if (
            address(p.paymentToken) == address(0) || address(p.dojang) == address(0) || p.creator == address(0)
                || address(p.poolFactory) == address(0) || address(p.feeRouter) == address(0)
                || p.recipients.creatorVesting == address(0) || p.recipients.platform == address(0)
        ) revert InvalidConfig();
        if (p.price == 0 || p.raiseTarget == 0 || p.walletLimit == 0 || p.minCommit == 0) revert InvalidConfig();
        if (p.minCommit > p.walletLimit) revert InvalidConfig();
        // Hard raise floor (invariant 5) — enforced at the Offering level so it
        // holds even for offerings constructed outside the factory.
        if (p.raiseTarget < p.minRaise) revert InvalidConfig();

        // Tier-dependent tokenomics bands (Step 2). L0: f 70–80%, issuer 5–15%.
        // L1/L2: f 50–70%, issuer 15–30%. No platform token share on any tier (decision 21).
        if (p.tier == IFeeRouter.UtilityTier.L0) {
            if (p.fBps < MIN_F_BPS_L0 || p.fBps > MAX_F_BPS_L0) revert InvalidConfig();
            if (p.creatorTokenBps < MIN_CREATOR_TOKEN_BPS_L0 || p.creatorTokenBps > MAX_CREATOR_TOKEN_BPS_L0) {
                revert InvalidConfig();
            }
        } else {
            if (p.fBps < MIN_F_BPS || p.fBps > MAX_F_BPS) revert InvalidConfig();
            if (p.creatorTokenBps < MIN_CREATOR_TOKEN_BPS || p.creatorTokenBps > MAX_CREATOR_TOKEN_BPS) {
                revert InvalidConfig();
            }
        }
        if (p.cBps < MIN_C_BPS || p.cBps > MAX_C_BPS) revert InvalidConfig();

        // Per-pool swap royalty/burn bands (R2), tier-dependent for royalty.
        {
            uint16 maxRoyalty = p.tier == IFeeRouter.UtilityTier.L0 ? MAX_SWAP_ROYALTY_BPS_L0 : MAX_SWAP_ROYALTY_BPS;
            if (p.swapRoyaltyBps > maxRoyalty || p.swapBurnBps > MAX_SWAP_BURN_BPS) revert InvalidConfig();
            // v3: L0 pools cap the total swap fee at 100 bps (platform 40 + lp 30 + royalty ≤ 30) → burn share 0.
            if (p.tier == IFeeRouter.UtilityTier.L0 && p.swapBurnBps != 0) revert InvalidConfig();
        }

        // Duration band is tier-dependent: L1/L2 [12h,48h], L0 [1h,48h].
        if (p.deadline <= block.timestamp) revert InvalidDuration();
        uint256 duration = p.deadline - block.timestamp;
        uint256 minDur = p.tier == IFeeRouter.UtilityTier.L0 ? MIN_DURATION_L0 : MIN_DURATION;
        if (duration < minDur || duration > MAX_DURATION) revert InvalidDuration();

        uint256 qSale_ = p.raiseTarget * WAD / p.price;
        if (qSale_ == 0) revert InvalidConfig();

        // Invariant 11: LP token share l = c × f → listing price equals P.
        // Combined feasibility: every share must fit within 100% of S', so
        // remainder = S' − sold − creator − LP ≥ 0 always holds (burned at settle) and
        // settle can never underflow. No platform token share (decision 21).
        uint16 lpTokenBps_ = uint16(uint256(p.cBps) * p.fBps / BPS);
        if (uint256(p.fBps) + p.creatorTokenBps + lpTokenBps_ > BPS) revert InvalidConfig();

        paymentToken = p.paymentToken;
        dojang = p.dojang;
        creator = p.creator;
        price = p.price;
        raiseTarget = p.raiseTarget;
        minRaise = p.minRaise;
        deadline = p.deadline;
        walletLimit = p.walletLimit;
        minCommit = p.minCommit;
        fBps = p.fBps;
        cBps = p.cBps;
        creatorTokenBps = p.creatorTokenBps;
        lpTokenBps = lpTokenBps_;
        refundMode = p.refundMode;
        qSale = qSale_;
        poolFactory = p.poolFactory;
        feeRouter = p.feeRouter;
        tier = p.tier;
        // Snapshot the platform proceeds cut — invariant 11 (never re-read).
        offeringFeeBps = p.feeRouter.getFees(p.tier).offeringFeeBps;
        mapaeFactory = p.mapaeFactory;
        // Snapshot creator swap royalty/burn (same principle as the offering fee).
        swapRoyaltyBps = p.swapRoyaltyBps;
        swapBurnBps = p.swapBurnBps;
        recipients = p.recipients;

        address[] memory capExempt = new address[](2);
        capExempt[0] = p.recipients.creatorVesting;
        capExempt[1] = p.recipients.platform;
        // Linked library (DELEGATECALL): CREATE runs from this address/nonce,
        // identical to an inline `new` — bytecode lives outside our initcode (C8).
        token = MembershipTokenDeployer.deploy(
            p.tokenName, p.tokenSymbol, address(this), p.transferLockDuration, p.holdingCapBps, capExempt
        );
    }

    // ---------------------------------------------------------------------
    // Commit / cancel
    // ---------------------------------------------------------------------

    /// @inheritdoc IOffering
    function commit(uint256 amount) external nonReentrant {
        if (settled || refunding) revert InvalidPhase(phase());
        if (block.timestamp >= deadline) revert DeadlinePassed();
        if (amount == 0) revert ZeroAmount();
        if (msg.sender == creator) revert IssuerCannotCommit();
        // Fail-closed: a reverting or false-returning Dojang lookup rejects the commit.
        if (!dojang.isVerified(msg.sender)) revert NotVerified(msg.sender);

        uint256 cumulative = committed[msg.sender] + amount;
        if (committed[msg.sender] == 0 && cumulative < minCommit) revert BelowMinCommit(cumulative, minCommit);
        if (cumulative > walletLimit) revert OverWalletLimit(msg.sender, cumulative, walletLimit);

        committed[msg.sender] = cumulative;
        totalCommitted += amount;
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Committed(msg.sender, amount, cumulative);
    }

    /// @inheritdoc IOffering
    function cancel(uint256 amount) external nonReentrant {
        // L0:응모 = 확정. Cancel is disabled in every state (invariant 3); the
        // freeze logic below is never reached for L0.
        if (tier == IFeeRouter.UtilityTier.L0) revert CancelDisabled();
        if (settled || refunding) revert InvalidPhase(phase());
        if (block.timestamp >= deadline - CANCEL_FREEZE) revert CommitFrozen();
        if (amount == 0) revert ZeroAmount();

        uint256 current = committed[msg.sender];
        if (amount > current) revert ExceedsCommitted(amount, current);
        // A1: residue must be 0 or ≥ minCommit — else dust wallets could inflate
        // the equal-share participant count in the allocation.
        uint256 remaining = current - amount;
        if (remaining != 0 && remaining < minCommit) revert ResidualBelowMinCommit(remaining, minCommit);

        committed[msg.sender] = remaining;
        totalCommitted -= amount;
        paymentToken.safeTransfer(msg.sender, amount);
        emit Cancelled(msg.sender, amount, remaining);
    }

    // ---------------------------------------------------------------------
    // Settlement (atomic — D4)
    // ---------------------------------------------------------------------

    /// @inheritdoc IOffering
    function settle(bytes32 allocationRoot_, uint256 totalSold_, uint256 totalRaised_, bytes32 seed_)
        external
        onlyOwner
        nonReentrant
    {
        if (settled || refunding) revert InvalidPhase(phase());
        if (block.timestamp < deadline) revert DeadlineNotReached();
        // Mode A must go down the refund path when under target.
        if (refundMode == RefundMode.AllOrNothing && totalCommitted < raiseTarget) revert TargetNotReached();

        // D2 sanity checks — a bad root still cannot move more value than these bounds.
        if (totalSold_ == 0 || totalSold_ > qSale) revert SettleSanityFailed();
        if (totalRaised_ > totalCommitted) revert SettleSanityFailed();
        if (totalRaised_ > totalSold_ * price / WAD) revert SettleSanityFailed();

        settled = true;
        allocationRoot = allocationRoot_;
        totalSold = totalSold_;
        totalRaised = totalRaised_;
        seed = seed_;

        // D4 ①: effective supply from actual sales; sale fraction stays fBps.
        uint256 supply = totalSold_ * BPS / fBps;
        _mintAndBurnUnsold(totalSold_, supply);
        uint256 krwSeed = _listAtPar(totalRaised_, supply);
        _distributeProceeds(totalRaised_, krwSeed);

        emit Settled(allocationRoot_, totalSold_, totalRaised_, seed_);
    }

    /// @dev D4 ②③: one-shot mint (sold + unsold + LP seed + remainder to this contract,
    ///      creator share to vesting; enables transfers, revokes mint authority forever), then
    ///      burn unsold and the remainder in the same tx — the Transfer→0x0 events are the
    ///      on-explorer proof the token "was born scarcer" (불변식 10). v3 decision 21: no
    ///      platform token share and no reserve recipient; the remainder (incl. rounding) burns.
    function _mintAndBurnUnsold(uint256 totalSold_, uint256 supply) internal {
        uint256 unsold = qSale - totalSold_;
        uint256 creatorAmount = supply * creatorTokenBps / BPS;
        uint256 lpAmount = supply * lpTokenBps / BPS;
        // Remainder absorbs all rounding (D4); safe because share bps sum <= 100%.
        uint256 remainder = supply - totalSold_ - creatorAmount - lpAmount;

        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        to[0] = address(this);
        amounts[0] = totalSold_ + unsold + lpAmount + remainder; // LP share seeds the pool below
        to[1] = recipients.creatorVesting;
        amounts[1] = creatorAmount;
        token.mintAllocations(to, amounts);

        if (unsold > 0) {
            token.burn(unsold);
            emit UnsoldBurned(unsold);
        }
        if (remainder > 0) {
            token.burn(remainder);
            emit RemainderBurned(remainder);
        }
    }

    /// @dev D8: at-par listing. Seed the pool so the spot price equals P:
    ///      tokenSeed = lpProceeds / P (capped by the minted LP share — the bps
    ///      double-floor can make lpAmount a hair smaller than the exact c×f
    ///      cut), krwSeed = tokenSeed × P. LP shares go straight to 0xdEaD:
    ///      permanently unownable (불변식 7). Rounding dust: leftover LP tokens are
    ///      burned (decision 21), leftover KRWs → creator via _distributeProceeds (D1).
    function _listAtPar(uint256 totalRaised_, uint256 supply) internal returns (uint256 krwSeed) {
        uint256 lpAmount = supply * lpTokenBps / BPS;
        uint256 tokenSeed = totalRaised_ * cBps / BPS * WAD / price;
        if (tokenSeed > lpAmount) tokenSeed = lpAmount;
        krwSeed = tokenSeed * price / WAD;

        if (tokenSeed > 0 && krwSeed > 0) {
            MapaePool pool_ = poolFactory.createPool(
                token, paymentToken, creator, feeRouter, tier, mapaeFactory, swapRoyaltyBps, swapBurnBps, dojang
            );
            token.registerPool(address(pool_));
            pool = pool_;
            IERC20(address(token)).safeTransfer(address(pool_), tokenSeed);
            paymentToken.safeTransfer(address(pool_), krwSeed);
            uint256 lpShares = pool_.mint(pool_.DEAD());
            emit Listed(address(pool_), tokenSeed, krwSeed, lpShares);
        }
        if (lpAmount > tokenSeed) {
            token.burn(lpAmount - tokenSeed);
            emit RemainderBurned(lpAmount - tokenSeed);
        }
    }

    /// @dev Proceeds split: platform = offeringFeeBps (snapshot at construction,
    ///      invariant 11), LP share seeded into the pool (krwSeed), creator =
    ///      remainder including all KRW rounding dust (never the platform — D1).
    function _distributeProceeds(uint256 totalRaised_, uint256 krwSeed) internal {
        uint256 platformProceeds = totalRaised_ * offeringFeeBps / BPS;
        uint256 creatorProceeds = totalRaised_ - krwSeed - platformProceeds;
        if (platformProceeds > 0) paymentToken.safeTransfer(recipients.platform, platformProceeds);
        if (creatorProceeds > 0) paymentToken.safeTransfer(creator, creatorProceeds);
    }

    // ---------------------------------------------------------------------
    // Claim
    // ---------------------------------------------------------------------

    /// @inheritdoc IOffering
    function claim(uint256 allocation, uint256 refundAmount, bytes32[] calldata proof) external nonReentrant {
        if (!settled) revert NotSettled();
        if (hasClaimed[msg.sender]) revert AlreadyClaimed(msg.sender);

        // Double-hashed leaf (OZ MerkleProof standard, second-preimage safe).
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, allocation, refundAmount))));
        if (!MerkleProof.verify(proof, allocationRoot, leaf)) revert InvalidProof();

        hasClaimed[msg.sender] = true;

        // D2 accounting caps: even a manipulated root cannot exceed these.
        claimedTokens += allocation;
        if (claimedTokens > totalSold) revert AccountingCapExceeded();
        refundedPayment += refundAmount;
        if (refundedPayment > totalCommitted - totalRaised) revert AccountingCapExceeded();

        if (allocation > 0) IERC20(address(token)).safeTransfer(msg.sender, allocation);
        if (refundAmount > 0) paymentToken.safeTransfer(msg.sender, refundAmount);
        emit Claimed(msg.sender, allocation, refundAmount);
    }

    // ---------------------------------------------------------------------
    // Refund paths (D3)
    // ---------------------------------------------------------------------

    /// @inheritdoc IOffering
    function enableRefunds() external {
        if (settled || refunding) revert InvalidPhase(phase());
        if (refundMode != RefundMode.AllOrNothing) revert RefundNotAvailable();
        if (block.timestamp < deadline) revert DeadlineNotReached();
        if (totalCommitted >= raiseTarget) revert TargetReached();
        refunding = true;
        emit RefundsEnabled(false);
    }

    /// @inheritdoc IOffering
    function emergencyRefund() external {
        if (settled || refunding) revert InvalidPhase(phase());
        if (block.timestamp < deadline + SETTLE_TIMEOUT) revert SettleTimeoutNotReached();
        refunding = true;
        emit RefundsEnabled(true);
    }

    /// @inheritdoc IOffering
    function refund() external nonReentrant {
        if (!refunding) revert RefundNotAvailable();
        uint256 amount = committed[msg.sender];
        if (amount == 0) revert NothingToRefund();
        committed[msg.sender] = 0;
        paymentToken.safeTransfer(msg.sender, amount);
        emit Refunded(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @inheritdoc IOffering
    function phase() public view returns (Phase) {
        if (refunding) return Phase.Refunding;
        if (settled) return Phase.Settled;
        // L0 has no freeze window — commits stay open right up to the deadline.
        if (tier == IFeeRouter.UtilityTier.L0) return Phase.Open;
        if (block.timestamp < deadline - CANCEL_FREEZE) return Phase.Open;
        return Phase.Frozen;
    }

    /// @notice The ERC-20 used to settle the sale (IPrimaryMarket) — same token
    ///         as paymentToken(); decimals are never hardcoded.
    function settlementToken() external view returns (IERC20) {
        return paymentToken;
    }

    /// @inheritdoc IOffering
    function params() external view returns (uint256, uint256, uint256, uint256, RefundMode, uint256) {
        return (price, raiseTarget, deadline, walletLimit, refundMode, minCommit);
    }

    /// @inheritdoc IOffering
    function freezeWindow() external pure returns (uint256) {
        return CANCEL_FREEZE;
    }
}
