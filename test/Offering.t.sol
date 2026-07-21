// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {Offering} from "../src/Offering.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {OfferingTestBase} from "./utils/OfferingTestBase.sol";

contract OfferingUnitTest is OfferingTestBase {
    Offering internal offering; // mode B default

    address internal fan1 = makeAddr("fan1");
    address internal fan2 = makeAddr("fan2");

    function setUp() public override {
        super.setUp();
        offering = newOffering(IOffering.RefundMode.Partial);
    }

    // ------------------------------------------------------------------
    // Constructor / duration band (기획 v4.5)
    // ------------------------------------------------------------------

    function test_Constructor_Derivations() public view {
        assertEq(offering.qSale(), RAISE * 1e18 / PRICE); // 100 tokens
        assertEq(offering.lpTokenBps(), 600); // 10% × 6000bps
        assertEq(offering.freezeWindow(), 2 hours);
        assertEq(address(offering.token().offering()), address(offering));
        assertEq(offering.token().minter(), address(offering));
    }

    function test_Duration_ExactBoundsAllowed() public {
        IOffering.OfferingParams memory p = defaultParams(IOffering.RefundMode.Partial);
        p.deadline = block.timestamp + 12 hours; // exactly MIN
        new Offering(p);
        p.deadline = block.timestamp + 48 hours; // exactly MAX
        new Offering(p);
    }

    function test_Duration_OutOfBandReverts() public {
        IOffering.OfferingParams memory p = defaultParams(IOffering.RefundMode.Partial);
        p.deadline = block.timestamp + 12 hours - 1;
        vm.expectRevert(IOffering.InvalidDuration.selector);
        new Offering(p);
        p.deadline = block.timestamp + 48 hours + 1;
        vm.expectRevert(IOffering.InvalidDuration.selector);
        new Offering(p);
    }

    function test_Constructor_FBpsBand() public {
        IOffering.OfferingParams memory p = defaultParams(IOffering.RefundMode.Partial);
        p.fBps = 4999;
        vm.expectRevert(IOffering.InvalidConfig.selector);
        new Offering(p);
        p.fBps = 7001;
        vm.expectRevert(IOffering.InvalidConfig.selector);
        new Offering(p);
        // 7000 is inside the nominal band but breaks Σ shares ≤ 100%
        // (70 + 25 + 5 + 7 = 107%) — must revert until the band is re-cut.
        p.fBps = 7000;
        vm.expectRevert(IOffering.InvalidConfig.selector);
        new Offering(p);
        p.fBps = 6000;
        new Offering(p); // 60 + 25 + 5 + 6 = 96% ✓
    }

    // ------------------------------------------------------------------
    // commit
    // ------------------------------------------------------------------

    function test_Commit_HappyPath() public {
        commitAs(offering, fan1, 50_000e18);
        assertEq(offering.committed(fan1), 50_000e18);
        assertEq(offering.totalCommitted(), 50_000e18);
        assertEq(krw.balanceOf(address(offering)), 50_000e18);
    }

    function test_Commit_EmitsEvent() public {
        dojang.setVerified(fan1, true);
        vm.startPrank(fan1);
        krw.faucet(50_000e18);
        krw.approve(address(offering), 50_000e18);
        vm.expectEmit(true, false, false, true);
        emit IOffering.Committed(fan1, 50_000e18, 50_000e18);
        offering.commit(50_000e18);
        vm.stopPrank();
    }

    function test_Commit_RevertUnverified() public {
        vm.startPrank(fan1);
        krw.faucet(50_000e18);
        krw.approve(address(offering), 50_000e18);
        vm.expectRevert(abi.encodeWithSelector(IOffering.NotVerified.selector, fan1));
        offering.commit(50_000e18);
        vm.stopPrank();
    }

    /// 불변식 8: the issuer wallet can never commit to its own offering.
    function test_Commit_RevertCreator() public {
        dojang.setVerified(creator, true);
        vm.startPrank(creator);
        krw.faucet(50_000e18);
        krw.approve(address(offering), 50_000e18);
        vm.expectRevert(IOffering.IssuerCannotCommit.selector);
        offering.commit(50_000e18);
        vm.stopPrank();
    }

    function test_Commit_RevertBelowMinCommit() public {
        dojang.setVerified(fan1, true);
        vm.startPrank(fan1);
        krw.faucet(MIN_COMMIT);
        krw.approve(address(offering), MIN_COMMIT);
        vm.expectRevert(abi.encodeWithSelector(IOffering.BelowMinCommit.selector, MIN_COMMIT - 1, MIN_COMMIT));
        offering.commit(MIN_COMMIT - 1);
        // exactly minCommit passes
        offering.commit(MIN_COMMIT);
        // top-ups below minCommit are fine once the first commit cleared it
        krw.faucet(1);
        krw.approve(address(offering), 1);
        offering.commit(1);
        vm.stopPrank();
    }

    /// 불변식 3: cumulative commits per wallet can never exceed L.
    function test_Commit_RevertOverWalletLimit() public {
        commitAs(offering, fan1, WALLET_LIMIT); // exactly L: ok
        vm.startPrank(fan1);
        krw.faucet(1);
        krw.approve(address(offering), 1);
        vm.expectRevert(
            abi.encodeWithSelector(IOffering.OverWalletLimit.selector, fan1, WALLET_LIMIT + 1, WALLET_LIMIT)
        );
        offering.commit(1);
        vm.stopPrank();
    }

    function test_Commit_AllowedDuringFreeze_RevertAfterDeadline() public {
        dojang.setVerified(fan1, true);
        vm.startPrank(fan1);
        krw.faucet(100_000e18);
        krw.approve(address(offering), 100_000e18);
        // freeze window blocks cancels only — commits stay open until deadline
        (,, uint256 deadline,,,) = offering.params();
        vm.warp(deadline - 1 hours);
        offering.commit(50_000e18);
        assertEq(uint8(offering.phase()), uint8(IOffering.Phase.Frozen));
        vm.warp(deadline);
        vm.expectRevert(IOffering.DeadlinePassed.selector);
        offering.commit(50_000e18);
        vm.stopPrank();
    }

    function test_Commit_RevertZeroAmount() public {
        dojang.setVerified(fan1, true);
        vm.prank(fan1);
        vm.expectRevert(IOffering.ZeroAmount.selector);
        offering.commit(0);
    }

    // ------------------------------------------------------------------
    // cancel — freeze boundary is exactly deadline − 2h
    // ------------------------------------------------------------------

    function test_Cancel_HappyPath() public {
        commitAs(offering, fan1, 50_000e18);
        vm.prank(fan1);
        offering.cancel(20_000e18);
        assertEq(offering.committed(fan1), 30_000e18);
        assertEq(offering.totalCommitted(), 30_000e18);
        assertEq(krw.balanceOf(fan1), 20_000e18);
    }

    function test_Cancel_FreezeBoundary() public {
        commitAs(offering, fan1, 50_000e18);
        (,, uint256 deadline,,,) = offering.params();
        // one second before the freeze: allowed
        vm.warp(deadline - 2 hours - 1);
        vm.prank(fan1);
        offering.cancel(10_000e18);
        // exactly at deadline − 2h: frozen
        vm.warp(deadline - 2 hours);
        vm.prank(fan1);
        vm.expectRevert(IOffering.CommitFrozen.selector);
        offering.cancel(10_000e18);
    }

    function test_Cancel_RevertOverCommitted() public {
        commitAs(offering, fan1, 50_000e18);
        vm.prank(fan1);
        vm.expectRevert(abi.encodeWithSelector(IOffering.ExceedsCommitted.selector, 50_001e18, 50_000e18));
        offering.cancel(50_001e18);
    }

    // ------------------------------------------------------------------
    // settle — authority, timing, sanity checks (D2)
    // ------------------------------------------------------------------

    function _warpPastDeadline() internal {
        (,, uint256 deadline,,,) = offering.params();
        vm.warp(deadline);
    }

    function test_Settle_RevertNonOwner() public {
        commitAs(offering, fan1, 100_000e18);
        _warpPastDeadline();
        vm.prank(fan1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, fan1));
        offering.settle(bytes32(0), 1e18, 0, bytes32(0));
    }

    function test_Settle_RevertBeforeDeadline() public {
        commitAs(offering, fan1, 100_000e18);
        vm.expectRevert(IOffering.DeadlineNotReached.selector);
        offering.settle(bytes32(0), 1e18, 0, bytes32(0));
    }

    function test_Settle_SanityChecks() public {
        commitAs(offering, fan1, 100_000e18); // affords 10 tokens
        _warpPastDeadline();
        // totalSold == 0
        vm.expectRevert(IOffering.SettleSanityFailed.selector);
        offering.settle(bytes32(0), 0, 0, bytes32(0));
        // totalSold > qSale
        uint256 overSold = offering.qSale() + 1;
        vm.expectRevert(IOffering.SettleSanityFailed.selector);
        offering.settle(bytes32(0), overSold, 0, bytes32(0));
        // totalRaised > totalCommitted
        vm.expectRevert(IOffering.SettleSanityFailed.selector);
        offering.settle(bytes32(0), 10e18, 100_000e18 + 1, bytes32(0));
        // totalRaised > totalSold × P (raised must be coverable by sold tokens)
        vm.expectRevert(IOffering.SettleSanityFailed.selector);
        offering.settle(bytes32(0), 1e18, 10_001e18, bytes32(0));
    }

    function test_Settle_RevertDouble() public {
        commitAs(offering, fan1, 100_000e18);
        _warpPastDeadline();
        offering.settle(leafFor(fan1, 10e18, 0), 10e18, 100_000e18, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(IOffering.InvalidPhase.selector, IOffering.Phase.Settled));
        offering.settle(bytes32(0), 10e18, 100_000e18, bytes32(0));
    }

    /// D4: atomic settlement — mint, burn unsold, distribute, enable transfers, pay proceeds.
    function test_Settle_DistributionAndProceeds() public {
        commitAs(offering, fan1, 300_000e18); // affords 30 tokens
        _warpPastDeadline();

        uint256 totalSold = 30e18;
        uint256 totalRaised = 300_000e18;
        vm.expectEmit(false, false, false, true);
        emit IOffering.UnsoldBurned(70e18); // qSale 100 − sold 30
        offering.settle(leafFor(fan1, totalSold, 0), totalSold, totalRaised, bytes32(uint256(42)));

        MembershipToken token = offering.token();
        // S' = 30 / 0.6 = 50 tokens; creator 25% = 12.5, LP 6% = 3, platform 5% = 2.5,
        // reserve = 50 − 30 − 12.5 − 3 − 2.5 = 2
        assertEq(token.totalSupply(), 50e18);
        assertEq(token.balanceOf(address(offering)), 30e18);
        assertEq(token.balanceOf(creatorVesting), 12.5e18);
        assertEq(token.balanceOf(lpEscrow), 3e18);
        assertEq(token.balanceOf(platform), 2.5e18);
        assertEq(token.balanceOf(reserve), 2e18);
        // mint authority permanently revoked (불변식 5)
        assertEq(token.minter(), address(0));
        assertTrue(token.transfersEnabled());
        // proceeds 80/10/10
        assertEq(krw.balanceOf(creator), 240_000e18);
        assertEq(krw.balanceOf(lpEscrow), 30_000e18);
        assertEq(krw.balanceOf(platform), 30_000e18);
        assertEq(krw.balanceOf(address(offering)), 0); // raised == committed, nothing left
        assertEq(uint8(offering.phase()), uint8(IOffering.Phase.Settled));
    }

    /// Mode A cannot settle under target — it must go down the refund path.
    function test_Settle_ModeA_RevertUnderTarget() public {
        Offering modeA = newOffering(IOffering.RefundMode.AllOrNothing);
        commitAs(modeA, fan1, 100_000e18); // << R
        (,, uint256 deadline,,,) = modeA.params();
        vm.warp(deadline);
        vm.expectRevert(IOffering.TargetNotReached.selector);
        modeA.settle(bytes32(0), 10e18, 100_000e18, bytes32(0));
    }

    // ------------------------------------------------------------------
    // claim — proofs, double claim, accounting caps (D2)
    // ------------------------------------------------------------------

    function _settleSingle(uint256 alloc, uint256 refundAmt) internal returns (uint256 totalSold) {
        commitAs(offering, fan1, 300_000e18);
        _warpPastDeadline();
        totalSold = 30e18;
        offering.settle(leafFor(fan1, alloc, refundAmt), totalSold, 300_000e18 - refundAmt, bytes32(0));
    }

    function test_Claim_RevertBeforeSettle() public {
        vm.prank(fan1);
        vm.expectRevert(IOffering.NotSettled.selector);
        offering.claim(1e18, 0, new bytes32[](0));
    }

    function test_Claim_HappyPathWithRefund() public {
        _settleSingle(30e18, 10_000e18); // raised 290k, 10k refundable
        vm.prank(fan1);
        offering.claim(30e18, 10_000e18, new bytes32[](0));
        assertEq(offering.token().balanceOf(fan1), 30e18);
        assertEq(krw.balanceOf(fan1), 10_000e18);
        assertTrue(offering.hasClaimed(fan1));
    }

    function test_Claim_RevertInvalidProof() public {
        _settleSingle(30e18, 0);
        vm.prank(fan1);
        vm.expectRevert(IOffering.InvalidProof.selector);
        offering.claim(31e18, 0, new bytes32[](0)); // wrong leaf values
    }

    function test_Claim_RevertDouble() public {
        _settleSingle(30e18, 0);
        vm.startPrank(fan1);
        offering.claim(30e18, 0, new bytes32[](0));
        vm.expectRevert(abi.encodeWithSelector(IOffering.AlreadyClaimed.selector, fan1));
        offering.claim(30e18, 0, new bytes32[](0));
        vm.stopPrank();
    }

    /// D2: a manipulated root cannot pull more tokens than totalSold.
    function test_Claim_TokenCapBlocksManipulatedRoot() public {
        commitAs(offering, fan1, 300_000e18);
        _warpPastDeadline();
        uint256 totalSold = 30e18;
        // Malicious root allocates totalSold + 1 to fan1 — settle sanity can't see
        // inside the root, but the claim-side cap must catch it.
        offering.settle(leafFor(fan1, totalSold + 1, 0), totalSold, 300_000e18, bytes32(0));
        vm.prank(fan1);
        vm.expectRevert(IOffering.AccountingCapExceeded.selector);
        offering.claim(totalSold + 1, 0, new bytes32[](0));
    }

    /// D2: a manipulated root cannot pull more payment than totalCommitted − totalRaised.
    function test_Claim_RefundCapBlocksManipulatedRoot() public {
        commitAs(offering, fan1, 300_000e18);
        _warpPastDeadline();
        // raised 290k → only 10k legitimately refundable; root claims 10k + 1
        offering.settle(leafFor(fan1, 29e18, 10_000e18 + 1), 29e18, 290_000e18, bytes32(0));
        vm.prank(fan1);
        vm.expectRevert(IOffering.AccountingCapExceeded.selector);
        offering.claim(29e18, 10_000e18 + 1, new bytes32[](0));
    }

    // ------------------------------------------------------------------
    // refund paths (D3)
    // ------------------------------------------------------------------

    function test_EnableRefunds_ModeA_UnderTarget() public {
        Offering modeA = newOffering(IOffering.RefundMode.AllOrNothing);
        commitAs(modeA, fan1, 100_000e18);
        (,, uint256 deadline,,,) = modeA.params();

        // before deadline: no
        vm.expectRevert(IOffering.DeadlineNotReached.selector);
        modeA.enableRefunds();

        vm.warp(deadline);
        vm.prank(fan2); // anyone can call
        modeA.enableRefunds();
        assertEq(uint8(modeA.phase()), uint8(IOffering.Phase.Refunding));

        // full pull refund
        vm.prank(fan1);
        modeA.refund();
        assertEq(krw.balanceOf(fan1), 100_000e18);
        assertEq(modeA.committed(fan1), 0);

        // double refund
        vm.prank(fan1);
        vm.expectRevert(IOffering.NothingToRefund.selector);
        modeA.refund();
    }

    function test_EnableRefunds_RevertWhenTargetMet() public {
        Offering modeA = newOffering(IOffering.RefundMode.AllOrNothing);
        // 4 wallets × 300k + 1 × 100k = 1.3M ≥ R
        commitAs(modeA, fan1, 300_000e18);
        commitAs(modeA, fan2, 300_000e18);
        commitAs(modeA, makeAddr("fan3"), 300_000e18);
        commitAs(modeA, makeAddr("fan4"), 100_000e18);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(IOffering.TargetReached.selector);
        modeA.enableRefunds();
    }

    function test_EnableRefunds_RevertModeB() public {
        commitAs(offering, fan1, 100_000e18);
        _warpPastDeadline();
        vm.expectRevert(IOffering.RefundNotAvailable.selector);
        offering.enableRefunds();
    }

    function test_EmergencyRefund_TimeoutBoundary() public {
        commitAs(offering, fan1, 100_000e18);
        (,, uint256 deadline,,,) = offering.params();
        vm.warp(deadline + 7 days - 1);
        vm.expectRevert(IOffering.SettleTimeoutNotReached.selector);
        offering.emergencyRefund();
        vm.warp(deadline + 7 days);
        vm.prank(fan2); // anyone
        offering.emergencyRefund();
        vm.prank(fan1);
        offering.refund();
        assertEq(krw.balanceOf(fan1), 100_000e18);
    }

    function test_EmergencyRefund_BlocksLateSettle() public {
        commitAs(offering, fan1, 300_000e18);
        (,, uint256 deadline,,,) = offering.params();
        vm.warp(deadline + 7 days);
        offering.emergencyRefund();
        vm.expectRevert(abi.encodeWithSelector(IOffering.InvalidPhase.selector, IOffering.Phase.Refunding));
        offering.settle(leafFor(fan1, 30e18, 0), 30e18, 300_000e18, bytes32(0));
    }

    function test_Refund_RevertWhenNotRefunding() public {
        commitAs(offering, fan1, 100_000e18);
        vm.prank(fan1);
        vm.expectRevert(IOffering.RefundNotAvailable.selector);
        offering.refund();
    }

    // ------------------------------------------------------------------
    // phase()
    // ------------------------------------------------------------------

    function test_PhaseProgression() public {
        assertEq(uint8(offering.phase()), uint8(IOffering.Phase.Open));
        (,, uint256 deadline,,,) = offering.params();
        vm.warp(deadline - 2 hours);
        assertEq(uint8(offering.phase()), uint8(IOffering.Phase.Frozen));
        vm.warp(deadline + 1);
        assertEq(uint8(offering.phase()), uint8(IOffering.Phase.Frozen)); // awaiting settle
    }

    // ------------------------------------------------------------------
    // fuzz: 불변식 3 — committed(w) ≤ L under arbitrary commit sequences
    // ------------------------------------------------------------------

    function testFuzz_WalletLimitNeverExceeded(uint256 a, uint256 b, uint256 c) public {
        a = bound(a, MIN_COMMIT, WALLET_LIMIT);
        b = bound(b, 1, WALLET_LIMIT);
        c = bound(c, 1, WALLET_LIMIT);
        commitAs(offering, fan1, a);
        uint256[2] memory tops = [b, c];
        for (uint256 i = 0; i < 2; i++) {
            vm.startPrank(fan1);
            krw.faucet(tops[i]);
            krw.approve(address(offering), tops[i]);
            if (offering.committed(fan1) + tops[i] > WALLET_LIMIT) {
                vm.expectRevert(
                    abi.encodeWithSelector(
                        IOffering.OverWalletLimit.selector, fan1, offering.committed(fan1) + tops[i], WALLET_LIMIT
                    )
                );
                offering.commit(tops[i]);
            } else {
                offering.commit(tops[i]);
            }
            vm.stopPrank();
        }
        assertLe(offering.committed(fan1), WALLET_LIMIT);
    }
}
