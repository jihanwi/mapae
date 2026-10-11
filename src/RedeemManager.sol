// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRedeemManager} from "./interfaces/IRedeemManager.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";
import {MembershipToken} from "./MembershipToken.sol";
import {BuybackVault} from "./BuybackVault.sol";

/// @title RedeemManager
/// @notice Two creator-perk primitives on one membership token:
///         1. Burn-to-redeem (unchanged): fixed token burn per perk.
///         2. Paid drops (Step 5): KRWs-priced claims — merchFeeBps to the
///            platform treasury, the creator's reroute share to the BuybackVault,
///            the rest to the creator.
///
///         Both primitives are disabled for L0 (invariant 8): createRedeemable
///         and createPaidDrop revert with TierNotAllowed.
/// @dev Deployed per token by the MapaeFactory. Burn-redemption uses burnFrom,
///      so the redeemer grants allowance first (or uses redeemWithPermit).
contract RedeemManager is IRedeemManager, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Redeemable {
        uint256 burnAmount;
        uint256 maxClaims; // 0 = unlimited
        uint256 deadline; // 0 = no deadline
        uint256 claimCount;
        bool exists;
    }

    struct PaidDrop {
        uint256 priceKrw;
        uint256 maxClaims; // 0 = unlimited
        uint256 deadline; // 0 = no deadline
        uint256 claimCount;
        bool exists;
    }

    uint16 internal constant BPS = 10_000;

    MembershipToken public immutable token;
    address public immutable creator;
    IERC20 public immutable krw;
    IFeeRouter public immutable feeRouter;
    IFeeRouter.UtilityTier public immutable tier;
    BuybackVault public immutable buybackVault;

    /// @inheritdoc IRedeemManager
    mapping(uint256 id => Redeemable) public redeemables;
    /// @notice Paid drop metadata + running claim count.
    mapping(uint256 id => PaidDrop) public paidDrops;

    constructor(
        MembershipToken token_,
        address creator_,
        IERC20 krw_,
        IFeeRouter feeRouter_,
        IFeeRouter.UtilityTier tier_,
        BuybackVault buybackVault_
    ) {
        token = token_;
        creator = creator_;
        krw = krw_;
        feeRouter = feeRouter_;
        tier = tier_;
        buybackVault = buybackVault_;
    }

    // ------------------------------------------------------------------
    // Burn-to-redeem (unchanged, plus L0 gate)
    // ------------------------------------------------------------------

    /// @inheritdoc IRedeemManager
    function createRedeemable(uint256 id, uint256 burnAmount, uint256 maxClaims, uint256 deadline) external {
        if (msg.sender != creator) revert NotCreator(msg.sender);
        if (tier == IFeeRouter.UtilityTier.L0) revert TierNotAllowed(); // invariant 8
        if (redeemables[id].exists) revert RedeemableExists(id);
        if (burnAmount == 0) revert ZeroBurnAmount();
        redeemables[id] =
            Redeemable({burnAmount: burnAmount, maxClaims: maxClaims, deadline: deadline, claimCount: 0, exists: true});
        emit RedeemableCreated(id, msg.sender, burnAmount, maxClaims, deadline);
    }

    /// @inheritdoc IRedeemManager
    function redeem(uint256 id) public {
        Redeemable storage r = redeemables[id];
        if (!r.exists) revert UnknownRedeemable(id);
        if (r.deadline != 0 && block.timestamp > r.deadline) revert RedeemClosed(id, r.deadline);
        if (r.maxClaims != 0 && r.claimCount >= r.maxClaims) revert MaxClaimsReached(id, r.maxClaims);

        r.claimCount++;
        token.burnFrom(msg.sender, r.burnAmount);
        emit Redeemed(id, msg.sender, r.burnAmount);
    }

    /// @inheritdoc IRedeemManager
    function redeemWithPermit(uint256 id, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s) external {
        Redeemable storage red = redeemables[id];
        if (!red.exists) revert UnknownRedeemable(id);
        // Front-running a permit only wastes the attacker's gas; if the
        // allowance is already set, a failed permit must not block the redeem.
        try token.permit(msg.sender, address(this), red.burnAmount, permitDeadline, v, r, s) {} catch {}
        redeem(id);
    }

    // ------------------------------------------------------------------
    // Paid drops (Step 5)
    // ------------------------------------------------------------------

    /// @inheritdoc IRedeemManager
    function createPaidDrop(uint256 id, uint256 priceKrw, uint256 maxClaims, uint256 deadline) external {
        if (msg.sender != creator) revert NotCreator(msg.sender);
        if (tier == IFeeRouter.UtilityTier.L0) revert TierNotAllowed(); // invariant 8
        if (paidDrops[id].exists) revert PaidDropExists(id);
        if (priceKrw == 0) revert ZeroPrice();
        paidDrops[id] =
            PaidDrop({priceKrw: priceKrw, maxClaims: maxClaims, deadline: deadline, claimCount: 0, exists: true});
        emit PaidDropCreated(id, msg.sender, priceKrw, maxClaims, deadline);
    }

    /// @inheritdoc IRedeemManager
    function purchaseDrop(uint256 id) external nonReentrant {
        PaidDrop storage d = paidDrops[id];
        if (!d.exists) revert UnknownPaidDrop(id);
        if (d.deadline != 0 && block.timestamp > d.deadline) revert PaidDropClosed(id, d.deadline);
        if (d.maxClaims != 0 && d.claimCount >= d.maxClaims) revert PaidDropSoldOut(id, d.maxClaims);
        d.claimCount++;

        uint256 price = d.priceKrw;
        krw.safeTransferFrom(msg.sender, address(this), price);

        uint256 merchFee = price * feeRouter.getFees(tier).merchFeeBps / BPS;
        uint256 remainder = price - merchFee;
        uint256 reroute = remainder * buybackVault.rerouteRateBps(creator) / BPS;
        uint256 creatorAmount = remainder - reroute; // creator absorbs rounding dust

        if (merchFee > 0) krw.safeTransfer(feeRouter.platformTreasury(), merchFee);
        if (reroute > 0) {
            krw.forceApprove(address(buybackVault), reroute);
            buybackVault.route(address(token), reroute);
        }
        if (creatorAmount > 0) krw.safeTransfer(creator, creatorAmount);
        emit PaidDropPurchased(id, msg.sender, price, merchFee, reroute, creatorAmount);
    }
}
