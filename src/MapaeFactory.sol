// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "./interfaces/IDojang.sol";
import {IOffering} from "./interfaces/IOffering.sol";
import {Offering} from "./Offering.sol";
import {OfferingDeployer} from "./OfferingDeployer.sol";
import {StackDeployer} from "./StackDeployer.sol";
import {MembershipToken} from "./MembershipToken.sol";
import {RedeemManager} from "./RedeemManager.sol";
import {MapaeVesting} from "./MapaeVesting.sol";
import {Sponsorship} from "./Sponsorship.sol";
import {PoolFactory} from "./PoolFactory.sol";

/// @title MapaeFactory
/// @notice Deploys and wires the per-creator stack: MembershipToken (via
///         Offering) + Offering + RedeemManager.
///
///         Rules enforced here:
///         - Caller must hold a Dojang Verified Address (fail-closed) and is
///           ALWAYS the creator — no proxy issuance.
///         - One live token per creator: a new offering is allowed only if the
///           creator has none yet, or their latest offering ended in failure
///           (refunding with zero token supply). Failed raises don't consume
///           the slot — retrying is intended product behavior.
///         - P/R/L must sit inside the platform guide bands (owner-updatable
///           config; the contracts themselves stay non-upgradeable).
///         Duration, fBps/cBps/creatorTokenBps bands and share feasibility are
///         enforced by the Offering constructor and propagate from here.
contract MapaeFactory is Ownable {
    error NotVerifiedCreator(address account);
    error ActiveOfferingExists(address creator, address offering);
    error PriceOutOfBand(uint256 price);
    error RaiseOutOfBand(uint256 raiseTarget);
    error WalletLimitOutOfBand(uint256 walletLimit);
    error InvalidGuide();
    error ZeroAddress();

    /// @notice Platform-side allocation recipients wired into every offering.
    ///         (The LP share needs no recipient since M4: it seeds the AMM pool
    ///         at settle with LP shares locked at 0xdEaD.)
    struct FeeRecipients {
        address platform;
        address reserve;
    }

    /// @notice Platform guide bands for creator-chosen parameters.
    ///         Wallet limit L is validated as a fraction of R (bps).
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
        IOffering.RefundMode refundMode;
        uint256 transferLockDuration;
        uint16 holdingCapBps;
        uint16 swapRoyaltyBps; // pool royalty (0–150, 기본 100)
        uint16 swapBurnBps; // pool burn share (0–100, 기본 50)
        uint16 sponsorBurnBps; // sponsorship burn share X (0–2000, 기본 1000)
        uint64 vestingDuration; // 12–48mo (기본 36mo)
        uint64 vestingCliff; // ≥3mo (기본 6mo)
    }

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

    /// @notice Sponsorship burn-buy slippage tolerance vs spot (§8-B ②).
    uint16 public constant SPONSOR_MAX_SLIPPAGE_BPS = 500;

    FeeRecipients public feeRecipients;
    Guide public guide;

    address[] internal _allOfferings;
    mapping(address creator => address[] offerings) internal _offeringsByCreator;
    mapping(address offering => address redeemManager) public redeemManagerOf;
    mapping(address offering => address vesting) public vestingOf;
    mapping(address offering => address sponsorship) public sponsorshipOf;

    constructor(
        IDojang dojang_,
        IERC20 paymentToken_,
        address platformOwner_,
        PoolFactory poolFactory_,
        FeeRecipients memory feeRecipients_,
        Guide memory guide_
    ) Ownable(platformOwner_) {
        if (
            address(dojang_) == address(0) || address(paymentToken_) == address(0)
                || address(poolFactory_) == address(0) || feeRecipients_.platform == address(0)
                || feeRecipients_.reserve == address(0)
        ) revert ZeroAddress();
        dojang = dojang_;
        paymentToken = paymentToken_;
        platformOwner = platformOwner_;
        poolFactory = poolFactory_;
        offeringDeployer = new OfferingDeployer();
        stackDeployer = new StackDeployer();
        feeRecipients = feeRecipients_;
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

    /// @notice Deploy a new offering stack for the caller (the creator):
    ///         Vesting → Offering(+Token) → RedeemManager + Sponsorship.
    function createOffering(CreateParams calldata cp)
        external
        returns (address offering, address token, address redeemManager)
    {
        // Fail-closed: a reverting or false-returning Dojang lookup rejects the call.
        if (!dojang.isVerified(msg.sender)) revert NotVerifiedCreator(msg.sender);

        // One live token per creator: only a failed latest offering frees the slot.
        address[] storage prior = _offeringsByCreator[msg.sender];
        if (prior.length > 0) {
            Offering last = Offering(prior[prior.length - 1]);
            bool failed = last.refunding() && last.token().totalSupply() == 0;
            if (!failed) revert ActiveOfferingExists(msg.sender, address(last));
        }

        // Platform guide bands (P, R, L-as-fraction-of-R).
        if (cp.price < guide.minPrice || cp.price > guide.maxPrice) revert PriceOutOfBand(cp.price);
        if (cp.raiseTarget < guide.minRaise || cp.raiseTarget > guide.maxRaise) revert RaiseOutOfBand(cp.raiseTarget);
        if (
            cp.walletLimit < cp.raiseTarget * guide.minWalletLimitBps / 10_000
                || cp.walletLimit > cp.raiseTarget * guide.maxWalletLimitBps / 10_000
        ) revert WalletLimitOutOfBand(cp.walletLimit);

        // Creator allocation vests from the offering deadline (≈ settle time),
        // linear with cliff (D10) — irrevocable, non-upgradeable (불변식 6).
        MapaeVesting vesting =
            stackDeployer.deployVesting(msg.sender, uint64(cp.deadline), cp.vestingDuration, cp.vestingCliff);

        IOffering.OfferingParams memory p;
        p.paymentToken = paymentToken;
        p.dojang = dojang;
        p.creator = msg.sender; // no proxy issuance
        p.platformOwner = platformOwner;
        p.tokenName = cp.tokenName;
        p.tokenSymbol = cp.tokenSymbol;
        p.price = cp.price;
        p.raiseTarget = cp.raiseTarget;
        p.deadline = cp.deadline;
        p.walletLimit = cp.walletLimit;
        p.minCommit = cp.minCommit;
        p.fBps = cp.fBps;
        p.cBps = cp.cBps;
        p.creatorTokenBps = cp.creatorTokenBps;
        p.refundMode = cp.refundMode;
        p.transferLockDuration = cp.transferLockDuration;
        p.holdingCapBps = cp.holdingCapBps;
        p.poolFactory = poolFactory;
        p.swapRoyaltyBps = cp.swapRoyaltyBps;
        p.swapBurnBps = cp.swapBurnBps;
        p.recipients = IOffering.AllocationRecipients({
            creatorVesting: address(vesting), platform: feeRecipients.platform, reserve: feeRecipients.reserve
        });

        Offering o = offeringDeployer.deploy(p);
        MembershipToken t = o.token();
        (RedeemManager rm, Sponsorship sp) =
            stackDeployer.deployPeripherals(t, paymentToken, msg.sender, cp.sponsorBurnBps, SPONSOR_MAX_SLIPPAGE_BPS);

        _allOfferings.push(address(o));
        prior.push(address(o));
        redeemManagerOf[address(o)] = address(rm);
        vestingOf[address(o)] = address(vesting);
        sponsorshipOf[address(o)] = address(sp);

        emit OfferingCreated(msg.sender, address(o), address(t), address(rm), address(vesting), address(sp));
        return (address(o), address(t), address(rm));
    }

    function allOfferings() external view returns (address[] memory) {
        return _allOfferings;
    }

    function offeringsByCreator(address creator) external view returns (address[] memory) {
        return _offeringsByCreator[creator];
    }
}
