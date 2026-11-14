// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDojang} from "./interfaces/IDojang.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {PoolFactory} from "./PoolFactory.sol";
import {MapaeFactory} from "./MapaeFactory.sol";
import {CurveSale} from "./CurveSale.sol";

/// @title CurveFactory
/// @notice Opens v3 L0 bonding curves (CurveSale). Kept separate from MapaeFactory because
///         MapaeFactory's initcode already embeds both deployers (EIP-3860 budget); CurveSale's
///         creation code lives here instead.
///
///         Gates (in order): curveEnabled → Dojang real-name creator (fail-closed) → quote allowed
///         in MapaeFactory's registry → per-wallet rate limit (3 curves per rolling 7 days) →
///         name 1..32 bytes, symbol 1..10 bytes. The virtual quote reserve comes from the registry;
///         the creator cannot choose it.
///
///         Optional dev first buy in the same tx: quote is pulled from the dev into this factory,
///         spent via CurveSale.buyFor(dev, ...), the unspent part is refunded and the allowance
///         reset, so the factory ends every call holding no quote and no allowance.
contract CurveFactory is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_CURVES_PER_WINDOW = 3;
    uint256 public constant CURVE_WINDOW = 7 days;
    uint256 public constant MAX_NAME_BYTES = 32;
    uint256 public constant MAX_SYMBOL_BYTES = 10;

    error ZeroAddress();
    error CurvesDisabled();
    error NotVerified(address account);
    error QuoteNotAllowed(address quote);
    error CurveRateLimited(uint256 nextAllowedAt);
    error InvalidName();
    error InvalidSymbol();
    error NotCurve(address curve);
    error NotWethCurve(address curve);
    error ZeroValue();
    error EthRefundFailed();
    error DirectEthRejected();

    event CurveEnabledSet(bool enabled);
    event CurveCreated(
        address indexed dev,
        address indexed curve,
        address indexed token,
        address quote,
        uint256 virtualQuote,
        string name,
        string symbol
    );

    IDojang public immutable dojang;
    IFeeRouter public immutable feeRouter;
    PoolFactory public immutable poolFactory;
    MapaeFactory public immutable mapaeFactory;
    /// @notice Wrapped ETH used by the native-ETH entry points (must also be an allowed quote).
    IWETH public immutable weth;

    /// @notice New-curve kill switch. Existing curves keep trading and graduating.
    bool public curveEnabled = true;

    address[] internal _allCurves;
    mapping(address dev => address[] curves) internal _curvesByDev;
    mapping(address token => address curve) public curveOf;
    mapping(address token => address dev) public devOf;
    mapping(address curve => bool) public isCurve;

    /// @dev Ring buffer of the last MAX_CURVES_PER_WINDOW creation timestamps per wallet.
    mapping(address dev => uint64[MAX_CURVES_PER_WINDOW]) internal _recentCreates;
    mapping(address dev => uint8) internal _nextSlot;

    constructor(
        IDojang dojang_,
        IFeeRouter feeRouter_,
        PoolFactory poolFactory_,
        MapaeFactory mapaeFactory_,
        IWETH weth_,
        address owner_
    ) Ownable(owner_) {
        if (
            address(dojang_) == address(0) || address(feeRouter_) == address(0) || address(poolFactory_) == address(0)
                || address(mapaeFactory_) == address(0) || address(weth_) == address(0)
        ) revert ZeroAddress();
        dojang = dojang_;
        feeRouter = feeRouter_;
        poolFactory = poolFactory_;
        mapaeFactory = mapaeFactory_;
        weth = weth_;
    }

    /// @notice Only WETH unwraps may send ETH here (refund path). Anything else reverts.
    receive() external payable {
        if (msg.sender != address(weth)) revert DirectEthRejected();
    }

    function setCurveEnabled(bool enabled) external onlyOwner {
        curveEnabled = enabled;
        emit CurveEnabledSet(enabled);
    }

    /// @notice Open a curve. `devBuyQuoteIn > 0` performs the dev first buy in the same tx
    ///         (may sell out and graduate the curve immediately).
    function createCurve(
        IERC20 quote,
        string calldata name,
        string calldata symbol,
        uint256 devBuyQuoteIn,
        uint256 minTokensOut
    ) external nonReentrant returns (address curve, address token) {
        (curve, token) = _open(quote, name, symbol);
        if (devBuyQuoteIn > 0) _devFirstBuy(quote, CurveSale(curve), devBuyQuoteIn, minTokensOut);
    }

    /// @notice createCurve with quote = WETH and the dev first buy paid in native ETH
    ///         (msg.value; 0 = open only). Unspent ETH is refunded.
    function createCurveWithETH(string calldata name, string calldata symbol, uint256 minTokensOut)
        external
        payable
        nonReentrant
        returns (address curve, address token)
    {
        (curve, token) = _open(weth, name, symbol);
        if (msg.value > 0) _ethBuy(CurveSale(curve), minTokensOut);
    }

    /// @notice Buy on a WETH-quoted curve with native ETH. The real-name gate is enforced by
    ///         CurveSale.buyFor on msg.sender (fail-closed). Unspent ETH is refunded.
    function buyWithETH(CurveSale curve, uint256 minTokensOut)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut, uint256 ethSpent)
    {
        if (!isCurve[address(curve)]) revert NotCurve(address(curve));
        if (address(curve.quote()) != address(weth)) revert NotWethCurve(address(curve));
        if (msg.value == 0) revert ZeroValue();
        return _ethBuy(curve, minTokensOut);
    }

    /// @dev Shared gates of createCurve / createCurveWithETH, then deploy + register.
    function _open(IERC20 quote, string calldata name, string calldata symbol)
        internal
        returns (address curve, address token)
    {
        if (!curveEnabled) revert CurvesDisabled();
        if (!dojang.isVerified(msg.sender)) revert NotVerified(msg.sender);
        if (!mapaeFactory.isQuoteAllowed(address(quote))) revert QuoteNotAllowed(address(quote));
        _consumeRateLimit(msg.sender);
        _checkNames(name, symbol);
        return _deploy(quote, name, symbol);
    }

    /// @dev wrap msg.value → approve → buyFor(msg.sender) → unwrap + refund unspent ETH → reset
    ///      allowance. Ends with zero ETH, zero WETH and zero allowance on this factory.
    function _ethBuy(CurveSale c, uint256 minTokensOut) internal returns (uint256 tokensOut, uint256 spent) {
        weth.deposit{value: msg.value}();
        IERC20(address(weth)).forceApprove(address(c), msg.value);
        (tokensOut, spent) = c.buyFor(msg.sender, msg.value, minTokensOut);
        IERC20(address(weth)).forceApprove(address(c), 0);
        uint256 refund = msg.value - spent;
        if (refund > 0) {
            weth.withdraw(refund);
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert EthRefundFailed();
        }
    }

    function _checkNames(string calldata name, string calldata symbol) internal pure {
        uint256 nl = bytes(name).length;
        uint256 sl = bytes(symbol).length;
        if (nl == 0 || nl > MAX_NAME_BYTES) revert InvalidName();
        if (sl == 0 || sl > MAX_SYMBOL_BYTES) revert InvalidSymbol();
    }

    function _deploy(IERC20 quote, string calldata name, string calldata symbol)
        internal
        returns (address curve, address token)
    {
        uint256 virtualQuote = mapaeFactory.quoteConfig(address(quote)).curveVirtualQuote;
        CurveSale c = new CurveSale(
            CurveSale.InitParams({
                quote: quote,
                dojang: dojang,
                dev: msg.sender,
                feeRouter: feeRouter,
                poolFactory: poolFactory,
                mapaeFactory: address(mapaeFactory),
                tokenName: name,
                tokenSymbol: symbol,
                virtualQuote: virtualQuote
            })
        );
        curve = address(c);
        token = address(c.token());

        _allCurves.push(curve);
        _curvesByDev[msg.sender].push(curve);
        curveOf[token] = curve;
        devOf[token] = msg.sender;
        isCurve[curve] = true;
        emit CurveCreated(msg.sender, curve, token, address(quote), virtualQuote, name, symbol);
    }

    /// @dev Pull → approve → buyFor(dev) → refund unspent → reset allowance. Ends with zero
    ///      quote balance and zero allowance on this factory.
    function _devFirstBuy(IERC20 quote, CurveSale c, uint256 quoteIn, uint256 minTokensOut) internal {
        quote.safeTransferFrom(msg.sender, address(this), quoteIn);
        quote.forceApprove(address(c), quoteIn);
        (, uint256 spent) = c.buyFor(msg.sender, quoteIn, minTokensOut);
        if (quoteIn > spent) quote.safeTransfer(msg.sender, quoteIn - spent);
        quote.forceApprove(address(c), 0);
    }

    /// @dev Revert if the wallet already opened MAX_CURVES_PER_WINDOW curves within the last
    ///      CURVE_WINDOW; otherwise record this creation (overwrites the oldest slot).
    function _consumeRateLimit(address dev) internal {
        uint8 slot = _nextSlot[dev];
        uint64 oldest = _recentCreates[dev][slot];
        if (oldest != 0 && block.timestamp < uint256(oldest) + CURVE_WINDOW) {
            revert CurveRateLimited(uint256(oldest) + CURVE_WINDOW);
        }
        _recentCreates[dev][slot] = uint64(block.timestamp);
        _nextSlot[dev] = uint8((slot + 1) % MAX_CURVES_PER_WINDOW);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function allCurves() external view returns (address[] memory) {
        return _allCurves;
    }

    function curvesByDev(address dev) external view returns (address[] memory) {
        return _curvesByDev[dev];
    }

    /// @notice Earliest time `dev` may open another curve (0 / past = now).
    function nextAllowedAt(address dev) external view returns (uint256) {
        uint64 oldest = _recentCreates[dev][_nextSlot[dev]];
        return oldest == 0 ? 0 : uint256(oldest) + CURVE_WINDOW;
    }
}
