// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MembershipToken} from "./MembershipToken.sol";
import {MapaePool} from "./MapaePool.sol";
import {BuybackVault} from "./BuybackVault.sol";

/// @title BuybackExecutor (v1)
/// @notice Replaceable buyback *strategy* over a BuybackVault. v1 is deliberately
///         simple: a min interval between runs per token, a daily cap as a
///         fraction of pool KRW depth, and a spot-referenced slippage guard.
///         Triggering is onlyOwner — keeper automation is roadmap (see TRUST.md).
/// @dev The executor holds no funds and cannot move value on its own: it can
///      only call vault.executeBuyback, whose sole effect is a burn. Swapping the
///      vault's executor to a new strategy is the intended upgrade path.
contract BuybackExecutor is Ownable {
    error TooSoon(uint256 nextAllowed);
    error NothingToBuy();
    error PoolNotListed();
    error BadParams();

    event Ran(address indexed token, uint256 amountIn, uint256 tokensBurned);
    event ParamsUpdated(uint32 intervalSec, uint16 dailyCapBps, uint16 maxSlippageBps);

    uint16 public constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;

    BuybackVault public immutable vault;

    /// @notice Minimum seconds between runs for a given token (default 24h).
    uint32 public intervalSec = 24 hours;
    /// @notice Per-run cap as bps of the pool's KRW reserve (default 5%).
    uint16 public dailyCapBps = 500;
    /// @notice Slippage tolerance vs spot on the buyback (default 5%).
    uint16 public maxSlippageBps = 500;

    mapping(address token => uint256 lastRunAt) public lastRun;

    constructor(BuybackVault vault_, address owner_) Ownable(owner_) {
        vault = vault_;
    }

    /// @notice Tune the v1 strategy parameters.
    function setParams(uint32 intervalSec_, uint16 dailyCapBps_, uint16 maxSlippageBps_) external onlyOwner {
        if (dailyCapBps_ == 0 || dailyCapBps_ > BPS || maxSlippageBps_ >= BPS) revert BadParams();
        intervalSec = intervalSec_;
        dailyCapBps = dailyCapBps_;
        maxSlippageBps = maxSlippageBps_;
        emit ParamsUpdated(intervalSec_, dailyCapBps_, maxSlippageBps_);
    }

    /// @notice Run one buyback for `token`: buy min(earmarked, capped depth) from
    ///         the pool and burn it, respecting the interval and slippage guard.
    function run(address token) external onlyOwner returns (uint256 tokensBurned) {
        uint256 next = lastRun[token] + intervalSec;
        if (block.timestamp < next) revert TooSoon(next);

        address pool = MembershipToken(token).pool();
        if (pool == address(0)) revert PoolNotListed();

        uint256 bal = vault.krwBalance(token);
        uint256 cap = MapaePool(pool).reserveQuote() * dailyCapBps / BPS;
        uint256 amountIn = bal < cap ? bal : cap;
        if (amountIn == 0) revert NothingToBuy();

        uint256 spot = MapaePool(pool).spotPrice();
        uint256 expectedOut = spot == 0 ? 0 : amountIn * WAD / spot;
        uint256 minOut = expectedOut * (BPS - maxSlippageBps) / BPS;

        lastRun[token] = block.timestamp;
        tokensBurned = vault.executeBuyback(token, amountIn, minOut);
        emit Ran(token, amountIn, tokensBurned);
    }
}
