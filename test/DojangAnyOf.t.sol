// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {DojangAnyOf} from "../src/DojangAnyOf.sol";

contract StubDojang is IDojang {
    mapping(address => bool) public verified;
    bool public down;

    function set(address account, bool v) external {
        verified[account] = v;
    }

    function setDown(bool d) external {
        down = d;
    }

    function isVerified(address account) external view returns (bool) {
        if (down) revert("stub: down");
        return verified[account];
    }
}

contract DojangAnyOfTest is Test {
    StubDojang internal a;
    StubDojang internal b;
    DojangAnyOf internal any;
    address internal alice = makeAddr("alice");

    function setUp() public {
        a = new StubDojang();
        b = new StubDojang();
        any = new DojangAnyOf(a, b);
    }

    function test_BothFalse_False() public view {
        assertFalse(any.isVerified(alice));
    }

    function test_OnlyA_True() public {
        a.set(alice, true);
        assertTrue(any.isVerified(alice));
    }

    function test_OnlyB_True() public {
        b.set(alice, true);
        assertTrue(any.isVerified(alice));
    }

    function test_ARevert_BTrue_True() public {
        a.setDown(true);
        b.set(alice, true);
        assertTrue(any.isVerified(alice));
    }

    function test_BRevert_ATrue_True() public {
        a.set(alice, true);
        b.setDown(true);
        assertTrue(any.isVerified(alice));
    }

    function test_BothRevert_False() public {
        a.setDown(true);
        b.setDown(true);
        assertFalse(any.isVerified(alice));
    }

    function test_ZeroAddress_Reverts() public {
        vm.expectRevert(DojangAnyOf.ZeroAddress.selector);
        new DojangAnyOf(IDojang(address(0)), b);
        vm.expectRevert(DojangAnyOf.ZeroAddress.selector);
        new DojangAnyOf(a, IDojang(address(0)));
    }
}
