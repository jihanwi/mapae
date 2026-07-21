// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";

contract MockKRWTest is Test {
    MockKRW internal krw;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        krw = new MockKRW();
    }

    function test_Metadata() public view {
        assertEq(krw.name(), "Mock KRW Stable");
        assertEq(krw.symbol(), "KRWs");
        assertEq(krw.decimals(), 18);
    }

    function test_Faucet() public {
        vm.prank(alice);
        krw.faucet(1000e18);
        assertEq(krw.balanceOf(alice), 1000e18);
        assertEq(krw.totalSupply(), 1000e18);
    }

    function test_Faucet_AtCap() public {
        uint256 cap = krw.FAUCET_CAP();
        vm.prank(alice);
        krw.faucet(cap);
        assertEq(krw.balanceOf(alice), cap);
    }

    function test_Faucet_RevertOverCap() public {
        uint256 cap = krw.FAUCET_CAP();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MockKRW.FaucetCapExceeded.selector, cap + 1, cap));
        krw.faucet(cap + 1);
    }

    function test_Faucet_RepeatCallsAllowed() public {
        vm.startPrank(alice);
        krw.faucet(krw.FAUCET_CAP());
        krw.faucet(krw.FAUCET_CAP());
        vm.stopPrank();
        assertEq(krw.balanceOf(alice), 2 * krw.FAUCET_CAP());
    }

    function test_Transfer() public {
        vm.startPrank(alice);
        krw.faucet(1000e18);
        assertTrue(krw.transfer(bob, 400e18));
        vm.stopPrank();
        assertEq(krw.balanceOf(alice), 600e18);
        assertEq(krw.balanceOf(bob), 400e18);
    }

    function testFuzz_Faucet(uint256 amount) public {
        amount = bound(amount, 0, krw.FAUCET_CAP());
        vm.prank(alice);
        krw.faucet(amount);
        assertEq(krw.balanceOf(alice), amount);
    }
}
