// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IOffering} from "../src/interfaces/IOffering.sol";
import {Offering} from "../src/Offering.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {OfferingTestBase} from "./utils/OfferingTestBase.sol";

/// @notice End-to-end tests driven by fixtures produced by script/allocation
///         (genfixtures.js). Solidity and the JS allocator must agree on the
///         Merkle root, or every claim here fails.
contract OfferingE2ETest is OfferingTestBase {
    struct Fixture {
        bytes32 root;
        bytes32 seed;
        uint256 totalSold;
        uint256 totalRaised;
        address[] participants;
        uint256[] commits;
        uint256[] allocations;
        uint256[] refunds;
    }

    string internal json;

    function _loadFixture(string memory name) internal returns (Fixture memory f) {
        json = vm.readFile(string.concat("test/fixtures/", name, ".json"));
        f.root = vm.parseJsonBytes32(json, "$.root");
        f.seed = vm.parseJsonBytes32(json, "$.seed");
        f.totalSold = vm.parseJsonUint(json, "$.totalSold");
        f.totalRaised = vm.parseJsonUint(json, "$.totalRaised");
        f.participants = vm.parseJsonAddressArray(json, "$.participants");
        f.commits = vm.parseJsonUintArray(json, "$.commits");
        f.allocations = vm.parseJsonUintArray(json, "$.allocations");
        f.refunds = vm.parseJsonUintArray(json, "$.refunds");
    }

    function _proofOf(uint256 i) internal view returns (bytes32[] memory) {
        return vm.parseJsonBytes32Array(json, string.concat("$.proofs_", vm.toString(i)));
    }

    function _commitAll(Offering offering, Fixture memory f) internal {
        for (uint256 i = 0; i < f.participants.length; i++) {
            commitAs(offering, f.participants[i], f.commits[i]);
        }
    }

    function _claimAll(Offering offering, Fixture memory f) internal {
        for (uint256 i = 0; i < f.participants.length; i++) {
            vm.prank(f.participants[i]);
            offering.claim(f.allocations[i], f.refunds[i], _proofOf(i));
        }
    }

    /// Oversubscribed mode A: 1.1M committed vs R=1M. Equal share + weighted
    /// lottery (computed off-chain), full settle, everyone claims.
    function test_E2E_Oversubscribed_ModeA() public {
        Fixture memory f = _loadFixture("oversub");
        Offering offering = newOffering(IOffering.RefundMode.AllOrNothing);
        MembershipToken token = offering.token();

        _commitAll(offering, f);
        assertEq(offering.totalCommitted(), 1_100_000e18);

        (,, uint256 deadline,,,) = offering.params();
        vm.warp(deadline);
        offering.settle(f.root, f.totalSold, f.totalRaised, f.seed);

        assertEq(f.totalSold, offering.qSale()); // fully sold
        assertEq(offering.seed(), f.seed); // seed recorded for public re-computation

        _claimAll(offering, f);

        // Every allocation and refund landed exactly as the allocator computed.
        uint256 sumAlloc;
        uint256 sumRefund;
        for (uint256 i = 0; i < f.participants.length; i++) {
            assertEq(token.balanceOf(f.participants[i]), f.allocations[i]);
            assertEq(krw.balanceOf(f.participants[i]), f.refunds[i]);
            sumAlloc += f.allocations[i];
            sumRefund += f.refunds[i];
        }
        assertEq(sumAlloc, f.totalSold);
        assertEq(sumRefund, offering.totalCommitted() - f.totalRaised); // 100k excess refunded

        // Offering fully drained: all sold tokens claimed, all payment distributed.
        assertEq(token.balanceOf(address(offering)), 0);
        assertEq(krw.balanceOf(address(offering)), 0);

        // Proceeds 75/15/10 of totalRaised (=R here).
        assertEq(krw.balanceOf(creator), 750_000e18);
        assertEq(krw.balanceOf(lpEscrow), 150_000e18);
        assertEq(krw.balanceOf(platform), 100_000e18);

        // Supply S' = totalSold / 0.6 with all shares minted (no unsold to burn).
        assertEq(token.totalSupply(), f.totalSold * 10_000 / F_BPS);
    }

    /// Undersubscribed mode B: 600k committed vs R=1M — sold portion issued,
    /// unsold burned at settle (불변식 10), zero refunds.
    function test_E2E_Undersubscribed_ModeB() public {
        Fixture memory f = _loadFixture("undersub");
        Offering offering = newOffering(IOffering.RefundMode.Partial);
        MembershipToken token = offering.token();

        _commitAll(offering, f);
        assertEq(offering.totalCommitted(), 600_000e18);

        (,, uint256 deadline,,,) = offering.params();
        vm.warp(deadline);

        uint256 unsold = offering.qSale() - f.totalSold; // 40 tokens
        vm.expectEmit(false, false, false, true);
        emit IOffering.UnsoldBurned(unsold);
        offering.settle(f.root, f.totalSold, f.totalRaised, f.seed);

        // S' = 60/0.6 = 100 tokens; unsold burned so it never circulates.
        assertEq(token.totalSupply(), 100e18);
        assertEq(token.balanceOf(creatorVesting), 25e18);
        assertEq(token.balanceOf(lpEscrow), 9e18); // l = c×f = 15% × 60% = 9%
        assertEq(token.balanceOf(platform), 5e18);
        assertEq(token.balanceOf(reserve), 1e18);

        _claimAll(offering, f);

        for (uint256 i = 0; i < f.participants.length; i++) {
            assertEq(token.balanceOf(f.participants[i]), f.allocations[i]);
            assertEq(krw.balanceOf(f.participants[i]), 0); // no refunds in this fixture
        }

        // 불변식 10: after settle + all claims, no unsold residue anywhere.
        assertEq(token.balanceOf(address(offering)), 0);
        assertEq(krw.balanceOf(address(offering)), 0);

        // Proceeds 75/15/10 of 600k.
        assertEq(krw.balanceOf(creator), 450_000e18);
        assertEq(krw.balanceOf(lpEscrow), 90_000e18);
        assertEq(krw.balanceOf(platform), 60_000e18);
    }

    /// Mode A undersubscribed: target missed → refunds, zero supply (불변식 4).
    function test_E2E_Undersubscribed_ModeA_FullRefund() public {
        Fixture memory f = _loadFixture("undersub");
        Offering offering = newOffering(IOffering.RefundMode.AllOrNothing);

        _commitAll(offering, f);
        (,, uint256 deadline,,,) = offering.params();
        vm.warp(deadline);

        offering.enableRefunds(); // anyone; on-chain verifiable fact
        for (uint256 i = 0; i < f.participants.length; i++) {
            vm.prank(f.participants[i]);
            offering.refund();
            assertEq(krw.balanceOf(f.participants[i]), f.commits[i]); // full deposit back
        }
        assertEq(offering.token().totalSupply(), 0); // no tokens ever issued
        assertEq(krw.balanceOf(address(offering)), 0);
    }
}
