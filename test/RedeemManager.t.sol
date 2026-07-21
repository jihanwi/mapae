// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IRedeemManager} from "../src/interfaces/IRedeemManager.sol";
import {RedeemManager} from "../src/RedeemManager.sol";
import {MembershipToken} from "../src/MembershipToken.sol";

/// @notice Unit tests for burn-to-redeem. The test contract plays the offering
///         (mints supply, distributes to fans).
contract RedeemManagerTest is Test {
    MembershipToken internal token;
    RedeemManager internal redeemManager;

    address internal creator = makeAddr("creator");
    address internal fan;
    uint256 internal fanKey;

    uint256 internal constant LOCK_DURATION = 30 days;
    uint256 internal constant BURN_AMOUNT = 2e18;

    function setUp() public {
        vm.warp(1_750_000_000);
        (fan, fanKey) = makeAddrAndKey("fan");
        // Token with an active transfer lock — redeeming must work through it.
        token = new MembershipToken("Creator Membership", "CRTM", address(this), LOCK_DURATION, 0, new address[](0));
        redeemManager = new RedeemManager(token, creator);

        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        to[0] = address(this);
        amounts[0] = 90e18;
        to[1] = fan;
        amounts[1] = 10e18;
        token.mintAllocations(to, amounts);
    }

    function _create(uint256 id, uint256 maxClaims, uint256 deadline) internal {
        vm.prank(creator);
        redeemManager.createRedeemable(id, BURN_AMOUNT, maxClaims, deadline);
    }

    // ------------------------------------------------------------------
    // createRedeemable
    // ------------------------------------------------------------------

    function test_Create_OnlyCreator() public {
        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(IRedeemManager.NotCreator.selector, fan));
        redeemManager.createRedeemable(1, BURN_AMOUNT, 0, 0);
    }

    function test_Create_RevertDuplicateId() public {
        _create(1, 0, 0);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(IRedeemManager.RedeemableExists.selector, 1));
        redeemManager.createRedeemable(1, BURN_AMOUNT, 0, 0);
    }

    function test_Create_RevertZeroBurn() public {
        vm.prank(creator);
        vm.expectRevert(IRedeemManager.ZeroBurnAmount.selector);
        redeemManager.createRedeemable(1, 0, 0, 0);
    }

    function test_Create_EmitsEvent() public {
        vm.prank(creator);
        vm.expectEmit(true, true, false, true);
        emit IRedeemManager.RedeemableCreated(7, creator, BURN_AMOUNT, 3, block.timestamp + 1 days);
        redeemManager.createRedeemable(7, BURN_AMOUNT, 3, block.timestamp + 1 days);
    }

    // ------------------------------------------------------------------
    // redeem
    // ------------------------------------------------------------------

    function test_Redeem_BurnsAndRecords() public {
        _create(1, 0, 0);
        vm.startPrank(fan);
        token.approve(address(redeemManager), BURN_AMOUNT);
        vm.expectEmit(true, true, false, true);
        emit IRedeemManager.Redeemed(1, fan, BURN_AMOUNT);
        redeemManager.redeem(1);
        vm.stopPrank();

        assertEq(token.balanceOf(fan), 10e18 - BURN_AMOUNT);
        assertEq(token.totalSupply(), 100e18 - BURN_AMOUNT); // burned, not moved
        (,,, uint256 claimCount,) = redeemManager.redeemables(1);
        assertEq(claimCount, 1);
    }

    /// Transfer lock is active in this setup — burns (redeem) must pass anyway.
    function test_Redeem_WorksDuringTransferLock() public {
        assertGt(token.transferLockUntil(), block.timestamp); // lock active
        vm.startPrank(fan);
        vm.expectRevert(); // regular transfer is locked...
        token.transfer(creator, 1e18);
        vm.stopPrank();

        _create(1, 0, 0);
        vm.startPrank(fan);
        token.approve(address(redeemManager), BURN_AMOUNT);
        redeemManager.redeem(1); // ...but redeeming still works
        vm.stopPrank();
        assertEq(token.balanceOf(fan), 10e18 - BURN_AMOUNT);
    }

    function test_Redeem_RevertUnknownId() public {
        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(IRedeemManager.UnknownRedeemable.selector, 99));
        redeemManager.redeem(99);
    }

    function test_Redeem_DeadlineBoundary() public {
        uint256 deadline = block.timestamp + 1 days;
        _create(1, 0, deadline);
        vm.startPrank(fan);
        token.approve(address(redeemManager), type(uint256).max);
        vm.warp(deadline); // exactly at deadline: still open
        redeemManager.redeem(1);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(IRedeemManager.RedeemClosed.selector, 1, deadline));
        redeemManager.redeem(1);
        vm.stopPrank();
    }

    function test_Redeem_MaxClaims() public {
        _create(1, 2, 0);
        vm.startPrank(fan);
        token.approve(address(redeemManager), type(uint256).max);
        redeemManager.redeem(1);
        redeemManager.redeem(1); // same wallet, multiple uses: allowed by design
        vm.expectRevert(abi.encodeWithSelector(IRedeemManager.MaxClaimsReached.selector, 1, 2));
        redeemManager.redeem(1);
        vm.stopPrank();
    }

    function test_Redeem_RevertWithoutAllowance() public {
        _create(1, 0, 0);
        vm.prank(fan);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(redeemManager), 0, BURN_AMOUNT
            )
        );
        redeemManager.redeem(1);
    }

    // ------------------------------------------------------------------
    // redeemWithPermit (EIP-2612)
    // ------------------------------------------------------------------

    function _signPermit(uint256 value, uint256 permitDeadline) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                fan,
                address(redeemManager),
                value,
                token.nonces(fan),
                permitDeadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(fanKey, digest);
    }

    function test_RedeemWithPermit_SingleTransaction() public {
        _create(1, 0, 0);
        uint256 permitDeadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(BURN_AMOUNT, permitDeadline);

        vm.prank(fan); // no prior approve — permit sets the allowance in-tx
        redeemManager.redeemWithPermit(1, permitDeadline, v, r, s);
        assertEq(token.balanceOf(fan), 10e18 - BURN_AMOUNT);
    }

    /// A griefed/used permit must not block redeeming when allowance already exists.
    function test_RedeemWithPermit_ToleratesFrontrunConsumedPermit() public {
        _create(1, 0, 0);
        uint256 permitDeadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(BURN_AMOUNT, permitDeadline);

        // Attacker consumes the permit directly (nonce spent).
        token.permit(fan, address(redeemManager), BURN_AMOUNT, permitDeadline, v, r, s);

        vm.prank(fan); // inner permit now fails, but allowance is set → redeem succeeds
        redeemManager.redeemWithPermit(1, permitDeadline, v, r, s);
        assertEq(token.balanceOf(fan), 10e18 - BURN_AMOUNT);
    }
}
