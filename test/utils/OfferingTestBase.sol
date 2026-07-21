// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../../src/interfaces/IDojang.sol";
import {IOffering} from "../../src/interfaces/IOffering.sol";
import {Offering} from "../../src/Offering.sol";
import {MembershipToken} from "../../src/MembershipToken.sol";
import {MockKRW} from "../../src/mocks/MockKRW.sol";
import {MockDojang} from "../../src/mocks/MockDojang.sol";

/// @notice Shared scaffolding: mocks, default params, and participant helpers.
abstract contract OfferingTestBase is Test {
    uint256 internal constant PRICE = 10_000e18; // 10,000 KRWs per token
    uint256 internal constant RAISE = 1_000_000e18; // 1,000,000 KRWs
    uint256 internal constant WALLET_LIMIT = 300_000e18;
    uint256 internal constant MIN_COMMIT = 10_000e18;
    // Owner-confirmed default preset (2026-07-21): proceeds 75/15/10,
    // tokens 60/25/9/5/1 (sale/creator/LP/platform/reserve).
    uint16 internal constant F_BPS = 6000;
    uint16 internal constant C_BPS = 1500;
    uint16 internal constant CREATOR_TOKEN_BPS = 2500;

    MockKRW internal krw;
    MockDojang internal dojang;

    address internal creator = makeAddr("creator");
    address internal creatorVesting = makeAddr("creatorVesting");
    address internal lpEscrow = makeAddr("lpEscrow");
    address internal platform = makeAddr("platform");
    address internal reserve = makeAddr("reserve");

    function setUp() public virtual {
        vm.warp(1_750_000_000); // realistic clock so deadline math is sane
        krw = new MockKRW();
        dojang = new MockDojang();
    }

    function defaultParams(IOffering.RefundMode mode) internal view returns (IOffering.OfferingParams memory p) {
        p.paymentToken = IERC20(address(krw));
        p.dojang = IDojang(address(dojang));
        p.creator = creator;
        p.platformOwner = address(this); // tests act as the platform ops wallet
        p.tokenName = "Creator Membership";
        p.tokenSymbol = "CRTM";
        p.price = PRICE;
        p.raiseTarget = RAISE;
        p.deadline = block.timestamp + 24 hours;
        p.walletLimit = WALLET_LIMIT;
        p.minCommit = MIN_COMMIT;
        p.fBps = F_BPS;
        p.cBps = C_BPS;
        p.creatorTokenBps = CREATOR_TOKEN_BPS;
        p.refundMode = mode;
        p.transferLockDuration = 0;
        p.holdingCapBps = 0;
        p.recipients = IOffering.AllocationRecipients({
            creatorVesting: creatorVesting, lpEscrow: lpEscrow, platform: platform, reserve: reserve
        });
    }

    function newOffering(IOffering.RefundMode mode) internal returns (Offering) {
        return new Offering(defaultParams(mode));
    }

    /// @dev Verify, fund, approve, and commit in one go.
    function commitAs(Offering offering, address who, uint256 amount) internal {
        dojang.setVerified(who, true);
        vm.startPrank(who);
        krw.faucet(amount);
        krw.approve(address(offering), amount);
        offering.commit(amount);
        vm.stopPrank();
    }

    /// @dev Single-leaf Merkle "tree": root == leaf, proof == [] (valid under OZ MerkleProof).
    function leafFor(address account, uint256 allocation, uint256 refundAmount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, allocation, refundAmount))));
    }
}
