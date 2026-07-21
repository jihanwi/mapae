// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRedeemManager} from "./interfaces/IRedeemManager.sol";
import {MembershipToken} from "./MembershipToken.sol";

/// @title RedeemManager
/// @notice Burn-to-redeem for creator perks. Exchange rates are fixed in token
///         units per redeemable, independent of market price. Burning works even
///         during the post-listing transfer lock (burns bypass the transfer
///         gate), so redemption is never blocked by the lock.
/// @dev Deployed per token by the MapaeFactory. Redemption uses burnFrom, so
///      the redeemer must grant allowance first — or use redeemWithPermit for
///      a single-transaction flow (EIP-2612).
contract RedeemManager is IRedeemManager {
    struct Redeemable {
        uint256 burnAmount;
        uint256 maxClaims; // 0 = unlimited
        uint256 deadline; // 0 = no deadline
        uint256 claimCount;
        bool exists;
    }

    MembershipToken public immutable token;
    address public immutable creator;

    /// @inheritdoc IRedeemManager
    mapping(uint256 id => Redeemable) public redeemables;

    constructor(MembershipToken token_, address creator_) {
        token = token_;
        creator = creator_;
    }

    /// @inheritdoc IRedeemManager
    function createRedeemable(uint256 id, uint256 burnAmount, uint256 maxClaims, uint256 deadline) external {
        if (msg.sender != creator) revert NotCreator(msg.sender);
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
}
