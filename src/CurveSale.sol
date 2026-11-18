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
///         (CurvePresets geometry, CurveMath pricing), a real-name priority window, fee accrual and
///         same-tx graduation into a MapaePool when the curve sells out.
///
///         Lifecycle
///         - Construction: snapshot the FeeRouter curve fee split, deploy the token with a
///           100-year transfer lock (holders can only trade with this contract — decision A),
///           mint TOTAL_SUPPLY to self (mint authority burned).
///         - Trading (v3.1): buys are limited to Dojang-verified wallets until priorityUntil
///           (fail-closed), then open to anyone; sells are open to any holder.
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
        /// @notice Seconds after creation during which only Dojang-verified wallets may buy (v3.1).
        uint32 priorityWindow;
        /// @notice v3.5: most tokens a wallet may hold after a buy inside the priority window.
        uint256 priorityMaxHolding;
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
    error NotFactory(address caller);
    /// @notice v3.5: a buy inside the priority window would leave the recipient above the cap.
    error PriorityHoldingExceeded(uint256 balanceAfter, uint256 maxHolding);

    event Buy(
        address indexed trader,
        bool isDev,
        bool verified,
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
    /// @notice Deployer (CurveFactory) — the only caller allowed to use buyFor.
    address public immutable factory;

    /// @notice End of the real-name priority window (creation time + priorityWindow). Before it,
    ///         only Dojang-verified wallets may buy; from it on (inclusive) anyone may buy.
    uint64 public immutable priorityUntil;
    /// @notice v3.5: during the priority window no wallet (the Dev included) may hold more than
    ///         this many tokens after a buy; the whole buy reverts (nothing is trimmed). After the
    ///         window and on sells there is no cap. Fixed at creation from the factory.
    uint256 public immutable priorityMaxHolding;

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

    /// @notice True once the wallet has been counted in verifiedBuyerCount, i.e. it made a buy
    ///         while Dojang-verified. Buys made while unverified do not set it, so a wallet that
    ///         first bought unverified and later buys verified is counted exactly once then.
    mapping(address account => bool) public countedVerifiedBuyer;
    /// @notice Distinct wallets that bought while Dojang-verified, dev excluded. Monotonic.
    uint32 public verifiedBuyerCount;

    constructor(InitParams memory p) {
        if (
            address(p.quote) == address(0) || address(p.dojang) == address(0) || p.dev == address(0)
                || address(p.feeRouter) == address(0) || address(p.poolFactory) == address(0)
                || p.mapaeFactory == address(0)
        ) revert ZeroAddress();
        if (p.virtualQuote == 0 || p.priorityMaxHolding == 0) revert InvalidConfig();

        quote = p.quote;
        dojang = p.dojang;
        dev = p.dev;
        feeRouter = p.feeRouter;
        poolFactory = p.poolFactory;
        mapaeFactory = p.mapaeFactory;
        virtualQuote = p.virtualQuote;
        factory = msg.sender;
        priorityUntil = uint64(block.timestamp + p.priorityWindow);
        priorityMaxHolding = p.priorityMaxHolding;

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
        return _buy(msg.sender, msg.sender, quoteIn, minTokensOut);
    }

    /// @notice Factory-driven buy (dev first buy at creation, native ETH buys). Quote is pulled from
    ///         the factory, tokens go to `trader`; the priority gate, buyer count and isDev use `trader`.
    function buyFor(address trader, uint256 quoteIn, uint256 minTokensOut)
        external
        nonReentrant
        returns (uint256 tokensOut, uint256 quoteSpent)
    {
        if (msg.sender != factory) revert NotFactory(msg.sender);
        return _buy(trader, msg.sender, quoteIn, minTokensOut);
    }

    function _buy(address trader, address payer, uint256 quoteIn, uint256 minTokensOut)
        internal
        returns (uint256 tokensOut, uint256 quoteSpent)
    {
        if (graduated) revert AlreadyGraduated();
        bool priority = _inPriority();
        bool verified = _buyerVerified(trader, priority);
        BuyQuote memory q = _quoteBuy(quoteIn);
        if (q.tokensOut == 0) revert ZeroTokensOut();
        if (q.tokensOut < minTokensOut) revert InsufficientOutput(q.tokensOut, minTokensOut);

        if (q.quoteSpent > 0) quote.safeTransferFrom(payer, address(this), q.quoteSpent);
        r = q.nextR;
        s = q.nextS;
        platformAccrued += q.platformFee;
        devAccrued += q.devFee;
        lpSeedAccrued += q.lpSeedFee;

        bool isDev = trader == dev;
        if (verified && !isDev && !countedVerifiedBuyer[trader]) {
            countedVerifiedBuyer[trader] = true;
            uint32 c = ++verifiedBuyerCount;
            emit VerifiedBuyerCounted(trader, c);
        }

        IERC20(address(_token)).safeTransfer(trader, q.tokensOut);
        // v3.5: the recipient's balance after the buy (before graduation a wallet can only get
        // tokens from this curve, so this is its net bought amount)
        if (priority) {
            uint256 bal = IERC20(address(_token)).balanceOf(trader);
            if (bal > priorityMaxHolding) revert PriorityHoldingExceeded(bal, priorityMaxHolding);
        }
        emit Buy(trader, isDev, verified, q.quoteSpent, q.tokensOut, q.platformFee, q.devFee, q.lpSeedFee, r, s);

        if (q.graduates) _graduate();
        return (q.tokensOut, q.quoteSpent);
    }

    /// @notice Sell tokens back to the curve. Pays gross − fee out of r. Open to any holder (v3.1).
    function sell(uint256 tokenIn, uint256 minQuoteOut) external nonReentrant returns (uint256 quoteOut) {
        if (graduated) revert AlreadyGraduated();
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

    /// @notice True while only Dojang-verified wallets may buy (block.timestamp < priorityUntil).
    function inPriorityWindow() external view returns (bool) {
        return _inPriority();
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

    /// @notice Utility grade of the curve token: always L0 (ITierSource-compatible), so L1+
    ///         modules such as BuybackVault reject curve tokens explicitly (TierNotAllowed).
    function tier() external pure returns (IFeeRouter.UtilityTier) {
        return IFeeRouter.UtilityTier.L0;
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

    /// @dev Real-name status of a buyer, enforcing the priority window.
    ///      Inside the window the check is fail-closed: an unverified buyer reverts NotVerified and
    ///      a reverting Dojang reverts the buy (no try/catch). After the window anyone may buy; the
    ///      status is only looked up for the verified-buyer count and the Buy event, so a reverting
    ///      Dojang reads as "not verified" instead of blocking the trade.
    function _buyerVerified(address trader, bool priority) internal view returns (bool) {
        if (priority) {
            if (!dojang.isVerified(trader)) revert NotVerified(trader);
            return true;
        }
        try dojang.isVerified(trader) returns (bool v) {
            return v;
        } catch {
            return false;
        }
    }

    /// @dev The one priority-window test, shared by the real-name gate and the holding cap.
    function _inPriority() internal view returns (bool) {
        return block.timestamp < priorityUntil;
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
            _token, quote, dev, feeRouter, IFeeRouter.UtilityTier.L0, mapaeFactory, CurvePresets.SWAP_FEE_DEV_BPS, 0
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
