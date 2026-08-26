// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MembershipToken} from "../MembershipToken.sol";

/// @title IPrimaryMarket
/// @notice The slot a primary-market sale plugs into. The MapaeFactory drives
///         and inspects sales only through this surface, so a future CurveSale
///         (bonding curve) can occupy the same slot as today's FixedOffering
///         with no factory change. This milestone ships the interface plus the
///         FixedOffering (Offering.sol) implementation only.
/// @dev `phase()` is the finalize-state signal; `token()`/`settlementToken()`
///      expose the deployed membership token and the settlement (payment) ERC-20.
interface IPrimaryMarket {
    /// @notice Offering lifecycle.
    /// @dev Open      — commits and cancels accepted.
    ///      Frozen    — cancel freeze reached; commits accepted, cancels rejected.
    ///                  (L0 has no freeze — it never enters this phase.)
    ///      Settled   — allocation root committed; atomic settlement done; claims open.
    ///      Finalized — reserved (settlement is atomic here; unused).
    ///      Refunding — target missed (mode A) or settle timeout; deposits refundable.
    enum Phase {
        Open,
        Frozen,
        Settled,
        Finalized,
        Refunding
    }

    /// @notice The membership token this sale mints/settles.
    function token() external view returns (MembershipToken);

    /// @notice The ERC-20 used to settle the sale (decimals never hardcoded).
    function settlementToken() external view returns (IERC20);

    /// @notice Current lifecycle phase (derived from time + settle/refund state).
    function phase() external view returns (Phase);
}
