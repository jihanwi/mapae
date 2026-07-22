// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IMembershipToken} from "./interfaces/IMembershipToken.sol";

/// @title MembershipToken
/// @notice Fixed-supply, transferable creator membership ERC-20.
///
///         Nothing is minted at construction. The offering (the sole minter)
///         calls mintAllocations() exactly once at settlement, which atomically
///         mints every allocation, enables transfers, activates the optional
///         transfer lock / holding cap, and permanently revokes mint authority
///         (invariant 5: burned or unminted supply can never be re-issued).
///
///         Transfer gates (all checked in _update):
///         - Before settlement every transfer is blocked except mint/burn
///           (invariant 9: no circulation before the offering concludes).
///         - Optional transfer lock: for `transferLockDuration` after
///           settlement, transfers are blocked except burns (redeem) and
///           claim payouts from the offering.
///         - Optional holding cap: recipient balance must stay under
///           `holdingCap` (bps of minted supply); the offering and the
///           allocation recipients (vesting/LP/platform/reserve) are exempt.
///
///         Lock and cap parameters are constructor-injected and immutable.
contract MembershipToken is ERC20, ERC20Burnable, ERC20Permit, IMembershipToken {
    error NotMinter();
    error NotOffering();
    error PoolAlreadyRegistered();
    error TransfersNotEnabled();
    error TransferLocked(uint256 lockedUntil);
    error OverHoldingCap(address account, uint256 balance, uint256 cap);
    error LengthMismatch();
    error ZeroAddress();

    /// @notice Emitted once when mintAllocations completes and mint authority is revoked.
    event MintFinalized(uint256 totalMinted, uint256 holdingCap, uint256 transferLockUntil);
    /// @notice Emitted once when the offering registers the AMM pool at settle.
    event PoolRegistered(address indexed pool);

    uint16 internal constant BPS = 10_000;

    /// @notice The offering this token belongs to (claim transfers are lock-exempt).
    address public immutable offering;
    /// @notice Optional transfer lock duration applied at settlement; 0 = none.
    uint256 public immutable transferLockDuration;
    /// @notice Optional holding cap in bps of minted supply; 0 = none.
    uint16 public immutable holdingCapBps;

    /// @notice The only address allowed to mint; zeroed forever after the one mint.
    address public minter;
    /// @notice The AMM pool, registered once by the offering during settle (D9).
    ///         Cap-exempt and lock-exempt AS SENDER: during the transfer lock,
    ///         fans can BUY from the pool but cannot sell into it (anti-flipping).
    address public pool;
    /// @notice True once settlement has minted supply; gates all transfers before.
    bool public transfersEnabled;
    /// @inheritdoc IMembershipToken
    uint256 public transferLockUntil;
    /// @inheritdoc IMembershipToken
    uint256 public holdingCap;

    /// @notice Addresses exempt from the holding cap (offering + allocation recipients).
    mapping(address account => bool) public capExempt;

    constructor(
        string memory name_,
        string memory symbol_,
        address minter_,
        uint256 transferLockDuration_,
        uint16 holdingCapBps_,
        address[] memory capExempt_
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (minter_ == address(0)) revert ZeroAddress();
        offering = minter_;
        minter = minter_;
        transferLockDuration = transferLockDuration_;
        holdingCapBps = holdingCapBps_;
        capExempt[minter_] = true;
        for (uint256 i = 0; i < capExempt_.length; i++) {
            capExempt[capExempt_[i]] = true;
        }
    }

    /// @notice Mint every allocation in one shot, enable transfers, activate the
    ///         optional lock/cap, and permanently revoke mint authority.
    /// @dev Callable once, by the offering only. There is deliberately no other
    ///      mint path: after this call `minter == address(0)` forever.
    function mintAllocations(address[] calldata to, uint256[] calldata amounts) external {
        if (msg.sender != minter) revert NotMinter();
        if (to.length != amounts.length) revert LengthMismatch();
        minter = address(0);

        uint256 total;
        for (uint256 i = 0; i < to.length; i++) {
            _mint(to[i], amounts[i]);
            total += amounts[i];
        }

        transfersEnabled = true;
        if (transferLockDuration > 0) {
            transferLockUntil = block.timestamp + transferLockDuration;
        }
        if (holdingCapBps > 0) {
            holdingCap = total * holdingCapBps / BPS;
        }
        emit MintFinalized(total, holdingCap, transferLockUntil);
    }

    /// @dev Transfer gate. Mints and burns always pass; regular transfers
    ///      require settlement, respect the optional transfer lock (offering
    ///      claim payouts exempt), and the optional holding cap (recipients
    ///      on the exempt list pass).
    ///
    ///      Claim payouts (`from == offering`) are ALSO cap-exempt (M2 PM
    ///      decision): primary allocations are already bounded by the KYC'd
    ///      per-wallet limit L — the cap only targets secondary-market whale
    ///      accumulation. Without this exemption, a mode B undersell can make
    ///      cap = S'×bps smaller than a legitimate allocation and brick claims.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (!transfersEnabled) revert TransfersNotEnabled();
            if (block.timestamp < transferLockUntil && from != offering && from != pool) {
                revert TransferLocked(transferLockUntil);
            }
        }
        super._update(from, to, value);
        if (to != address(0) && holdingCap != 0 && !capExempt[to] && from != offering && balanceOf(to) > holdingCap) {
            revert OverHoldingCap(to, balanceOf(to), holdingCap);
        }
    }

    /// @notice Register the AMM pool. Offering-only, once — same trust pattern
    ///         as the minter: after settle the wiring is immutable.
    function registerPool(address pool_) external {
        if (msg.sender != offering) revert NotOffering();
        if (pool != address(0)) revert PoolAlreadyRegistered();
        if (pool_ == address(0)) revert ZeroAddress();
        pool = pool_;
        capExempt[pool_] = true;
        emit PoolRegistered(pool_);
    }

    /// @inheritdoc IMembershipToken
    function burn(uint256 amount) public override(ERC20Burnable, IMembershipToken) {
        super.burn(amount);
    }

    /// @inheritdoc IMembershipToken
    function burnFrom(address account, uint256 amount) public override(ERC20Burnable, IMembershipToken) {
        super.burnFrom(account, amount);
    }
}
