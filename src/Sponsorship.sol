// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MembershipToken} from "./MembershipToken.sol";
import {MapaePool} from "./MapaePool.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";
import {BuybackVault} from "./BuybackVault.sol";

/// @title Sponsorship
/// @notice Fan sponsorship with an automatic burn share (D11): X% of every
///         KRWs sponsorship buys membership tokens from the AMM pool and burns
///         them; the rest goes to the creator (minus the creator's optional
///         reroute share, which is sent to the BuybackVault — Step 6).
///
///         The burn-buy goes through MapaePool.swapForBurn (0% fee — Step 6):
///         Sponsorship is a MapaeFactory-registered burner, so "sponsorship fee
///         = 0%" is proven by there being NO FeeRouter call path here at all.
///
///         Slippage guard (§8-B ②): the burn-side buy must land within
///         `maxSlippageBps` of spot, so a manipulated (thin) pool makes
///         sponsorships revert rather than burn at a fake price.
///
///         Disabled for L0 (invariant 8): both entrypoints revert.
contract Sponsorship is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error ZeroAddress();
    error InvalidConfig();
    error PoolNotListed();
    error TierNotAllowed();

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
    /// @notice Portion of a KRWs sponsorship rerouted to the BuybackVault.
    event Rerouted(uint256 amount);

    uint16 public constant MAX_BURN_SHARE_BPS = 2000;
    uint16 public constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;

    MembershipToken public immutable token;
    IERC20 public immutable krw;
    address public immutable creator;
    /// @notice X: share of each sponsorship converted to a token burn (0–2000).
    uint16 public immutable burnShareBps;
    /// @notice Max deviation from spot tolerated on burn buys.
    uint16 public immutable maxSlippageBps;
    IFeeRouter.UtilityTier public immutable tier;
    BuybackVault public immutable buybackVault;

    constructor(
        MembershipToken token_,
        IERC20 krw_,
        address creator_,
        uint16 burnShareBps_,
        uint16 maxSlippageBps_,
        IFeeRouter.UtilityTier tier_,
        BuybackVault buybackVault_
    ) {
        if (address(token_) == address(0) || address(krw_) == address(0) || creator_ == address(0)) {
            revert ZeroAddress();
        }
        if (burnShareBps_ > MAX_BURN_SHARE_BPS || maxSlippageBps_ >= BPS) revert InvalidConfig();
        token = token_;
        krw = krw_;
        creator = creator_;
        burnShareBps = burnShareBps_;
        maxSlippageBps = maxSlippageBps_;
        tier = tier_;
        buybackVault = buybackVault_;
    }

    /// @dev The pool is looked up lazily — it only exists after settle (D8).
    function _pool() internal view returns (MapaePool) {
        address pool = token.pool();
        if (pool == address(0)) revert PoolNotListed();
        return MapaePool(pool);
    }

    /// @notice Sponsor in KRWs: X% buys tokens from the pool (0%-fee swapForBurn)
    ///         and burns them; the remainder goes to the creator, less the
    ///         creator's reroute share which is routed to the BuybackVault.
    function sponsorKRWs(uint256 krwAmount, string calldata message)
        external
        nonReentrant
        returns (uint256 tokensBurned)
    {
        if (tier == IFeeRouter.UtilityTier.L0) revert TierNotAllowed(); // invariant 8
        if (krwAmount == 0) revert ZeroAmount();
        MapaePool pool = _pool();
        krw.safeTransferFrom(msg.sender, address(this), krwAmount);

        uint256 burnKrw = krwAmount * burnShareBps / BPS;
        if (burnKrw > 0) {
            // Slippage guard vs spot — swapForBurn is 0-fee, so no fee term.
            uint256 spot = pool.spotPrice();
            uint256 expectedOut = burnKrw * WAD / spot;
            uint256 minOut = expectedOut * (BPS - maxSlippageBps) / BPS;
            krw.forceApprove(address(pool), burnKrw);
            tokensBurned = pool.swapForBurn(burnKrw, minOut);
        }

        uint256 creatorShare = krwAmount - burnKrw;
        uint256 reroute = creatorShare * buybackVault.rerouteRateBps(creator) / BPS;
        uint256 toCreator = creatorShare - reroute;
        if (reroute > 0) {
            krw.forceApprove(address(buybackVault), reroute);
            buybackVault.route(address(token), reroute);
            emit Rerouted(reroute);
        }
        if (toCreator > 0) krw.safeTransfer(creator, toCreator);

        emit Sponsored(
            msg.sender, true, krwAmount, krwAmount, tokensBurned, toCreator, keccak256(bytes(message)), message
        );
    }

    /// @notice Sponsor in membership tokens: X% burns directly, the remainder is
    ///         transferred to the creator (token-denominated → no KRWs reroute).
    ///         The KRW value is recorded at the AMM spot price for the overlay.
    function sponsorToken(uint256 tokenAmount, string calldata message)
        external
        nonReentrant
        returns (uint256 tokensBurned)
    {
        if (tier == IFeeRouter.UtilityTier.L0) revert TierNotAllowed(); // invariant 8
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
