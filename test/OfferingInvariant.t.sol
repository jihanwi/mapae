// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {Offering} from "../src/Offering.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";
import {PoolFactory} from "../src/PoolFactory.sol";

uint256 constant PRICE = 10_000e18;
uint256 constant RAISE = 1_000_000e18;
uint256 constant WALLET_LIMIT = 300_000e18;
uint256 constant MIN_COMMIT = 10_000e18;

/// @dev Shared handler plumbing: actors, funding, time travel, ghost state.
abstract contract HandlerBase is CommonBase, StdCheats, StdUtils {
    Offering public offering;
    MockKRW public krw;
    address public creator;

    address[] public actors;

    // Ghost flags: set true only if a must-never-succeed action succeeded.
    bool public creatorCommitSucceeded;

    constructor(Offering offering_, MockKRW krw_, address creator_) {
        offering = offering_;
        krw = krw_;
        creator = creator_;
        for (uint256 i = 0; i < 5; i++) {
            actors.push(address(uint160(0xE0000 + i)));
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    function commit(uint256 actorSeed, uint256 amount) external virtual {
        address actor = _actor(actorSeed);
        amount = bound(amount, MIN_COMMIT, WALLET_LIMIT);
        vm.startPrank(actor);
        krw.faucet(amount);
        krw.approve(address(offering), amount);
        offering.commit(amount);
        vm.stopPrank();
    }

    /// 불변식 8 probe: the creator keeps trying to commit; success sets the ghost flag.
    function commitAsCreator(uint256 amount) external {
        amount = bound(amount, MIN_COMMIT, WALLET_LIMIT);
        vm.startPrank(creator);
        krw.faucet(amount);
        krw.approve(address(offering), amount);
        try offering.commit(amount) {
            creatorCommitSucceeded = true;
        } catch {}
        vm.stopPrank();
    }

    function cancel(uint256 actorSeed, uint256 amount) external {
        address actor = _actor(actorSeed);
        amount = bound(amount, 1, WALLET_LIMIT);
        vm.prank(actor);
        offering.cancel(amount);
    }

    function warp(uint256 secs) external {
        secs = bound(secs, 30 minutes, 3 days);
        vm.warp(block.timestamp + secs);
    }

    function refund(uint256 actorSeed) external {
        vm.prank(_actor(actorSeed));
        offering.refund();
    }

    function sumCommitted() public view returns (uint256 total) {
        for (uint256 i = 0; i < actors.length; i++) {
            total += offering.committed(actors[i]);
        }
    }
}

/// @dev Mode B handler: adds settle (single-leaf root), claim, burn, emergency refund.
contract HandlerModeB is HandlerBase {
    bool public didSettle;
    uint256 public supplyAtSettle;

    // The single settled leaf (largest committer at settle time).
    address public leafActor;
    uint256 public leafAllocation;
    uint256 public leafRefund;

    constructor(Offering o, MockKRW k, address c) HandlerBase(o, k, c) {}

    function settle(uint256 seedWord) external {
        if (offering.settled() || offering.refunding()) return;
        (,, uint256 deadline,,,) = offering.params();
        if (block.timestamp < deadline) return;

        // Largest committer becomes the single leaf of the allocation tree.
        address best;
        uint256 bestCommit;
        for (uint256 i = 0; i < actors.length; i++) {
            uint256 c = offering.committed(actors[i]);
            if (c > bestCommit) {
                best = actors[i];
                bestCommit = c;
            }
        }
        if (bestCommit == 0) return;

        uint256 allocation = bestCommit * 1e18 / PRICE;
        if (allocation > offering.qSale()) allocation = offering.qSale();
        if (allocation == 0) return;
        uint256 cost = allocation * PRICE / 1e18;

        leafActor = best;
        leafAllocation = allocation;
        leafRefund = bestCommit - cost;

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(best, allocation, leafRefund))));
        offering.settle(leaf, allocation, cost, bytes32(seedWord));

        didSettle = true;
        supplyAtSettle = offering.token().totalSupply(); // post-unsold-burn supply
    }

    function claim() external {
        if (!didSettle || offering.hasClaimed(leafActor)) return;
        vm.prank(leafActor);
        offering.claim(leafAllocation, leafRefund, new bytes32[](0));
    }

    /// Post-settle burns (redeem path) — supply must only ever go down (불변식 1).
    function burnTokens(uint256 actorSeed, uint256 amount) external {
        address actor = _actor(actorSeed);
        MembershipToken token = offering.token();
        uint256 balance = token.balanceOf(actor);
        if (balance == 0) return;
        amount = bound(amount, 1, balance);
        vm.prank(actor);
        token.burn(amount);
    }

    function emergencyRefund() external {
        offering.emergencyRefund();
    }
}

