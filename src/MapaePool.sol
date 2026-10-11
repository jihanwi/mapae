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
///         Swap fee is a tiered 4-way split. platform + LP shares come from the
///         FeeRouter live by tier (not overridable); royalty + burn are per-pool
///         creator settings snapshotted at creation (R2). The split is
///         DIRECTIONAL so royalty is always paid in KRWs and the treasury never
///         holds creator tokens (R1, invariant 17):
///         - Buy (KRWs in):  all four taken from the KRWs input — platform →
///                           treasury, royalty → creator, burn → burnBuffer, lp
///                           stays in reserve (absorbs rounding → invariant 10).
///         - Sell (token in): burn burns from the token input, lp stays in
///                           reserve (both input-side); platform + royalty are
///                           carved from the KRWs output (treasury/creator in
///                           KRWs), and the caller receives the remainder.
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
    /// @notice Platform swap cut sent to treasury — ALWAYS in KRWs (invariant 17).
    event PlatformFeePaid(address indexed treasury, uint256 amount);

    uint16 public constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    MembershipToken public immutable membershipToken;
    IERC20 public immutable krw;
    address public immutable creator;
    /// @notice Tiered fee source — supplies the platform + LP swap shares live
    ///         (not overridable). Royalty/burn are per-pool (below).
    IFeeRouter public immutable feeRouter;
    /// @notice Utility grade — selects the FeeRouter schedule.
    IFeeRouter.UtilityTier public immutable tier;
    /// @notice Burner registry (the MapaeFactory) consulted by swapForBurn.
    ///         address(0) means no registry → swapForBurn always reverts.
    address public immutable factory;
    /// @notice Per-pool creator royalty share (bps), snapshotted at creation (R2).
    uint16 public immutable royaltyBps;
    /// @notice Per-pool creator burn share (bps), snapshotted at creation (R2).
    uint16 public immutable burnBps;

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
        address factory_,
        uint16 royaltyBps_,
        uint16 burnBps_
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
        royaltyBps = royaltyBps_;
        burnBps = burnBps_;
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
    // Fee math (R1 — directional so royalty is ALWAYS paid in KRWs and the
    // platform treasury only ever receives KRWs; invariant 17)
    // ------------------------------------------------------------------

    /// @dev The four swap-fee bps for this pool. platform + lp come from the
    ///      FeeRouter live (not overridable); royalty + burn are the per-pool
    ///      snapshot (R2).
    function _bps() internal view returns (uint16 platformBps, uint16 lpBps) {
        IFeeRouter.TierFees memory f = feeRouter.getFees(tier);
        return (f.swapPlatformBps, f.swapLpBps);
    }

    /// @notice Buy membership tokens with KRWs. Fees are taken from the KRWs
    ///         input: platform → treasury, royalty → creator, burn → burnBuffer,
    ///         lp stays in reserve (absorbs the split's rounding remainder so the
    ///         four shares sum EXACTLY to the total fee — invariant 10). Works
    ///         during the transfer lock (pool is a lock-exempt sender).
    function swapKrwForToken(uint256 amountIn, uint256 minOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        krw.safeTransferFrom(msg.sender, address(this), amountIn);

        (uint16 platformBps, uint16 lpBps) = _bps();
        uint256 totalBps = uint256(platformBps) + royaltyBps + burnBps + lpBps;
        uint256 totalFee = amountIn * totalBps / BPS;
        uint256 platform = amountIn * platformBps / BPS;
        uint256 royalty = amountIn * royaltyBps / BPS;
        uint256 burnAmt = amountIn * burnBps / BPS;
        // lp = remainder → reserve (dust to LPs/fans); effectiveIn actually swaps.
        uint256 effectiveIn = amountIn - totalFee;

        amountOut = reserveToken * effectiveIn / (reserveKrw + effectiveIn);
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);
        if (amountOut >= reserveToken) revert InsufficientLiquidity();

        if (platform > 0) {
            krw.safeTransfer(feeRouter.platformTreasury(), platform);
            emit PlatformFeePaid(feeRouter.platformTreasury(), platform);
        }
        if (royalty > 0) krw.safeTransfer(creator, royalty); // royalty in KRWs
        if (burnAmt > 0) {
            burnBuffer += burnAmt;
            emit BurnBufferAccrued(burnAmt, burnBuffer);
        }
        reserveKrw += amountIn - platform - royalty - burnAmt; // lp + effectiveIn stay in reserve
        reserveToken -= amountOut;
        IERC20(address(membershipToken)).safeTransfer(to, amountOut);
        emit Swapped(msg.sender, to, true, amountIn, amountOut, royalty);
    }

    /// @notice Sell membership tokens for KRWs. burn + lp are taken from the
    ///         token INPUT (burn is burned immediately — Transfer → 0x0; lp stays
    ///         in reserve). platform + royalty are taken from the KRWs OUTPUT, so
    ///         royalty is paid in KRWs and the treasury never holds tokens
    ///         (invariant 17). The caller receives the output net of both.
    function swapTokenForKrw(uint256 amountIn, uint256 minOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        IERC20(address(membershipToken)).safeTransferFrom(msg.sender, address(this), amountIn);

        (uint16 platformBps, uint16 lpBps) = _bps();
        // Input-side fees (token): burn burns, lp stays in reserve.
        uint256 burnAmt = amountIn * burnBps / BPS;
        uint256 lpAmt = amountIn * lpBps / BPS;
        uint256 effectiveIn = amountIn - burnAmt - lpAmt;

        // Gross KRWs out of the curve, then carve the output-side fees.
        uint256 grossOut = reserveKrw * effectiveIn / (reserveToken + effectiveIn);
        uint256 platform = grossOut * platformBps / BPS;
        uint256 royalty = grossOut * royaltyBps / BPS;
        amountOut = grossOut - platform - royalty; // caller absorbs rounding dust
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);
        if (grossOut >= reserveKrw) revert InsufficientLiquidity();

        if (burnAmt > 0) {
            membershipToken.burn(burnAmt);
            emit TokensBurned(burnAmt);
        }
        if (platform > 0) {
            krw.safeTransfer(feeRouter.platformTreasury(), platform); // KRWs only
            emit PlatformFeePaid(feeRouter.platformTreasury(), platform);
        }
        if (royalty > 0) krw.safeTransfer(creator, royalty); // royalty in KRWs
        reserveToken += amountIn - burnAmt; // burn left; lp + effectiveIn stay
        reserveKrw -= grossOut; // full gross output leaves the reserve
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

    /// @notice Total swap fee in bps (platform+lp from FeeRouter, royalty+burn
    ///         per-pool). Buy path applies all four to the input; the sell path
    ///         splits them across input (burn+lp) and output (platform+royalty).
    function totalFeeBps() public view returns (uint16) {
        (uint16 platformBps, uint16 lpBps) = _bps();
        return platformBps + royaltyBps + burnBps + lpBps;
    }

    /// @notice Quote for a KRWs→token swap: all fees taken from the KRWs input.
    function getTokenOut(uint256 krwIn) external view returns (uint256) {
        uint256 effectiveIn = krwIn - (krwIn * totalFeeBps() / BPS);
        return reserveToken * effectiveIn / (reserveKrw + effectiveIn);
    }

    /// @notice Quote for a token→KRWs swap, net of fees the caller actually pays:
    ///         burn+lp come off the token input, platform+royalty off the KRWs
    ///         output. Returns the KRWs the caller receives.
    function getKrwOut(uint256 tokenIn) external view returns (uint256) {
        (uint16 platformBps, uint16 lpBps) = _bps();
        uint256 effectiveIn = tokenIn - (tokenIn * burnBps / BPS) - (tokenIn * lpBps / BPS);
        uint256 grossOut = reserveKrw * effectiveIn / (reserveToken + effectiveIn);
        return grossOut - (grossOut * platformBps / BPS) - (grossOut * royaltyBps / BPS);
    }
}
