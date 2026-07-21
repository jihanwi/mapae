// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MembershipToken} from "../src/MembershipToken.sol";

/// @notice Unit tests for the token's mint-once + transfer-gate mechanics.
///         The test contract itself plays the offering (sole minter).
contract MembershipTokenTest is Test {
    MembershipToken internal token;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal exemptRecipient = makeAddr("exemptRecipient");

    uint256 internal constant LOCK_DURATION = 3 days;
    uint16 internal constant CAP_BPS = 300; // 3%

    function setUp() public {
        vm.warp(1_750_000_000);
        address[] memory exempt = new address[](1);
        exempt[0] = exemptRecipient;
        token = new MembershipToken("Creator Membership", "CRTM", address(this), LOCK_DURATION, CAP_BPS, exempt);
    }

    function _mintDefault() internal {
        // 1000 tokens: 900 to this contract (offering role), 100 to exempt recipient.
        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        to[0] = address(this);
        amounts[0] = 900e18;
        to[1] = exemptRecipient;
        amounts[1] = 100e18;
        token.mintAllocations(to, amounts);
    }

    function test_InitialState() public view {
        assertEq(token.minter(), address(this));
        assertEq(token.offering(), address(this));
        assertFalse(token.transfersEnabled());
        assertEq(token.totalSupply(), 0);
        assertEq(token.holdingCap(), 0);
        assertEq(token.transferLockUntil(), 0);
    }

    function test_MintAllocations_OnlyMinter() public {
        address[] memory to = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        to[0] = alice;
        amounts[0] = 1e18;
        vm.prank(alice);
        vm.expectRevert(MembershipToken.NotMinter.selector);
        token.mintAllocations(to, amounts);
    }

    function test_MintAllocations_LengthMismatch() public {
        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](1);
        vm.expectRevert(MembershipToken.LengthMismatch.selector);
        token.mintAllocations(to, amounts);
    }

    /// 불변식 5: mint authority is revoked forever after the single mint.
    function test_MintAllocations_OnceOnly() public {
        _mintDefault();
        assertEq(token.minter(), address(0));
        address[] memory to = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        to[0] = alice;
        amounts[0] = 1e18;
        vm.expectRevert(MembershipToken.NotMinter.selector);
        token.mintAllocations(to, amounts);
    }

    function test_MintAllocations_ActivatesGates() public {
        _mintDefault();
        assertTrue(token.transfersEnabled());
        assertEq(token.transferLockUntil(), block.timestamp + LOCK_DURATION);
        assertEq(token.holdingCap(), 1000e18 * uint256(CAP_BPS) / 10_000); // 30 tokens
        assertEq(token.totalSupply(), 1000e18);
    }

    /// 불변식 9: no transfer of any kind before settlement mint.
    function test_TransfersBlockedBeforeMint() public {
        vm.prank(alice);
        vm.expectRevert(MembershipToken.TransfersNotEnabled.selector);
        token.transfer(bob, 0);
    }

    function test_TransferLock_BlocksHolders() public {
        _mintDefault();
        // offering (this) sends alice tokens — offering is lock-exempt (claim path)
        token.transfer(alice, 10e18);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MembershipToken.TransferLocked.selector, block.timestamp + LOCK_DURATION)
        );
        token.transfer(bob, 1e18);
    }

    function test_TransferLock_BurnAllowed() public {
        _mintDefault();
        token.transfer(alice, 10e18);
        vm.prank(alice);
        token.burn(4e18); // redeem path must stay open during lock
        assertEq(token.balanceOf(alice), 6e18);
        assertEq(token.totalSupply(), 996e18);
    }

    function test_TransferLock_ExpiresAfterDuration() public {
        _mintDefault();
        token.transfer(alice, 10e18);
        vm.warp(block.timestamp + LOCK_DURATION);
        vm.prank(alice);
        token.transfer(bob, 1e18);
        assertEq(token.balanceOf(bob), 1e18);
    }

    /// 불변식 3(옵션): secondary-market transfers must respect the holding cap.
    function test_HoldingCap_BlocksExcess() public {
        _mintDefault();
        uint256 cap = token.holdingCap(); // 30 tokens
        vm.warp(block.timestamp + LOCK_DURATION);
        token.transfer(alice, cap + 10e18); // claim payout path (from == offering): exempt
        vm.startPrank(alice);
        token.transfer(bob, cap); // bob exactly at cap: ok
        assertEq(token.balanceOf(bob), cap);
        vm.expectRevert(abi.encodeWithSelector(MembershipToken.OverHoldingCap.selector, bob, cap + 1, cap));
        token.transfer(bob, 1);
        vm.stopPrank();
    }

    /// M2 PM 결정: claim payouts (from == offering) bypass the cap — primary
    /// allocations are already bounded by the KYC'd wallet limit L, and a mode B
    /// undersell could otherwise make cap < allocation and brick claims.
    function test_HoldingCap_ClaimPayoutsExempt() public {
        _mintDefault();
        uint256 cap = token.holdingCap();
        token.transfer(alice, cap + 50e18); // over cap, straight from the offering
        assertEq(token.balanceOf(alice), cap + 50e18);
    }

    function test_HoldingCap_ExemptAddressesBypass() public {
        _mintDefault();
        vm.warp(block.timestamp + LOCK_DURATION);
        token.transfer(exemptRecipient, 200e18); // way over cap, but exempt
        assertEq(token.balanceOf(exemptRecipient), 300e18);
    }

    function test_BurnFrom_UsesAllowance() public {
        _mintDefault();
        token.transfer(alice, 10e18);
        vm.prank(alice);
        token.approve(bob, 5e18);
        vm.prank(bob);
        token.burnFrom(alice, 5e18);
        assertEq(token.balanceOf(alice), 5e18);
    }

    function test_NoGatesWhenDisabled() public {
        // lock 0 / cap 0 token: only the pre-mint transfer block applies.
        MembershipToken free = new MembershipToken("Free", "FREE", address(this), 0, 0, new address[](0));
        address[] memory to = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        to[0] = address(this);
        amounts[0] = 100e18;
        free.mintAllocations(to, amounts);
        free.transfer(alice, 50e18);
        vm.prank(alice);
        free.transfer(bob, 50e18); // no lock, no cap
        assertEq(free.balanceOf(bob), 50e18);
    }
}
