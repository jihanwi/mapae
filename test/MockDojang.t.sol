// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

contract MockDojangTest is Test {
    MockDojang internal dojang;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    function setUp() public {
        vm.prank(owner);
        dojang = new MockDojang();
    }

    function test_DefaultUnverified() public view {
        assertFalse(dojang.isVerified(alice));
    }

    function test_SetVerified() public {
        vm.prank(owner);
        dojang.setVerified(alice, true);
        assertTrue(dojang.isVerified(alice));
        assertFalse(dojang.isVerified(bob));
    }

    function test_SetVerified_Revoke() public {
        vm.startPrank(owner);
        dojang.setVerified(alice, true);
        dojang.setVerified(alice, false);
        vm.stopPrank();
        assertFalse(dojang.isVerified(alice));
    }

    function test_SetVerified_RevertNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        dojang.setVerified(alice, true);
    }

    function test_SetVerifiedBatch() public {
        address[] memory accounts = new address[](3);
        accounts[0] = alice;
        accounts[1] = bob;
        accounts[2] = carol;

        vm.prank(owner);
        dojang.setVerifiedBatch(accounts);

        assertTrue(dojang.isVerified(alice));
        assertTrue(dojang.isVerified(bob));
        assertTrue(dojang.isVerified(carol));
    }

    function test_SetVerifiedBatch_RevertNonOwner() public {
        address[] memory accounts = new address[](1);
        accounts[0] = alice;

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        dojang.setVerifiedBatch(accounts);
    }
}
