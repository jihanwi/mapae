// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IDojang} from "./interfaces/IDojang.sol";
import {IOffering} from "./interfaces/IOffering.sol";
import {IPrimaryMarket} from "./interfaces/IPrimaryMarket.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";
import {IBurnerRegistry} from "./interfaces/IBurnerRegistry.sol";
import {Offering} from "./Offering.sol";
import {OfferingDeployer} from "./OfferingDeployer.sol";
import {StackDeployer} from "./StackDeployer.sol";
import {MembershipToken} from "./MembershipToken.sol";
import {RedeemManager} from "./RedeemManager.sol";
import {MapaeVesting} from "./MapaeVesting.sol";
import {Sponsorship} from "./Sponsorship.sol";
import {PoolFactory} from "./PoolFactory.sol";
import {BuybackVault} from "./BuybackVault.sol";

/// @title MapaeFactory
/// @notice Deploys and wires the per-creator stack: MembershipToken (via
///         Offering) + Vesting + RedeemManager + Sponsorship, and is the
///         canonical registry the whole system gates on — tokenTier() and
///         isBurner() (the swapForBurn allow-list).
///
///         Rules enforced here:
///         - Caller must hold a Dojang Verified Address (fail-closed) and is
///           ALWAYS the creator — no proxy issuance.
///         - Live-token cap by tier ([Q4]): L1/L2 = 1 live, L0 = 3 live, where
///           "live" = a non-failed offering. Failed raises don't consume a slot.
///         - L1/L2 keep the platform guide bands (P/R/L); L0 skips them
///           (lightweight curation — Dojang + tokenomics bands + raise floor).
///         Duration, tokenomics bands and share feasibility are enforced by the
///         Offering constructor per tier and propagate from here.
contract MapaeFactory is Ownable, IBurnerRegistry {
    error NotVerifiedCreator(address account);
    error ActiveOfferingExists(address creator, address offering);
    error PriceOutOfBand(uint256 price);
    error RaiseOutOfBand(uint256 raiseTarget);
    error WalletLimitOutOfBand(uint256 walletLimit);
    error InvalidGuide();
    error ZeroAddress();
    error ZeroCurveVirtualQuote();
    error QuoteAlreadyRegistered(address quote);
    error QuoteNotRegistered(address quote);

    /// @notice Platform token cut for premium tiers (L1/L2). L0 is forced to 0.
    uint16 public constant PREMIUM_PLATFORM_TOKEN_BPS = 500;

    /// @notice Platform-side allocation recipients wired into every offering.
    struct FeeRecipients {
        address platform;
        address reserve;
    }

    /// @notice Platform guide bands for creator-chosen parameters (L1/L2 only).
    struct Guide {
        uint256 minPrice;
        uint256 maxPrice;
        uint256 minRaise;
        uint256 maxRaise;
        uint16 minWalletLimitBps;
        uint16 maxWalletLimitBps;
    }

    /// @notice Creator-facing parameters for createOffering. The creator, the
    ///         platform owner and all recipients are filled in by the factory.
    struct CreateParams {
        string tokenName;
        string tokenSymbol;
        uint256 price;
        uint256 raiseTarget;
        uint256 deadline;
        uint256 walletLimit;
        uint256 minCommit;
        uint16 fBps;
        uint16 cBps;
        uint16 creatorTokenBps;
        uint16 swapRoyaltyBps; // per-pool creator royalty (tier band; default = FeeRouter tier table)
        uint16 swapBurnBps; // per-pool creator burn (tier band; default = FeeRouter tier table)
        IFeeRouter.UtilityTier tier; // utility grade (gates + fee schedule + bands)
        IOffering.RefundMode refundMode;
        uint256 transferLockDuration;
        uint16 holdingCapBps;
        uint16 sponsorBurnBps; // sponsorship burn share X (0–2000, 기본 1000)
        uint64 vestingDuration; // tier-dependent band
        uint64 vestingCliff; // tier-dependent band
    }

    /// @notice Quote asset entry for CurveSale (C1). `curveVirtualQuote` (raw units of the quote)
    ///         and `decimals` are written once at registration and are immutable thereafter; only
    ///         `enabled` (whether NEW curves may open with this quote) can change.
    struct QuoteConfig {
        bool registered;
        bool enabled;
        uint8 decimals;
        uint256 curveVirtualQuote;
    }

    event QuoteAllowed(address indexed quote, uint8 decimals, uint256 curveVirtualQuote);
    event QuoteEnabledSet(address indexed quote, bool enabled);

    event OfferingCreated(
        address indexed creator,
        address indexed offering,
        address indexed token,
        address redeemManager,
        address vesting,
        address sponsorship
    );
    event GuideUpdated(
        uint256 minPrice,
        uint256 maxPrice,
        uint256 minRaise,
        uint256 maxRaise,
        uint16 minWalletLimitBps,
        uint16 maxWalletLimitBps
    );

    IDojang public immutable dojang;
    IERC20 public immutable paymentToken;
    /// @notice Settle authority wired into every offering (Ownable owner).
    address public immutable platformOwner;
    /// @notice Holds the Offering creation bytecode (EIP-170 size split).
    OfferingDeployer public immutable offeringDeployer;
    /// @notice Holds the RedeemManager/Vesting/Sponsorship creation bytecode.
    StackDeployer public immutable stackDeployer;
    /// @notice Global AMM pool factory (one pool per token, D7/D8).
    PoolFactory public immutable poolFactory;
    /// @notice Tiered fee source shared by every offering/pool/redeem.
    IFeeRouter public immutable feeRouter;
    /// @notice Global buyback vault (registered as a burner below).
    BuybackVault public immutable buybackVault;
    /// @notice Hard raise floor forwarded to every offering (invariant 5).
    uint256 public immutable minRaise;

    /// @notice Sponsorship burn-buy slippage tolerance vs spot (§8-B ②).
    uint16 public constant SPONSOR_MAX_SLIPPAGE_BPS = 500;

    FeeRecipients public feeRecipients;
    Guide public guide;

    address[] internal _allOfferings;
    mapping(address creator => address[] offerings) internal _offeringsByCreator;
    mapping(address offering => address redeemManager) public redeemManagerOf;
    mapping(address offering => address vesting) public vestingOf;
    mapping(address offering => address sponsorship) public sponsorshipOf;
    /// @notice Utility grade of a deployed membership token — the gate reference
    ///         for every module (invariant 8 etc.). Set once at creation.
    mapping(address token => IFeeRouter.UtilityTier) public tokenTier;
    /// @inheritdoc IBurnerRegistry
    mapping(address account => bool) public isBurner;

    /// @dev Quote registry for CurveSale (C1). Fixed-price offerings always settle in paymentToken.
    mapping(address quote => QuoteConfig) internal _quoteConfig;
    address[] internal _allQuotes;

    constructor(
        IDojang dojang_,
        IERC20 paymentToken_,
        address platformOwner_,
        PoolFactory poolFactory_,
        IFeeRouter feeRouter_,
        BuybackVault buybackVault_,
        uint256 minRaise_,
        FeeRecipients memory feeRecipients_,
        Guide memory guide_
    ) Ownable(platformOwner_) {
        if (
            address(dojang_) == address(0) || address(paymentToken_) == address(0)
                || address(poolFactory_) == address(0) || address(feeRouter_) == address(0)
                || address(buybackVault_) == address(0) || feeRecipients_.platform == address(0)
                || feeRecipients_.reserve == address(0)
        ) revert ZeroAddress();
        if (minRaise_ == 0) revert InvalidGuide();
        dojang = dojang_;
        paymentToken = paymentToken_;
        platformOwner = platformOwner_;
        poolFactory = poolFactory_;
        feeRouter = feeRouter_;
        buybackVault = buybackVault_;
        minRaise = minRaise_;
        offeringDeployer = new OfferingDeployer();
        stackDeployer = new StackDeployer();
        feeRecipients = feeRecipients_;
        // The global vault is a permanent burner (swapForBurn allow-list).
        isBurner[address(buybackVault_)] = true;
        _setGuide(guide_);
    }

    /// @notice Update the platform guide bands (simple config — the deployed
    ///         contracts themselves remain non-upgradeable).
    function setGuide(Guide calldata guide_) external onlyOwner {
        _setGuide(guide_);
    }

    function _setGuide(Guide memory g) internal {
        if (g.minPrice == 0 || g.minPrice > g.maxPrice) revert InvalidGuide();
        if (g.minRaise == 0 || g.minRaise > g.maxRaise) revert InvalidGuide();
        if (g.minWalletLimitBps == 0 || g.minWalletLimitBps > g.maxWalletLimitBps) revert InvalidGuide();
        guide = g;
        emit GuideUpdated(g.minPrice, g.maxPrice, g.minRaise, g.maxRaise, g.minWalletLimitBps, g.maxWalletLimitBps);
    }

    /// @notice Deploy a new offering stack for the caller (the creator).
    function createOffering(CreateParams calldata cp)
        external
        returns (address offering, address token, address redeemManager)
    {
        // Fail-closed: a reverting or false-returning Dojang lookup rejects the call.
        if (!dojang.isVerified(msg.sender)) revert NotVerifiedCreator(msg.sender);

        // Live-token cap by tier ([Q4]). A "failed" offering (refunding + zero
        // supply) does not count — retrying a failed raise is intended.
        _enforceLiveCap(_offeringsByCreator[msg.sender], cp.tier);
        _checkGuide(cp);

        MapaeVesting vesting =
            stackDeployer.deployVesting(msg.sender, uint64(cp.deadline), cp.vestingDuration, cp.vestingCliff, cp.tier);
        Offering o = offeringDeployer.deploy(_buildParams(cp, address(vesting)));
        redeemManager = _wire(o, cp, address(vesting));
        return (address(o), address(o.token()), redeemManager);
    }

    /// @dev L1/L2 keep the guide bands; L0 skips them (lightweight curation).
    function _checkGuide(CreateParams calldata cp) internal view {
        if (cp.tier == IFeeRouter.UtilityTier.L0) return;
        if (cp.price < guide.minPrice || cp.price > guide.maxPrice) revert PriceOutOfBand(cp.price);
        if (cp.raiseTarget < guide.minRaise || cp.raiseTarget > guide.maxRaise) revert RaiseOutOfBand(cp.raiseTarget);
        if (
            cp.walletLimit < cp.raiseTarget * guide.minWalletLimitBps / 10_000
                || cp.walletLimit > cp.raiseTarget * guide.maxWalletLimitBps / 10_000
        ) revert WalletLimitOutOfBand(cp.walletLimit);
    }

    /// @dev Deploy peripherals, record bookkeeping, register the tier + burner,
    ///      and emit. Split out of createOffering to stay under the stack limit.
    function _wire(Offering o, CreateParams calldata cp, address vesting) internal returns (address) {
        MembershipToken t = o.token();
        (RedeemManager rm, Sponsorship sp) = stackDeployer.deployPeripherals(
            t, paymentToken, msg.sender, cp.sponsorBurnBps, SPONSOR_MAX_SLIPPAGE_BPS, feeRouter, cp.tier, buybackVault
        );

        _allOfferings.push(address(o));
        _offeringsByCreator[msg.sender].push(address(o));
        redeemManagerOf[address(o)] = address(rm);
        vestingOf[address(o)] = vesting;
        sponsorshipOf[address(o)] = address(sp);
        tokenTier[address(t)] = cp.tier;
        // Each Sponsorship is a burner (swapForBurn allow-list).
        isBurner[address(sp)] = true;

        emit OfferingCreated(msg.sender, address(o), address(t), address(rm), vesting, address(sp));
        return address(rm);
    }

    /// @dev Live-token cap by SEPARATE buckets (R3): L0 and membership (L1+L2)
    ///      are counted independently so an L0 issuer is never blocked from an
    ///      L1 raise (L0→L1 upsell funnel). L0 create needs liveL0 < 3; L1/L2
    ///      create needs liveMembership == 0. Failed offerings (refunding + zero
    ///      supply) don't count in either bucket. Cross-holding is allowed.
    function _enforceLiveCap(address[] storage prior, IFeeRouter.UtilityTier tier) internal view {
        uint256 liveL0;
        uint256 liveMembership;
        for (uint256 i = 0; i < prior.length; i++) {
            IPrimaryMarket o = IPrimaryMarket(prior[i]);
            if (o.phase() == IPrimaryMarket.Phase.Refunding && o.token().totalSupply() == 0) continue; // failed
            if (tokenTier[address(o.token())] == IFeeRouter.UtilityTier.L0) liveL0++;
            else liveMembership++;
        }
        bool overCap = tier == IFeeRouter.UtilityTier.L0 ? liveL0 >= 3 : liveMembership >= 1;
        if (overCap) {
            revert ActiveOfferingExists(msg.sender, prior.length > 0 ? prior[prior.length - 1] : address(0));
        }
    }

    /// @dev Assemble OfferingParams. platformTokenBps is forced by tier
    ///      (L0 = 0 → invariant 4; L1/L2 = 5%). Split out to keep createOffering
    ///      under the stack-depth limit.
    function _buildParams(CreateParams calldata cp, address vesting)
        internal
        view
        returns (IOffering.OfferingParams memory p)
    {
        p.paymentToken = paymentToken;
        p.dojang = dojang;
        p.creator = msg.sender; // no proxy issuance
        p.platformOwner = platformOwner;
        p.tokenName = cp.tokenName;
        p.tokenSymbol = cp.tokenSymbol;
        p.price = cp.price;
        p.raiseTarget = cp.raiseTarget;
        p.minRaise = minRaise;
        p.deadline = cp.deadline;
        p.walletLimit = cp.walletLimit;
        p.minCommit = cp.minCommit;
        p.fBps = cp.fBps;
        p.cBps = cp.cBps;
        p.creatorTokenBps = cp.creatorTokenBps;
        p.platformTokenBps = cp.tier == IFeeRouter.UtilityTier.L0 ? 0 : PREMIUM_PLATFORM_TOKEN_BPS;
        p.swapRoyaltyBps = cp.swapRoyaltyBps;
        p.swapBurnBps = cp.swapBurnBps;
        p.refundMode = cp.refundMode;
        p.transferLockDuration = cp.transferLockDuration;
        p.holdingCapBps = cp.holdingCapBps;
        p.poolFactory = poolFactory;
        p.feeRouter = feeRouter;
        p.tier = cp.tier;
        p.mapaeFactory = address(this);
        p.recipients = IOffering.AllocationRecipients({
            creatorVesting: vesting, platform: feeRecipients.platform, reserve: feeRecipients.reserve
        });
    }

    function allOfferings() external view returns (address[] memory) {
        return _allOfferings;
    }

    function offeringsByCreator(address creator) external view returns (address[] memory) {
        return _offeringsByCreator[creator];
    }

    // ---------------------------------------------------------------------
    // Quote registry (C1) — consumed by CurveSale; FixedOffering stays on paymentToken
    // ---------------------------------------------------------------------

    /// @notice Register a quote asset with its curve virtual quote reserve (raw units).
    ///         One-shot: a registered quote can never be re-registered, so the price path
    ///         (curveVirtualQuote) cannot be changed after the fact by anyone.
    ///         Registered quotes start enabled.
    function allowQuote(IERC20 quote, uint256 curveVirtualQuote) external onlyOwner {
        address q = address(quote);
        if (q == address(0)) revert ZeroAddress();
        if (curveVirtualQuote == 0) revert ZeroCurveVirtualQuote();
        if (_quoteConfig[q].registered) revert QuoteAlreadyRegistered(q);
        uint8 dec = IERC20Metadata(q).decimals();
        _quoteConfig[q] =
            QuoteConfig({registered: true, enabled: true, decimals: dec, curveVirtualQuote: curveVirtualQuote});
        _allQuotes.push(q);
        emit QuoteAllowed(q, dec, curveVirtualQuote);
    }

    /// @notice Toggle whether NEW curves may open with `quote`. Existing curves and pools keep
    ///         their snapshot and are unaffected.
    function setQuoteEnabled(address quote, bool enabled) external onlyOwner {
        if (!_quoteConfig[quote].registered) revert QuoteNotRegistered(quote);
        _quoteConfig[quote].enabled = enabled;
        emit QuoteEnabledSet(quote, enabled);
    }

    function isQuoteAllowed(address quote) external view returns (bool) {
        QuoteConfig storage c = _quoteConfig[quote];
        return c.registered && c.enabled;
    }

    function quoteConfig(address quote) external view returns (QuoteConfig memory) {
        return _quoteConfig[quote];
    }

    function allQuotes() external view returns (address[] memory) {
        return _allQuotes;
    }
}
