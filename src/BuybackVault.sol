// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MembershipToken} from "./MembershipToken.sol";
import {MapaePool} from "./MapaePool.sol";
import {IFeeRouter} from "./interfaces/IFeeRouter.sol";
import {ITierSource} from "./interfaces/ITierSource.sol";

/// @title BuybackVault
/// @notice Global vault that accumulates KRWs earmarked per membership token
///         (from Sponsorship/RedeemManager reroute + external top-ups) and can
///         spend them ONLY to buy that token from its pool and burn it, via the
///         0%-fee MapaePool.swapForBurn path.
///
///         Core invariant (불변식 9): there is NO withdraw function and no other
///         KRWs outflow — even swapping the executor to a hostile address cannot
///         move KRWs anywhere except into a pool for an immediate burn. Funds and
///         accounting live here; the *strategy* (when/how much) lives in a
///         separate, replaceable BuybackExecutor.
/// @dev Deployed once (not per offering). The MapaeFactory registers it as a
///      burner so its swapForBurn calls are accepted. L0 tokens are gated out.
contract BuybackVault is Ownable {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error NotExecutor();
    error TierNotAllowed();
    error InsufficientBalance();
    error RateTooHigh();
    error PoolNotListed();

    event Routed(address indexed token, address indexed from, uint256 amount, uint256 balance);
    event ToppedUp(address indexed token, address indexed from, uint256 amount, uint256 balance);
    event ExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);
    event RerouteRateUpdated(address indexed creator, uint16 bps);
    event BuybackExecuted(address indexed token, uint256 krwIn, uint256 tokensBurned, uint256 cumulativeBurned);

    /// @notice Max creator reroute rate: 30%.
    uint16 public constant MAX_REROUTE_BPS = 3000;

    IERC20 public immutable krw;
    /// @notice Authorized to trigger buybacks (a BuybackExecutor, or the owner).
    ///         Swapping this address can never enable a non-burn outflow.
    address public executor;

    /// @notice KRWs earmarked per token, awaiting buyback.
    mapping(address token => uint256) public krwBalance;
    /// @notice Cumulative tokens bought-and-burned per token.
    mapping(address token => uint256) public totalBurned;
    /// @notice Creator-set reroute rate (0–30%), read by Sponsorship/RedeemManager.
    mapping(address creator => uint16) public rerouteRateBps;

    constructor(IERC20 krw_, address owner_) Ownable(owner_) {
        if (address(krw_) == address(0)) revert ZeroAddress();
        krw = krw_;
        executor = owner_;
    }

    /// @dev token → offering → tier(), no factory dependency ([Q5]).
    function _tier(address token) internal view returns (IFeeRouter.UtilityTier) {
        return ITierSource(MembershipToken(token).offering()).tier();
    }

    modifier notL0(address token) {
        if (_tier(token) == IFeeRouter.UtilityTier.L0) revert TierNotAllowed();
        _;
    }

    // ------------------------------------------------------------------
    // Config
    // ------------------------------------------------------------------

    /// @notice Point buyback execution at a new strategy contract (or the owner).
    function setExecutor(address newExecutor) external onlyOwner {
        if (newExecutor == address(0)) revert ZeroAddress();
        emit ExecutorUpdated(executor, newExecutor);
        executor = newExecutor;
    }

    /// @notice Creator sets the share of their proceeds that peripherals reroute
    ///         here for buyback-and-burn (0–30%).
    function setRerouteRate(uint16 bps) external {
        if (bps > MAX_REROUTE_BPS) revert RateTooHigh();
        rerouteRateBps[msg.sender] = bps;
        emit RerouteRateUpdated(msg.sender, bps);
    }

    // ------------------------------------------------------------------
    // Deposits (route from peripherals + permissionless top-ups — [Q6])
    // ------------------------------------------------------------------

    /// @notice Route KRWs earmarked for `token`'s buyback (from Sponsorship /
    ///         RedeemManager). Permissionless deposit — there is no withdraw, so
    ///         funds can only ever leave as a burn.
    function route(address token, uint256 amount) external notL0(token) {
        _deposit(token, amount);
        emit Routed(token, msg.sender, amount, krwBalance[token]);
    }

    /// @notice External top-up of a token's buyback budget.
    function topUp(address token, uint256 amount) external notL0(token) {
        _deposit(token, amount);
        emit ToppedUp(token, msg.sender, amount, krwBalance[token]);
    }

    function _deposit(address token, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        krw.safeTransferFrom(msg.sender, address(this), amount);
        krwBalance[token] += amount;
    }

    // ------------------------------------------------------------------
    // Buyback (executor-gated; the ONLY KRWs outflow — 불변식 9)
    // ------------------------------------------------------------------

    /// @notice Spend up to the earmarked balance to buy `token` from its pool and
    ///         burn every bought token (0%-fee swapForBurn). Executor-only.
    function executeBuyback(address token, uint256 amountIn, uint256 minOut)
        external
        notL0(token)
        returns (uint256 tokensBurned)
    {
        if (msg.sender != executor) revert NotExecutor();
        if (amountIn == 0) revert ZeroAmount();
        if (amountIn > krwBalance[token]) revert InsufficientBalance();
        address pool = MembershipToken(token).pool();
        if (pool == address(0)) revert PoolNotListed();

        krwBalance[token] -= amountIn;
        krw.forceApprove(pool, amountIn);
        tokensBurned = MapaePool(pool).swapForBurn(amountIn, minOut);
        totalBurned[token] += tokensBurned;
        emit BuybackExecuted(token, amountIn, tokensBurned, totalBurned[token]);
    }

    // NB: intentionally NO withdraw / rescue / sweep function. The absence is the
    // invariant — do not add one.
}
