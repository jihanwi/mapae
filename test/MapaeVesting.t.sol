// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MapaeVesting} from "../src/MapaeVesting.sol";
import {MembershipToken} from "../src/MembershipToken.sol";

/// @notice Vesting unit tests (D10). 불변식 6: nothing moves before the cliff,
///         releases never exceed the linear schedule.
contract MapaeVestingTest is Test {
    MembershipToken internal token;
    MapaeVesting internal vesting;

    address internal creator = makeAddr("creator");
    uint64 internal start;
    uint64 internal constant DURATION = 1080 days; // 36mo
    uint64 internal constant CLIFF = 180 days; // 6mo
    uint256 internal constant ALLOCATION = 250e18;

    function setUp() public {
        vm.warp(1_750_000_000);
        start = uint64(block.timestamp + 1 days); // ≈ offering deadline
        vesting = new MapaeVesting(creator, start, DURATION, CLIFF);

        // Token minted straight to the vesting contract (as settle does).
        token = new MembershipToken("Creator Membership", "CRTM", address(this), 0, 0, new address[](0));
        address[] memory to = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        to[0] = address(vesting);
        amounts[0] = ALLOCATION;
        token.mintAllocations(to, amounts);
    }

    function test_Constructor_BeneficiaryAndSchedule() public view {
        assertEq(vesting.owner(), creator); // beneficiary = owner (OZ VestingWallet)
        assertEq(vesting.start(), start);
        assertEq(vesting.duration(), DURATION);
        assertEq(vesting.cliff(), start + CLIFF);
    }

    function test_Constructor_BandValidation() public {
        // duration below 12mo
        vm.expectRevert(MapaeVesting.InvalidVestingConfig.selector);
        new MapaeVesting(creator, start, 359 days, CLIFF);
        // duration above 48mo
        vm.expectRevert(MapaeVesting.InvalidVestingConfig.selector);
        new MapaeVesting(creator, start, 1441 days, CLIFF);
        // cliff below 3mo
        vm.expectRevert(MapaeVesting.InvalidVestingConfig.selector);
        new MapaeVesting(creator, start, DURATION, 89 days);
        // cliff beyond duration — OZ VestingWalletCliff's own check fires first
        // (base constructor order), which is equally fail-safe
        vm.expectRevert();
        new MapaeVesting(creator, start, 360 days, 361 days);
        // exact band edges pass
        new MapaeVesting(creator, start, 360 days, 90 days);
        new MapaeVesting(creator, start, 1440 days, 1440 days);
    }

    /// 불변식 6: zero releasable before the cliff.
    function test_NothingBeforeCliff() public {
        vm.warp(start + CLIFF - 1);
        assertEq(vesting.releasable(address(token)), 0);
        vesting.release(address(token)); // no-op, releases 0
        assertEq(token.balanceOf(creator), 0);
    }

    function test_LinearAfterCliff() public {
        // at the cliff: linear amount for elapsed time vests at once
        vm.warp(start + CLIFF);
        uint256 expected = ALLOCATION * CLIFF / DURATION;
        assertEq(vesting.releasable(address(token)), expected);

        vesting.release(address(token));
        assertEq(token.balanceOf(creator), expected);

        // halfway: cumulative 50%
        vm.warp(start + DURATION / 2);
        vesting.release(address(token));
        assertEq(token.balanceOf(creator), ALLOCATION / 2);

        // end: everything
        vm.warp(start + DURATION);
        vesting.release(address(token));
        assertEq(token.balanceOf(creator), ALLOCATION);
        assertEq(token.balanceOf(address(vesting)), 0);
    }

    /// 불변식 6: released amount can never exceed the linear schedule (fuzz).
    function testFuzz_ReleaseNeverExceedsSchedule(uint64 elapsed) public {
        elapsed = uint64(bound(elapsed, 0, DURATION * 2));
        vm.warp(uint256(start) + elapsed);
        vesting.release(address(token));
        uint256 schedule;
        if (elapsed < CLIFF) schedule = 0;
        else if (elapsed >= DURATION) schedule = ALLOCATION;
        else schedule = ALLOCATION * elapsed / DURATION;
        assertEq(token.balanceOf(creator), schedule);
        assertLe(token.balanceOf(creator), ALLOCATION);
    }

    /// The vesting contract has no path to move tokens other than release():
    /// even the beneficiary cannot pull unvested tokens.
    function test_NoBackdoor() public {
        vm.warp(start + CLIFF - 1);
        vm.startPrank(creator);
        vesting.release(address(token)); // releases 0 before cliff
        assertEq(token.balanceOf(creator), 0);
        vm.stopPrank();
        assertEq(token.balanceOf(address(vesting)), ALLOCATION);
    }
}
