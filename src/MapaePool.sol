// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MembershipToken} from "./MembershipToken.sol";

/// @title MapaePool
/// @notice Minimal constant-product AMM for a single MembershipToken/KRWs pair
///         (D7 — deliberately NOT a UniV2 fork: our 2% split fee cannot be
///         expressed there, and a ~300-line pool is auditable).
///
///         Fee on every swap, taken from the input amount:
///         - creator royalty (royaltyBps, 0–150): input asset sent to the creator
///         - burn share (burnBps, 0–100): membership-token input burns
///           immediately; KRWs input accrues in `burnBuffer` until anyone calls
///           convertAndBurn() — a mini buyback that buys from this pool and
///           burns the output (partial BuybackVault narrative)
///         - LP share (50 fixed): stays in reserves, UniV2-style → k grows
///
///         LP shares are a plain ERC-20. The offering seeds initial liquidity
///         at settle and mints the LP shares straight to 0xdEaD (D8): permanent
///         lock is visible to anyone on the explorer — invariant 7.
contract MapaePool is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error ZeroAddress();
    error InsufficientLiquidity();
    error InsufficientOutput(uint256 amountOut, uint256 minOut);
    error EmptyBurnBuffer();
    error InvalidFeeConfig();

    event Swapped(
        address indexed sender, address indexed to, bool krwIn, uint256 amountIn, uint256 amountOut, uint256 royalty
    );
    event LiquidityMinted(address indexed to, uint256 tokenAmount, uint256 krwAmount, uint256 liquidity);
    event LiquidityBurned(address indexed to, uint256 tokenAmount, uint256 krwAmount, uint256 liquidity);
    event TokensBurned(uint256 amount);
    event BurnBufferAccrued(uint256 amount, uint256 total);
    event ConvertedAndBurned(address indexed caller, uint256 krwIn, uint256 tokensBurned);

    uint16 public constant LP_FEE_BPS = 50;
    uint16 public constant MAX_ROYALTY_BPS = 150;
    uint16 public constant MAX_BURN_BPS = 100;
    uint16 public constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    MembershipToken public immutable membershipToken;
    IERC20 public immutable krw;
    address public immutable creator;
    uint16 public immutable royaltyBps;
    uint16 public immutable burnBps;

    uint256 public reserveToken;
    uint256 public reserveKrw;
    /// @notice KRWs accrued from burn fees, spendable ONLY via convertAndBurn
    ///         (invariant: no other outflow path exists).
    uint256 public burnBuffer;

    constructor(MembershipToken membershipToken_, IERC20 krw_, address creator_, uint16 royaltyBps_, uint16 burnBps_)
        ERC20("MAPAE LP", "MAPAE-LP")
    {
        if (address(membershipToken_) == address(0) || address(krw_) == address(0) || creator_ == address(0)) {
            revert ZeroAddress();
        }
        if (royaltyBps_ > MAX_ROYALTY_BPS || burnBps_ > MAX_BURN_BPS) revert InvalidFeeConfig();
        membershipToken = membershipToken_;
        krw = krw_;
        creator = creator_;
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
    // Swaps (2% split fee on input)
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

        uint256 royalty = amountIn * royaltyBps / BPS;
        uint256 burnShare = amountIn * burnBps / BPS;
        uint256 effectiveIn = amountIn - royalty - burnShare - (amountIn * LP_FEE_BPS / BPS);

        amountOut = reserveToken * effectiveIn / (reserveKrw + effectiveIn);
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);
        if (amountOut >= reserveToken) revert InsufficientLiquidity();

        if (royalty > 0) krw.safeTransfer(creator, royalty);
        if (burnShare > 0) {
            burnBuffer += burnShare;
            emit BurnBufferAccrued(burnShare, burnBuffer);
        }
        reserveKrw += amountIn - royalty - burnShare; // LP fee stays in reserve
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

        uint256 royalty = amountIn * royaltyBps / BPS;
        uint256 burnShare = amountIn * burnBps / BPS;
        uint256 effectiveIn = amountIn - royalty - burnShare - (amountIn * LP_FEE_BPS / BPS);

        amountOut = reserveKrw * effectiveIn / (reserveToken + effectiveIn);
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);
        if (amountOut >= reserveKrw) revert InsufficientLiquidity();

        if (royalty > 0) IERC20(address(membershipToken)).safeTransfer(creator, royalty);
        if (burnShare > 0) {
            membershipToken.burn(burnShare);
            emit TokensBurned(burnShare);
        }
        reserveToken += amountIn - royalty - burnShare; // LP fee stays in reserve
        reserveKrw -= amountOut;
        krw.safeTransfer(to, amountOut);
        emit Swapped(msg.sender, to, false, amountIn, amountOut, royalty);
    }

    /// @notice Mini buyback (D7): anyone may spend the accrued burn buffer to
    ///         buy membership tokens from this pool and burn all of them.
    ///         The buffer has NO other outflow path (invariant tested).
    /// @param minOut Slippage guard for the buyback swap.
    function convertAndBurn(uint256 minOut) external nonReentrant returns (uint256 tokensBurned) {
        uint256 amountIn = burnBuffer;
        if (amountIn == 0) revert EmptyBurnBuffer();
        burnBuffer = 0;

        tokensBurned = reserveToken * amountIn / (reserveKrw + amountIn);
        if (tokensBurned < minOut) revert InsufficientOutput(tokensBurned, minOut);
        if (tokensBurned >= reserveToken) revert InsufficientLiquidity();

        reserveKrw += amountIn;
        reserveToken -= tokensBurned;
        membershipToken.burn(tokensBurned);
        emit ConvertedAndBurned(msg.sender, amountIn, tokensBurned);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Spot price: KRWs wei per 1e18 token wei.
    function spotPrice() external view returns (uint256) {
        if (reserveToken == 0) return 0;
        return reserveKrw * WAD / reserveToken;
    }

    /// @notice Total swap fee in bps (royalty + burn + LP).
    function totalFeeBps() external view returns (uint16) {
        return royaltyBps + burnBps + LP_FEE_BPS;
    }

    /// @notice Quote for a KRWs→token swap after all fees.
    function getTokenOut(uint256 krwIn) external view returns (uint256) {
        uint256 effectiveIn = krwIn - (krwIn * (royaltyBps + burnBps + LP_FEE_BPS) / BPS);
        return reserveToken * effectiveIn / (reserveKrw + effectiveIn);
    }

    /// @notice Quote for a token→KRWs swap after all fees.
    function getKrwOut(uint256 tokenIn) external view returns (uint256) {
        uint256 effectiveIn = tokenIn - (tokenIn * (royaltyBps + burnBps + LP_FEE_BPS) / BPS);
        return reserveKrw * effectiveIn / (reserveToken + effectiveIn);
    }
}