/// @dev Mode A handler: adds enableRefunds and an under-target settle probe.
contract HandlerModeA is HandlerBase {
    bool public underTargetSettleSucceeded;

    constructor(Offering o, MockKRW k, address c) HandlerBase(o, k, c) {}

    function enableRefunds() external {
        offering.enableRefunds();
    }

    function emergencyRefund() external {
        offering.emergencyRefund();
    }

    /// 불변식 4 probe: settling under target in mode A must always revert.
    function settleUnderTarget() external {
        if (offering.settled() || offering.refunding()) return;
        if (offering.totalCommitted() >= RAISE) return;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(actors[0], 1e18, uint256(0)))));
        try offering.settle(leaf, 1e18, 0, bytes32(0)) {
            underTargetSettleSucceeded = true;
        } catch {}
    }
}

/// @notice Invariants over the mode B (Partial) lifecycle. Numbered comments
///         reference docs/SPEC.md 불변식.
contract OfferingInvariantModeBTest is Test {
    HandlerModeB internal handler;

    /// Tokenomics preset under test; overridden by the edge-preset suite.
    function _preset() internal pure virtual returns (uint16 fBps, uint16 cBps, uint16 creatorTokenBps) {
        return (6000, 1500, 2500); // owner-confirmed default
    }

    Offering internal offering;
    MembershipToken internal token;
    MockKRW internal krw;
    address internal creator = makeAddr("creator");

    function setUp() public {
        vm.warp(1_750_000_000);
        krw = new MockKRW();
        MockDojang dojang = new MockDojang();

        IOffering.OfferingParams memory p;
        p.paymentToken = IERC20(address(krw));
        p.dojang = IDojang(address(dojang));
        p.creator = creator;
        p.platformOwner = address(this);
        p.tokenName = "Creator Membership";
        p.tokenSymbol = "CRTM";
        p.price = PRICE;
        p.raiseTarget = RAISE;
        p.deadline = block.timestamp + 24 hours;
        p.walletLimit = WALLET_LIMIT;
        p.minCommit = MIN_COMMIT;
        (p.fBps, p.cBps, p.creatorTokenBps) = _preset();
        p.refundMode = IOffering.RefundMode.Partial;
        p.poolFactory = new PoolFactory();
        p.swapRoyaltyBps = 100;
        p.swapBurnBps = 50;
        p.recipients = IOffering.AllocationRecipients({
            creatorVesting: makeAddr("creatorVesting"), platform: makeAddr("platform"), reserve: makeAddr("reserve")
        });
        offering = new Offering(p);
        token = offering.token();

        for (uint256 i = 0; i < 5; i++) {
            dojang.setVerified(address(uint160(0xE0000 + i)), true);
        }
        dojang.setVerified(creator, true); // verified, yet still must be blocked (불변식 8)
        handler = new HandlerModeB(offering, krw, creator);
        offering.transferOwnership(address(handler)); // handler settles

        targetContract(address(handler));
    }

    /// 불변식 1: after settle, mint authority is gone and supply only decreases.
    function invariant_1_SupplyMonotoneDecreasingAfterSettle() public view {
        if (handler.didSettle()) {
            assertLe(token.totalSupply(), handler.supplyAtSettle());
            assertEq(token.minter(), address(0));
        }
    }

    /// 불변식 2 & 9: zero circulation and no transfers before settlement.
    function invariant_2_9_NoCirculationBeforeSettle() public view {
        if (!offering.settled()) {
            assertEq(token.totalSupply(), 0);
            assertFalse(token.transfersEnabled());
        }
    }

    /// 불변식 3: no wallet can ever exceed the per-wallet limit L.
    function invariant_3_WalletLimit() public view {
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            assertLe(offering.committed(handler.actors(i)), WALLET_LIMIT);
        }
    }

    /// 불변식 8: the creator wallet never holds a commitment.
    function invariant_8_CreatorNeverCommits() public view {
        assertFalse(handler.creatorCommitSucceeded());
        assertEq(offering.committed(creator), 0);
    }

    /// 불변식 10: no unsold residue — offering token balance is exactly
    /// what claimants haven't pulled yet.
    function invariant_10_NoUnsoldResidue() public view {
        if (offering.settled()) {
            assertEq(token.balanceOf(address(offering)), offering.totalSold() - offering.claimedTokens());
        }
    }

    /// Solvency: the offering always holds enough payment tokens to cover
    /// every outstanding obligation (deposits pre-settle, refunds post-settle).
    function invariant_Solvency() public view {
        if (offering.settled()) {
            assertGe(
                krw.balanceOf(address(offering)),
                offering.totalCommitted() - offering.totalRaised() - offering.refundedPayment()
            );
        } else {
            assertEq(krw.balanceOf(address(offering)), handler.sumCommitted());
        }
    }
}

