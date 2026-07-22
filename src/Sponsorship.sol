// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MembershipToken} from "./MembershipToken.sol";
import {MapaePool} from "./MapaePool.sol";

/// @title Sponsorship
/// @notice Fan sponsorship with an automatic burn share (D11): X% of every
///         KRWs sponsorship buys membership tokens from the AMM pool and burns
///         them; the rest goes straight to the creator. Every event carries the
///         KRW-denominated value and the message (for broadcast overlays).
///
///         Slippage guard (§8-B ②): the burn-side buy must land within
///         `maxSlippageBps` of the current spot price after pool fees —
///         a manipulated (thin) pool makes sponsorships revert rather than
///         burn at a fake price.
contract Sponsorship is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error ZeroAddress();
    error InvalidConfig();
    error PoolNotListed();

    /// @notice message is emitted in full for overlays; messageHash is indexed
    ///         so overlays can subscribe/filter cheaply.
    event Sponsored(
        address indexed sponsor,
        bool krwIn,
        uint256 amountIn,
        uint256 krwValue,
        uint256 tokensBurned,
        uint256 creatorAmount,
        bytes32 indexed messageHash,
        string message
    );

    uint16 public constant MAX_BURN_SHARE_BPS = 2000;
    uint16 public constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;

    MembershipToken public immutable token;
    IERC20 public immutable krw;
    address public immutable creator;
    /// @notice X: share of each sponsorship converted to a token burn (0–2000).
    uint16 public immutable burnShareBps;
    /// @notice Max deviation from spot (after pool fees) tolerated on burn buys.
    uint16 public immutable maxSlippageBps;

    constructor(MembershipToken token_, IERC20 krw_, address creator_, uint16 burnShareBps_, uint16 maxSlippageBps_) {
        if (address(token_) == address(0) || address(krw_) == address(0) || creator_ == address(0)) {
            revert ZeroAddress();
        }
        if (burnShareBps_ > MAX_BURN_SHARE_BPS || maxSlippageBps_ >= BPS) revert InvalidConfig();
        token = token_;
        krw = krw_;
        creator = creator_;
        burnShareBps = burnShareBps_;
        maxSlippageBps = maxSlippageBps_;
    }

    /// @dev The pool is looked up lazily — it only exists after settle (D8).
    function _pool() internal view returns (MapaePool) {
        address pool = token.pool();
        if (pool == address(0)) revert PoolNotListed();
        return MapaePool(pool);
    }

    /// @notice Sponsor in KRWs: X% buys tokens from the pool and burns them,
    ///         the remainder is transferred to the creator.
    function sponsorKRWs(uint256 krwAmount, string calldata message)
        external
        nonReentrant
        returns (uint256 tokensBurned)
    {
        if (krwAmount == 0) revert ZeroAmount();
        MapaePool pool = _pool();
        krw.safeTransferFrom(msg.sender, address(this), krwAmount);

        uint256 burnKrw = krwAmount * burnShareBps / BPS;
        if (burnKrw > 0) {
            // Slippage guard: expected out at spot minus pool fees, minus the
            // tolerated deviation band.
            uint256 spot = pool.spotPrice();
            uint256 expectedOut = burnKrw * WAD / spot;
            uint256 minOut = expectedOut * (BPS - pool.totalFeeBps()) / BPS * (BPS - maxSlippageBps) / BPS;
            krw.forceApprove(address(pool), burnKrw);
            tokensBurned = pool.swapKrwForToken(burnKrw, minOut, address(this));
            token.burn(tokensBurned);
        }
        uint256 creatorAmount = krwAmount - burnKrw;
        if (creatorAmount > 0) krw.safeTransfer(creator, creatorAmount);

        emit Sponsored(
            msg.sender, true, krwAmount, krwAmount, tokensBurned, creatorAmount, keccak256(bytes(message)), message
        );
    }

    /// @notice Sponsor in membership tokens: X% burns directly, the remainder
    ///         is transferred to the creator. The KRW value is recorded at the
    ///         AMM spot price for the overlay.
    function sponsorToken(uint256 tokenAmount, string calldata message)
        external
        nonReentrant
        returns (uint256 tokensBurned)
    {
        if (tokenAmount == 0) revert ZeroAmount();
        MapaePool pool = _pool();
        IERC20(address(token)).safeTransferFrom(msg.sender, address(this), tokenAmount);

        tokensBurned = tokenAmount * burnShareBps / BPS;
        if (tokensBurned > 0) token.burn(tokensBurned);
        uint256 creatorAmount = tokenAmount - tokensBurned;
        if (creatorAmount > 0) IERC20(address(token)).safeTransfer(creator, creatorAmount);

        uint256 krwValue = tokenAmount * pool.spotPrice() / WAD;
        emit Sponsored(
            msg.sender, false, tokenAmount, krwValue, tokensBurned, creatorAmount, keccak256(bytes(message)), message
        );
    }
}
