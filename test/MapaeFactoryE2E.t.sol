// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IOffering} from "../src/interfaces/IOffering.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {Offering} from "../src/Offering.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {RedeemManager} from "../src/RedeemManager.sol";
import {MapaeFactoryTestBase} from "./MapaeFactory.t.sol";

/// @notice Full submission-scope E2E through the factory:
///         createOffering → oversubscribed commits → settle (allocation fixture)
///         → claims → redeem → mode A failure → re-issue.
contract MapaeFactoryE2ETest is MapaeFactoryTestBase {
    string internal json;

    function test_E2E_FullLifecycle() public {
        // ---- create (via factory, by a Dojang-verified creator) ----
        (Offering offering, MembershipToken token, RedeemManager rm) = createAs(creator);

        // ---- oversubscribed commits (fixture: 1.1M vs R = 1M) ----
        json = vm.readFile("test/fixtures/oversub.json");
        address[] memory fans = vm.parseJsonAddressArray(json, "$.participants");
        uint256[] memory commits = vm.parseJsonUintArray(json, "$.commits");
        uint256[] memory allocations = vm.parseJsonUintArray(json, "$.allocations");
        uint256[] memory refunds = vm.parseJsonUintArray(json, "$.refunds");
        for (uint256 i = 0; i < fans.length; i++) {
            commitAs(offering, fans[i], commits[i]);
        }
        assertEq(offering.totalCommitted(), 1_100_000e18);

        // ---- settle by the platform ops wallet (this test) ----
        vm.warp(block.timestamp + 24 hours);
        offering.settle(
            vm.parseJsonBytes32(json, "$.root"),
            vm.parseJsonUint(json, "$.totalSold"),
            vm.parseJsonUint(json, "$.totalRaised"),
            vm.parseJsonBytes32(json, "$.seed")
        );

        // ---- everyone claims ----
        for (uint256 i = 0; i < fans.length; i++) {
            vm.prank(fans[i]);
            offering.claim(
                allocations[i], refunds[i], vm.parseJsonBytes32Array(json, string.concat("$.proofs_", vm.toString(i)))
            );
            assertEq(token.balanceOf(fans[i]), allocations[i]);
        }

        // ---- redeem: creator posts a perk, a winner burns for it ----
        vm.prank(creator);
        rm.createRedeemable(1, 5e18, 10, 0);
        // fans[0] holds ≥ 20 tokens in every lottery outcome (equal share)
        vm.startPrank(fans[0]);
        token.approve(address(rm), 5e18);
        rm.redeem(1);
        vm.stopPrank();
        assertEq(token.balanceOf(fans[0]), allocations[0] - 5e18);
        (,,, uint256 claimCount,) = rm.redeemables(1);
        assertEq(claimCount, 1);

        // ---- one live token: creator1 cannot issue again ----
        vm.warp(1_750_000_000);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.ActiveOfferingExists.selector, creator, address(offering)));
        factory.createOffering(defaultCreateParams());

        // ---- creator2: mode A failure → slot freed → re-issue succeeds ----
        (Offering failed, MembershipToken failedToken,) = createAs(creator2);
        commitAs(failed, makeAddr("lonelyFan"), 50_000e18); // << R
        vm.warp(block.timestamp + 24 hours);
        failed.enableRefunds();
        vm.prank(makeAddr("lonelyFan"));
        failed.refund();
        assertEq(failedToken.totalSupply(), 0);

        vm.warp(1_750_000_000);
        (Offering retry,,) = createAs(creator2);
        assertEq(factory.offeringsByCreator(creator2).length, 2);
        assertEq(retry.creator(), creator2);
    }
}
