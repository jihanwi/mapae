// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MembershipToken} from "./MembershipToken.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";
import {IBurnerRegistry} from "./interfaces/IBurnerRegistry.sol";

/// @title MapaePool
/// @notice Minimal constant-product AMM for a single MembershipToken/KRWs pair
///         (D7 — deliberately NOT a UniV2 fork: a ~300-line pool is auditable).
///
///         Swap fee is a tiered 4-way split, taken from the input amount and
///         read LIVE from the FeeRouter by tier (Step 4). Splits (bps of input):
///         - platform  → paid to FeeRouter.platformTreasury immediately (NEW).
///                       KRWs on a buy, membership tokens on a sell ([Q2]).
///         - royalty   → input asset to the creator (unchanged).
///         - burn      → membership-token input burns immediately; KRWs input
///                       accrues in `burnBuffer` until convertAndBurn() (unchanged).
///         - lp        → stays in reserves, UniV2-style; also absorbs the split's
///                       rounding remainder so the four shares sum EXACTLY to the
///                       total fee (invariant 10). Dust stays with LPs/fans.
///
///         `swapForBurn` is a 0%-fee buy-and-burn open only to MapaeFactory-
///         registered burners (Sponsorship / the BuybackVault). The bought
///         tokens are burned in the same call and
///         never returned to the caller — "burn is the only destination" is
///         enforced by the code, not by convention (invariants 1, 2).
///
///         LP shares are a plain ERC-20. The offering seeds initial liquidity
///         at settle and mints the LP shares straight to 0xdEaD (D8).
contract MapaePool is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error ZeroAddress();
    error InsufficientLiquidity();
    error InsufficientOutput(uint256 amountOut, uint256 minOut);
    error EmptyBurnBuffer();
    /// @notice swapForBurn caller is not a MapaeFactory-registered burner.
    error NotBurner(address caller);

    event Swapped(
        address indexed sender, address indexed to, bool krwIn, uint256 amountIn, uint256 amountOut, uint256 royalty
    );
    event LiquidityMinted(address indexed to, uint256 tokenAmount, uint256 krwAmount, uint256 liquidity);
    event LiquidityBurned(address indexed to, uint256 tokenAmount, uint256 krwAmount, uint256 liquidity);
    event TokensBurned(uint256 amount);
    event BurnBufferAccrued(uint256 amount, uint256 total);
    event ConvertedAndBurned(address indexed caller, uint256 krwIn, uint256 tokensBurned);
    /// @notice 0%-fee buy-and-burn driven by a registered burner (invariant 2).
    event BurnSwapped(address indexed caller, uint256 krwIn, uint256 tokensBurned);
    /// @notice Platform swap cut sent to treasury (krwSide=true → KRWs, false → tokens).
    event PlatformFeePaid(address indexed treasury, bool krwSide, uint256 amount);

    uint16 public constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    MembershipToken public immutable membershipToken;
    IERC20 public immutable krw;
    address public immutable creator;
    /// @notice Tiered fee source; swap fees are read live per swap.
    IFeeRouter public immutable feeRouter;
    /// @notice Utility grade — selects the fee schedule.
    IFeeRouter.UtilityTier public immutable tier;
    /// @notice Burner registry (the MapaeFactory) consulted by swapForBurn.
    ///         address(0) means no registry → swapForBurn always reverts.
    address public immutable factory;

    uint256 public reserveToken;
    uint256 public reserveKrw;
    /// @notice KRWs accrued from burn fees, spendable ONLY via convertAndBurn
    ///         (invariant: no other outflow path exists).
    uint256 public burnBuffer;

    constructor(
        MembershipToken membershipToken_,
        IERC20 krw_,
        address creator_,
        IFeeRouter feeRouter_,
        IFeeRouter.UtilityTier tier_,
        address factory_
    ) ERC20("MAPAE LP", "MAPAE-LP") {
        if (
            address(membershipToken_) == address(0) || address(krw_) == address(0) || creator_ == address(0)
                || address(feeRouter_) == address(0)
        ) revert ZeroAddress();
        membershipToken = membershipToken_;
        krw = krw_;
        creator = creator_;
        feeRouter = feeRouter_;
        tier = tier_;
        factory = factory_; // may be address(0) in isolated tests → swapForBurn disabled
    }

    // ------------------------------------------------------------------
    // Liquidity
    // ------------------------------------------------------------------

    /// @notice UniV2-style mint: transfer both assets to the pool first, then
    ///         call mint. The offering calls this with `to = 0xdEaD` at settle.
    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        uint256 tokenBal = membershipToken.balanceOf(address(this));
        uint256 krwBal = krw.balanceOf(address(this)) - burnBuffer;
        uint256 amountToken = tokenBal - reserveToken;
        uint256 amountKrw = krwBal - reserveKrw;

        uint256 supply = totalSupply();
        if (supply == 0) {
            liquidity = Math.sqrt(amountToken * amountKrw);
        } else {
            liquidity = Math.min(amountToken * supply / reserveToken, amountKrw * supply / reserveKrw);
        }
        if (liquidity == 0) revert InsufficientLiquidity();

        _mint(to, liquidity);
        reserveToken = tokenBal;
        reserveKrw = krwBal;
        emit LiquidityMinted(to, amountToken, amountKrw, liquidity);
    }

    /// @notice UniV2-style burn: transfer LP shares to the pool first, then call
    ///         burn. (The seed liquidity sits at 0xdEaD forever, so it can never
    ///         reach this function — invariant 7.)
    function burn(address to) external nonReentrant returns (uint256 amountToken, uint256 amountKrw) {
        uint256 liquidity = balanceOf(address(this));
        if (liquidity == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        amountToken = reserveToken * liquidity / supply;
        amountKrw = reserveKrw * liquidity / supply;
        if (amountToken == 0 || amountKrw == 0) revert InsufficientLiquidity();

        _burn(address(this), liquidity);
        reserveToken -= amountToken;
        reserveKrw -= amountKrw;
        IERC20(address(membershipToken)).safeTransfer(to, amountToken);
        krw.safeTransfer(to, amountKrw);
        emit LiquidityBurned(to, amountToken, amountKrw, liquidity);
    }

    // ------------------------------------------------------------------
    // Fee math (tiered 4-way split, read live from the FeeRouter)
    // ------------------------------------------------------------------

    /// @dev Split `amountIn` into the four fee shares + the effective swap input.
    ///      platform/royalty/burn are floored bps of amountIn; lp = totalFee −
    ///      those three, so platform+royalty+burn+lp == totalFee EXACTLY (no
    ///      precision loss — invariant 10) and lp ≥ 0 (sum of floors ≤ floor of
    ///      sum). effectiveIn = amountIn − totalFee is what actually swaps.
    function _split(uint256 amountIn)
        internal
        view
        returns (uint256 platform, uint256 royalty, uint256 burnAmt, uint256 lp, uint256 effectiveIn)
    {
        IFeeRouter.TierFees memory f = feeRouter.getFees(tier);
        uint256 totalBps = uint256(f.swapPlatformBps) + f.swapRoyaltyBps + f.swapBurnBps + f.swapLpBps;
        uint256 totalFee = amountIn * totalBps / BPS;
        platform = amountIn * f.swapPlatformBps / BPS;
        royalty = amountIn * f.swapRoyaltyBps / BPS;
        burnAmt = amountIn * f.swapBurnBps / BPS;
        lp = totalFee - platform - royalty - burnAmt;
        effectiveIn = amountIn - totalFee;
    }

    // ------------------------------------------------------------------
    // Swaps (tiered split fee on input)
    // ------------------------------------------------------------------

    /// @notice Buy membership tokens with KRWs. Works during the transfer lock
    ///         (the pool is a lock-exempt sender — buys allowed, sells blocked).
    function swapKrwForToken(uint256 amountIn, uint256 minOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        krw.safeTransferFrom(msg.sender, address(this), amountIn);

        (uint256 platform, uint256 royalty, uint256 burnAmt,, uint256 effectiveIn) = _split(amountIn);

        amountOut = reserveToken * effectiveIn / (reserveKrw + effectiveIn);
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);
        if (amountOut >= reserveToken) revert InsufficientLiquidity();

        if (platform > 0) {
            krw.safeTransfer(feeRouter.platformTreasury(), platform);
            emit PlatformFeePaid(feeRouter.platformTreasury(), true, platform);
        }
        if (royalty > 0) krw.safeTransfer(creator, royalty);
        if (burnAmt > 0) {
            burnBuffer += burnAmt;
            emit BurnBufferAccrued(burnAmt, burnBuffer);
        }
        reserveKrw += amountIn - platform - royalty - burnAmt; // lp + effectiveIn stay in reserve
        reserveToken -= amountOut;
        IERC20(address(membershipToken)).safeTransfer(to, amountOut);
        emit Swapped(msg.sender, to, true, amountIn, amountOut, royalty);
    }

    /// @notice Sell membership tokens for KRWs. The token-side burn fee burns
    ///         immediately (Transfer → 0x0 on every sell).
    function swapTokenForKrw(uint256 amountIn, uint256 minOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        IERC20(address(membershipToken)).safeTransferFrom(msg.sender, address(this), amountIn);

        (uint256 platform, uint256 royalty, uint256 burnAmt,, uint256 effectiveIn) = _split(amountIn);

        amountOut = reserveKrw * effectiveIn / (reserveToken + effectiveIn);
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);
        if (amountOut >= reserveKrw) revert InsufficientLiquidity();

        // [Q2] platform cut on a sell is denominated in membership tokens.
        if (platform > 0) {
            IERC20(address(membershipToken)).safeTransfer(feeRouter.platformTreasury(), platform);
            emit PlatformFeePaid(feeRouter.platformTreasury(), false, platform);
        }
        if (royalty > 0) IERC20(address(membershipToken)).safeTransfer(creator, royalty);
        if (burnAmt > 0) {
            membershipToken.burn(burnAmt);
            emit TokensBurned(burnAmt);
        }
        reserveToken += amountIn - platform - royalty - burnAmt; // lp + effectiveIn stay in reserve
        reserveKrw -= amountOut;
        krw.safeTransfer(to, amountOut);
        emit Swapped(msg.sender, to, false, amountIn, amountOut, royalty);
    }

    // ------------------------------------------------------------------
    // Burn-only paths (0% fee — the only destination is 0x0)
    // ------------------------------------------------------------------

    /// @dev Shared core of convertAndBurn/swapForBurn: buy tokens with KRWs that
    ///      are ALREADY in the pool and burn every one. No fee, no output to any
    ///      caller (invariants 1, 2, 10-of-burn-path).
    function _buyAndBurn(uint256 amountIn, uint256 minOut) private returns (uint256 tokensBurned) {
        tokensBurned = reserveToken * amountIn / (reserveKrw + amountIn);
        if (tokensBurned < minOut) revert InsufficientOutput(tokensBurned, minOut);
        if (tokensBurned >= reserveToken) revert InsufficientLiquidity();
        reserveKrw += amountIn;
        reserveToken -= tokensBurned;
        membershipToken.burn(tokensBurned);
    }

    /// @notice Mini buyback (D7): anyone may spend the accrued burn buffer to
    ///         buy membership tokens from this pool and burn all of them.
    function convertAndBurn(uint256 minOut) external nonReentrant returns (uint256 tokensBurned) {
        uint256 amountIn = burnBuffer;
        if (amountIn == 0) revert EmptyBurnBuffer();
        burnBuffer = 0;
        tokensBurned = _buyAndBurn(amountIn, minOut);
        emit ConvertedAndBurned(msg.sender, amountIn, tokensBurned);
    }

    /// @notice 0%-fee buy-and-burn: the caller supplies KRWs, the pool buys
    ///         membership tokens and burns them atomically. Restricted to
    ///         MapaeFactory-registered burners (Sponsorship / BuybackVault);
    ///         every other caller reverts (invariant 1). The output is never
    ///         sent anywhere but 0x0 (invariant 2).
    function swapForBurn(uint256 amountIn, uint256 minOut) external nonReentrant returns (uint256 tokensBurned) {
        if (amountIn == 0) revert ZeroAmount();
        // Fail-closed: no registry (factory == 0) or unregistered caller → revert.
        if (factory == address(0) || !IBurnerRegistry(factory).isBurner(msg.sender)) revert NotBurner(msg.sender);
        krw.safeTransferFrom(msg.sender, address(this), amountIn);
        tokensBurned = _buyAndBurn(amountIn, minOut);
        emit BurnSwapped(msg.sender, amountIn, tokensBurned);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Spot price: KRWs wei per 1e18 token wei.
    function spotPrice() external view returns (uint256) {
        if (reserveToken == 0) return 0;
        return reserveKrw * WAD / reserveToken;
    }

    /// @notice Total swap fee in bps for this pool's tier (platform+royalty+burn+lp).
    function totalFeeBps() public view returns (uint16) {
        IFeeRouter.TierFees memory f = feeRouter.getFees(tier);
        return f.swapPlatformBps + f.swapRoyaltyBps + f.swapBurnBps + f.swapLpBps;
    }

    /// @notice Quote for a KRWs→token swap after all fees.
    function getTokenOut(uint256 krwIn) external view returns (uint256) {
        uint256 effectiveIn = krwIn - (krwIn * totalFeeBps() / BPS);
        return reserveToken * effectiveIn / (reserveKrw + effectiveIn);
    }

    /// @notice Quote for a token→KRWs swap after all fees.
    function getKrwOut(uint256 tokenIn) external view returns (uint256) {
        uint256 effectiveIn = tokenIn - (tokenIn * totalFeeBps() / BPS);
        return reserveKrw * effectiveIn / (reserveToken + effectiveIn);
    }
}
