// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MembershipToken} from "../src/MembershipToken.sol";

/// @notice v3 decision A: during the transfer lock only offering(curve)-facing transfers pass;
///         the offering can end the lock at graduation (MAPAE v3 / Phase 1 / T5), L1..L4.
///         The test contract plays the offering.
contract MembershipTokenCurveLockTest is Test {
    uint256 internal constant LOCK = 3650 days;

    MembershipToken internal token;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal pool = makeAddr("pool");

    function setUp() public {
        vm.warp(1_750_000_000);
        token = _mint(LOCK);
        token.registerPool(pool);
    }

    function _mint(uint256 lock) internal returns (MembershipToken t) {
        t = new MembershipToken("Curve Token", "CRV", address(this), lock, 0, new address[](0));
        address[] memory to = new address[](4);
        uint256[] memory amounts = new uint256[](4);
        (to[0], amounts[0]) = (address(this), 1000e18);
        (to[1], amounts[1]) = (alice, 100e18);
        (to[2], amounts[2]) = (bob, 100e18);
        (to[3], amounts[3]) = (pool, 100e18);
        t.mintAllocations(to, amounts);
    }

    // L1 lock: holder→holder blocked, offering→holder ok, holder→offering ok, burn ok
    function test_L1_LockAllowsOnlyCurveFacingTransfers() public {
        uint256 until = token.transferLockUntil();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MembershipToken.TransferLocked.selector, until));
        token.transfer(bob, 1e18);

        assertTrue(token.transfer(alice, 1e18)); // offering → holder

        vm.prank(alice);
        assertTrue(token.transfer(address(this), 2e18)); // holder → offering (sell back to curve)

        vm.prank(alice);
        token.burn(1e18);
        assertEq(token.balanceOf(alice), 98e18);
    }

    // L2 only the offering ends the lock; afterwards holders transfer freely
    function test_L2_EndTransferLockOfferingOnly() public {
        vm.prank(alice);
        vm.expectRevert(MembershipToken.NotOffering.selector);
        token.endTransferLock();

        vm.expectEmit(false, false, false, true, address(token));
        emit MembershipToken.TransferLockEnded(block.timestamp);
        token.endTransferLock();
        assertEq(token.transferLockUntil(), block.timestamp);

        vm.prank(alice);
        assertTrue(token.transfer(bob, 1e18));
        assertEq(token.balanceOf(bob), 101e18);
    }

    // L3 no-op when there is no lock or it already ended
    function test_L3_EndTransferLockNoOp() public {
        MembershipToken unlocked = _mint(0);
        vm.recordLogs();
        unlocked.endTransferLock();
        assertEq(unlocked.transferLockUntil(), 0);
        assertEq(vm.getRecordedLogs().length, 0);

        MembershipToken expired = _mint(1 days);
        uint256 until = expired.transferLockUntil();
        vm.warp(until + 1);
        vm.recordLogs();
        expired.endTransferLock();
        assertEq(expired.transferLockUntil(), until);
        assertEq(vm.getRecordedLogs().length, 0);

        token.endTransferLock();
        uint256 ended = token.transferLockUntil();
        vm.warp(block.timestamp + 10);
        vm.recordLogs();
        token.endTransferLock();
        assertEq(token.transferLockUntil(), ended);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    // L4 fuzz: during the lock a transfer passes iff from ∈ {offering, pool} or to == offering
    //    (mints/burns always pass and are covered by L1 / mintAllocations).
    function testFuzz_L4_LockMatrix(uint8 fromIdx, uint8 toIdx, address randomTo, uint256 amount) public {
        vm.assume(randomTo != address(0));
        address[4] memory parties = [address(this), pool, alice, bob];
        address from = parties[fromIdx % 4];
        address to = toIdx % 5 == 4 ? randomTo : parties[toIdx % 5];
        amount = bound(amount, 0, 1e18);

        bool shouldPass = from == address(this) || from == pool || to == address(this);
        uint256 until = token.transferLockUntil();
        vm.prank(from);
        if (!shouldPass) {
            vm.expectRevert(abi.encodeWithSelector(MembershipToken.TransferLocked.selector, until));
        }
        token.transfer(to, amount);
    }
}