/// @notice Invariants over the mode A (AllOrNothing) refund lifecycle.
contract OfferingInvariantModeATest is Test {
    HandlerModeA internal handler;

    function _preset() internal pure returns (uint16 fBps, uint16 cBps, uint16 creatorTokenBps) {
        return (6000, 1500, 2500);
    }

    Offering internal offering;
    MockKRW internal krw;
    address internal creator = makeAddr("creator");

    function setUp() public {
        vm.warp(1_750_000_000);
        krw = new MockKRW();
        MockDojang dojang = new MockDojang();

        IOffering.OfferingParams memory p;
        p.paymentToken = IERC20(address(krw));
        p.dojang = IDojang(address(dojang));
        p.creator = creator;
        p.platformOwner = address(this);
        p.tokenName = "Creator Membership";
        p.tokenSymbol = "CRTM";
        p.price = PRICE;
        p.raiseTarget = RAISE;
        p.deadline = block.timestamp + 24 hours;
        p.walletLimit = WALLET_LIMIT;
        p.minCommit = MIN_COMMIT;
        (p.fBps, p.cBps, p.creatorTokenBps) = _preset();
        p.refundMode = IOffering.RefundMode.AllOrNothing;
        p.poolFactory = new PoolFactory();
        p.swapRoyaltyBps = 100;
        p.swapBurnBps = 50;
        p.recipients = IOffering.AllocationRecipients({
            creatorVesting: makeAddr("creatorVesting"), platform: makeAddr("platform"), reserve: makeAddr("reserve")
        });
        offering = new Offering(p);

        for (uint256 i = 0; i < 5; i++) {
            dojang.setVerified(address(uint160(0xE0000 + i)), true);
        }
        dojang.setVerified(creator, true); // verified, yet still must be blocked (불변식 8)
        handler = new HandlerModeA(offering, krw, creator);
        offering.transferOwnership(address(handler));

        targetContract(address(handler));
    }

    /// 불변식 4: mode A under target → every deposit stays refundable and
    /// zero tokens are ever issued.
    function invariant_4_ModeAUnderTargetFullyRefundable() public view {
        assertFalse(handler.underTargetSettleSucceeded());
        if (offering.refunding()) {
            assertEq(offering.token().totalSupply(), 0);
        }
        // Deposits are always fully backed, refunding or not.
        assertEq(krw.balanceOf(address(offering)), handler.sumCommitted());
    }

    /// 불변식 3 re-checked in mode A.
    function invariant_3_WalletLimit() public view {
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            assertLe(offering.committed(handler.actors(i)), WALLET_LIMIT);
        }
    }
}

/// @notice Same mode B invariants at the feasibility edge of the bands:
///         f 6900 + creator 1500 + platform 500 + lp 1035 = 9935 bps.
contract OfferingInvariantModeBEdgeTest is OfferingInvariantModeBTest {
    function _preset() internal pure override returns (uint16, uint16, uint16) {
        return (6900, 1500, 1500);
    }
}
