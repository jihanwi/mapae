// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IDojang} from "./interfaces/IDojang.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";
import {IPrimaryMarket} from "./interfaces/IPrimaryMarket.sol";
import {MembershipToken} from "./MembershipToken.sol";
import {MembershipTokenDeployer} from "./MembershipTokenDeployer.sol";
import {MapaePool} from "./MapaePool.sol";
import {PoolFactory} from "./PoolFactory.sol";
import {CurveMath} from "./lib/CurveMath.sol";
import {CurvePresets} from "./CurvePresets.sol";

/// @title CurveSale
/// @notice v3 L0 bonding-curve primary market (IPrimaryMarket). One standard curve format
///         (CurvePresets geometry, CurveMath pricing), Dojang-gated trading, fee accrual and
///         same-tx graduation into a MapaePool when the curve sells out.
///
///         Lifecycle
///         - Construction: snapshot the FeeRouter curve fee split, deploy the token with a
///           100-year transfer lock (holders can only trade with this contract — decision A),
///           mint TOTAL_SUPPLY to self (mint authority burned).
///         - Trading: buy / sell against the curve, real-name wallets only (fail-closed).
///         - Graduation (the buy that reaches CURVE_SUPPLY): create the L0 pool, seed it with
///           DEX_SUPPLY tokens and r + lpSeedAccrued quote, LP to 0xdEaD, end the token lock.
///
///         Fee charge (buy): the curve price is computed on net = quoteIn − floor(quoteIn·t/1e4).
///         The buyer pays exactly P = min(quoteIn, ceil(quoteUsed·1e4/(1e4 − t))), fee = P − quoteUsed,
///         platform = floor(P·pb/1e4), dev = floor(P·db/1e4), lpSeed = remainder.
///         Sell: gross = curve output, fee = floor(gross·t/1e4) split the same way on gross,
///         seller receives gross − fee. Payouts come only out of r; accrued fees are never touched.
///
///         Accounting invariant (pre-graduation): quote.balanceOf(this) == r + devAccrued +
///         platformAccrued + lpSeedAccrued and token.balanceOf(this) == TOTAL_SUPPLY − s.
///         No path sends the issued token to the treasury or the dev as a fee.
///
///         Non-upgradeable. Out of scope here (factory ticket): dev first buy, curveEnabled flag,
///         quote whitelist checks.
contract CurveSale is IPrimaryMarket, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types / errors / events
    // ---------------------------------------------------------------------

    struct InitParams {
        IERC20 quote;
        IDojang dojang;
        address dev;
        IFeeRouter feeRouter;
        PoolFactory poolFactory;
        address mapaeFactory;
        string tokenName;
        string tokenSymbol;
        uint256 virtualQuote;
    }

    struct BuyQuote {
        uint256 tokensOut;
        uint256 quoteSpent;
        uint256 refund;
        uint256 platformFee;
        uint256 devFee;
        uint256 lpSeedFee;
        uint256 nextR;
        uint256 nextS;
        bool graduates;
    }

    struct SellQuote {
        uint256 quoteOut;
        uint256 platformFee;
        uint256 devFee;
        uint256 lpSeedFee;
        uint256 nextR;
        uint256 nextS;
    }

    error ZeroAddress();
    error InvalidConfig();
    error NotVerified(address account);
    error AlreadyGraduated();
    error ZeroAmount();
    error ZeroTokensOut();
    error InsufficientOutput(uint256 out, uint256 minOut);
    error NotDev(address caller);

    event Buy(
        address indexed trader,
        bool isDev,
        uint256 quoteSpent,
        uint256 tokensOut,
        uint256 platformFee,
        uint256 devFee,
        uint256 lpSeedFee,
        uint256 r,
        uint256 s
    );
    event Sell(
        address indexed trader,
        bool isDev,
        uint256 tokenIn,
        uint256 quoteOut,
        uint256 platformFee,
        uint256 devFee,
        uint256 lpSeedFee,
        uint256 r,
        uint256 s
    );
    event VerifiedBuyerCounted(address indexed buyer, uint32 count);
    event Graduated(address indexed pool, uint256 tokenSeed, uint256 quoteSeed, uint256 lpShares);
    event DevFeesClaimed(address indexed dev, uint256 amount);
    event PlatformFeesSwept(address indexed treasury, uint256 amount);

    // ---------------------------------------------------------------------
    // Constants / immutables
    // ---------------------------------------------------------------------

    uint16 public constant BPS = 10_000;
    /// @notice Effectively "until graduation": the lock is ended by endTransferLock() at graduation.
    uint256 public constant CURVE_LOCK_DURATION = 100 * 365 days;

    MembershipToken internal immutable _token;
    IERC20 public immutable quote;
    IDojang public immutable dojang;
    address public immutable dev;
    IFeeRouter public immutable feeRouter;
    PoolFactory public immutable poolFactory;
    address public immutable mapaeFactory;
    uint256 public immutable virtualQuote;

    /// @notice Curve fee split snapshotted from FeeRouter at construction (bps of trade size).
    uint16 public immutable platformBps;
    uint16 public immutable devBps;
    uint16 public immutable lpSeedBps;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice Real quote reserve backing the curve (CurveMath r). Zero after graduation.
    uint256 public r;
    /// @notice Tokens sold along the curve (CurveMath s).
    uint256 public s;
    uint256 public devAccrued;
    uint256 public platformAccrued;
    uint256 public lpSeedAccrued;
    bool public graduated;
    MapaePool public pool;
    /// @notice r at the moment of graduation (moved into the pool together with lpSeedAccrued).
    uint256 public graduationReserve;

    mapping(address account => bool) public hasBought;
    /// @notice Distinct real-name buyers, dev excluded. Monotonic.
    uint32 public verifiedBuyerCount;

    constructor(InitParams memory p) {
        if (
            address(p.quote) == address(0) || address(p.dojang) == address(0) || p.dev == address(0)
                || address(p.feeRouter) == address(0) || address(p.poolFactory) == address(0)
                || p.mapaeFactory == address(0)
        ) revert ZeroAddress();
        if (p.virtualQuote == 0) revert InvalidConfig();

        quote = p.quote;
        dojang = p.dojang;
        dev = p.dev;
        feeRouter = p.feeRouter;
        poolFactory = p.poolFactory;
        mapaeFactory = p.mapaeFactory;
        virtualQuote = p.virtualQuote;

        IFeeRouter.CurveFees memory f = p.feeRouter.getCurveFees();
        if (uint256(f.platformBps) + f.devBps + f.lpSeedBps >= BPS) revert InvalidConfig();
        platformBps = f.platformBps;
        devBps = f.devBps;
        lpSeedBps = f.lpSeedBps;

        MembershipToken t = MembershipTokenDeployer.deploy(
            p.tokenName, p.tokenSymbol, address(this), CURVE_LOCK_DURATION, 0, new address[](0)
        );
        _token = t;
        address[] memory to = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        to[0] = address(this);
        amounts[0] = CurvePresets.TOTAL_SUPPLY;
        t.mintAllocations(to, amounts);
    }

    // ---------------------------------------------------------------------
    // Trading
    // ---------------------------------------------------------------------

    /// @notice Buy with a quote budget. Pulls exactly quoteSpent (≤ quoteIn); tokens go to msg.sender.
    function buy(uint256 quoteIn, uint256 minTokensOut)
        external
        nonReentrant
        returns (uint256 tokensOut, uint256 quoteSpent)
    {
        _gate();
        BuyQuote memory q = _quoteBuy(quoteIn);
        if (q.tokensOut == 0) revert ZeroTokensOut();
        if (q.tokensOut < minTokensOut) revert InsufficientOutput(q.tokensOut, minTokensOut);

        if (q.quoteSpent > 0) quote.safeTransferFrom(msg.sender, address(this), q.quoteSpent);
        r = q.nextR;
        s = q.nextS;
        platformAccrued += q.platformFee;
        devAccrued += q.devFee;
        lpSeedAccrued += q.lpSeedFee;

        bool isDev = msg.sender == dev;
        if (!hasBought[msg.sender]) {
            hasBought[msg.sender] = true;
            if (!isDev) {
                uint32 c = ++verifiedBuyerCount;
                emit VerifiedBuyerCounted(msg.sender, c);
            }
        }

        IERC20(address(_token)).safeTransfer(msg.sender, q.tokensOut);
        emit Buy(msg.sender, isDev, q.quoteSpent, q.tokensOut, q.platformFee, q.devFee, q.lpSeedFee, r, s);

        if (q.graduates) _graduate();
        return (q.tokensOut, q.quoteSpent);
    }

    /// @notice Sell tokens back to the curve. Pays gross − fee out of r.
    function sell(uint256 tokenIn, uint256 minQuoteOut) external nonReentrant returns (uint256 quoteOut) {
        _gate();
        if (tokenIn == 0) revert ZeroAmount();
        SellQuote memory q = _quoteSell(tokenIn);
        if (q.quoteOut < minQuoteOut) revert InsufficientOutput(q.quoteOut, minQuoteOut);

        IERC20(address(_token)).safeTransferFrom(msg.sender, address(this), tokenIn);
        r = q.nextR;
        s = q.nextS;
        platformAccrued += q.platformFee;
        devAccrued += q.devFee;
        lpSeedAccrued += q.lpSeedFee;

        if (q.quoteOut > 0) quote.safeTransfer(msg.sender, q.quoteOut);
        emit Sell(msg.sender, msg.sender == dev, tokenIn, q.quoteOut, q.platformFee, q.devFee, q.lpSeedFee, r, s);
        return q.quoteOut;
    }

    // ---------------------------------------------------------------------
    // Fees
    // ---------------------------------------------------------------------

    /// @notice Dev royalty withdrawal (quote only). Works before and after graduation.
    function claimDevFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != dev) revert NotDev(msg.sender);
        amount = devAccrued;
        devAccrued = 0;
        if (amount > 0) quote.safeTransfer(dev, amount);
        emit DevFeesClaimed(dev, amount);
    }

    /// @notice Permissionless sweep of the platform fee (quote only) to the FeeRouter treasury.
    function sweepPlatformFees() external nonReentrant returns (uint256 amount) {
        amount = platformAccrued;
        platformAccrued = 0;
        address treasury = feeRouter.platformTreasury();
        if (amount > 0) quote.safeTransfer(treasury, amount);
        emit PlatformFeesSwept(treasury, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Exact preview of buy(quoteIn) (wei-identical). Reverts after graduation.
    function quoteBuy(uint256 quoteIn) external view returns (BuyQuote memory) {
        if (graduated) revert AlreadyGraduated();
        return _quoteBuy(quoteIn);
    }

    /// @notice Exact preview of sell(tokenIn) (wei-identical). Reverts after graduation.
    function quoteSell(uint256 tokenIn) external view returns (SellQuote memory) {
        if (graduated) revert AlreadyGraduated();
        return _quoteSell(tokenIn);
    }

    /// @notice Curve spot price as (numerator, denominator) in raw quote per raw token.
    function spotPrice() external view returns (uint256 num, uint256 den) {
        return CurveMath.spotPrice(_params(), r, s);
    }

    /// @inheritdoc IPrimaryMarket
    function token() external view returns (MembershipToken) {
        return _token;
    }

    /// @inheritdoc IPrimaryMarket
    function settlementToken() external view returns (IERC20) {
        return quote;
    }

    /// @inheritdoc IPrimaryMarket
    function phase() external view returns (Phase) {
        return graduated ? Phase.Settled : Phase.Open;
    }

    function totalFeeBps() public view returns (uint16) {
        return platformBps + devBps + lpSeedBps;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _params() internal view returns (CurveMath.Params memory) {
        return CurveMath.Params({
            vQuote: virtualQuote, vToken: CurvePresets.VIRTUAL_TOKEN_RESERVE, saleSupply: CurvePresets.CURVE_SUPPLY
        });
    }

    /// @dev Real-name gate + phase check shared by buy and sell (fail-closed: a reverting
    ///      Dojang reverts the trade).
    function _gate() internal view {
        if (graduated) revert AlreadyGraduated();
        if (!dojang.isVerified(msg.sender)) revert NotVerified(msg.sender);
    }

    function _quoteBuy(uint256 quoteIn) internal view returns (BuyQuote memory q) {
        uint256 t = totalFeeBps();
        uint256 net = quoteIn - quoteIn * t / BPS;
        (uint256 tokensOut, uint256 quoteUsed) = CurveMath.buyExactQuoteIn(_params(), r, s, net);
        uint256 charged = Math.mulDiv(quoteUsed, BPS, BPS - t, Math.Rounding.Ceil);
        uint256 spent = charged < quoteIn ? charged : quoteIn;
        uint256 fee = spent - quoteUsed;

        q.tokensOut = tokensOut;
        q.quoteSpent = spent;
        q.refund = quoteIn - spent;
        q.platformFee = spent * platformBps / BPS;
        q.devFee = spent * devBps / BPS;
        q.lpSeedFee = fee - q.platformFee - q.devFee;
        q.nextR = r + quoteUsed;
        q.nextS = s + tokensOut;
        q.graduates = q.nextS == CurvePresets.CURVE_SUPPLY;
    }

    function _quoteSell(uint256 tokenIn) internal view returns (SellQuote memory q) {
        uint256 gross = CurveMath.sellExactTokenIn(_params(), r, s, tokenIn);
        uint256 fee = gross * totalFeeBps() / BPS;
        q.platformFee = gross * platformBps / BPS;
        q.devFee = gross * devBps / BPS;
        q.lpSeedFee = fee - q.platformFee - q.devFee;
        q.quoteOut = gross - fee;
        q.nextR = r - gross;
        q.nextS = s - tokenIn;
    }

    /// @dev Same tx as the selling-out buy. Pool seed: DEX_SUPPLY tokens + (r + lpSeedAccrued) quote.
    function _graduate() internal {
        graduated = true;
        MapaePool p = poolFactory.createPool(
            _token,
            quote,
            dev,
            feeRouter,
            IFeeRouter.UtilityTier.L0,
            mapaeFactory,
            CurvePresets.SWAP_FEE_DEV_BPS,
            0,
            dojang
        );
        pool = p;
        _token.registerPool(address(p));

        uint256 quoteSeed = r + lpSeedAccrued;
        graduationReserve = r;
        r = 0;
        lpSeedAccrued = 0;

        IERC20(address(_token)).safeTransfer(address(p), CurvePresets.DEX_SUPPLY);
        quote.safeTransfer(address(p), quoteSeed);
        uint256 lpShares = p.mint(p.DEAD());
        _token.endTransferLock();
        emit Graduated(address(p), CurvePresets.DEX_SUPPLY, quoteSeed, lpShares);
    }
}
