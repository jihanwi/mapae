// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";

/// @notice FeeRouter band + preset tests. Covers invariant 6 (setFees reverts
///         outside band, incl. boundary ±1) and invariant 7 (L0 swap-platform
///         floor 60 is unreachable from below via any update path).
contract FeeRouterV2Test is Test {
    FeeRouter internal router;
    address internal treasury = makeAddr("treasury");
    address internal owner = address(this);

    function setUp() public {
        router = new FeeRouter(owner, treasury);
    }

    function _fees(uint16 off, uint16 plat, uint16 roy, uint16 burn, uint16 lp, uint16 merch)
        internal
        pure
        returns (IFeeRouter.TierFees memory)
    {
        return IFeeRouter.TierFees(off, plat, roy, burn, lp, merch);
    }

    // ------------------------------------------------------------------
    // presets
    // ------------------------------------------------------------------

    function test_InitialPresets() public view {
        IFeeRouter.TierFees memory l0 = router.getFees(IFeeRouter.UtilityTier.L0);
        assertEq(l0.offeringFeeBps, 500);
        assertEq(l0.swapPlatformBps, 60);
        assertEq(l0.swapRoyaltyBps, 20);
        assertEq(l0.swapBurnBps, 20);
        assertEq(l0.swapLpBps, 0);
        assertEq(l0.merchFeeBps, 0);

        IFeeRouter.TierFees memory l1 = router.getFees(IFeeRouter.UtilityTier.L1);
        assertEq(l1.offeringFeeBps, 750);
        assertEq(l1.swapPlatformBps, 40);
        assertEq(l1.swapRoyaltyBps, 60);
        assertEq(l1.swapBurnBps, 30);
        assertEq(l1.swapLpBps, 20);
        assertEq(l1.merchFeeBps, 400);

        assertEq(router.swapTotalBps(IFeeRouter.UtilityTier.L0), 100);
        assertEq(router.swapTotalBps(IFeeRouter.UtilityTier.L1), 150);
        assertEq(router.swapTotalBps(IFeeRouter.UtilityTier.L2), 150);
    }

    // ------------------------------------------------------------------
    // access control
    // ------------------------------------------------------------------

    function test_SetFees_OnlyOwner() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, makeAddr("rando")));
        router.setFees(IFeeRouter.UtilityTier.L1, _fees(750, 40, 60, 30, 20, 400));
    }

    function test_SetTreasury() public {
        address t2 = makeAddr("t2");
        router.setPlatformTreasury(t2);
        assertEq(router.platformTreasury(), t2);
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        router.setPlatformTreasury(address(0));
    }

    // ------------------------------------------------------------------
    // invariant 6: boundary ±1 on every band edge
    // ------------------------------------------------------------------

    function test_Band_L0_Boundaries() public {
        // swap platform floor 60: 59 reverts, 60 ok (sum stays in [80,100])
        _expectBand(IFeeRouter.UtilityTier.L0, _fees(500, 59, 21, 20, 0, 0));
        router.setFees(IFeeRouter.UtilityTier.L0, _fees(500, 60, 20, 20, 0, 0));
        // swap platform ceil 80: 81 reverts, 80 ok
        _expectBand(IFeeRouter.UtilityTier.L0, _fees(500, 81, 10, 9, 0, 0));
        router.setFees(IFeeRouter.UtilityTier.L0, _fees(500, 80, 10, 10, 0, 0)); // sum 100
        // swap sum band [80,100]: 79 reverts, 101 reverts
        _expectBand(IFeeRouter.UtilityTier.L0, _fees(500, 60, 10, 9, 0, 0)); // sum 79
        _expectBand(IFeeRouter.UtilityTier.L0, _fees(500, 60, 21, 20, 0, 0)); // sum 101
        // offering fee ceil 500: 501 reverts, 500 ok
        _expectBand(IFeeRouter.UtilityTier.L0, _fees(501, 60, 20, 20, 0, 0));
        router.setFees(IFeeRouter.UtilityTier.L0, _fees(500, 60, 20, 20, 0, 0));
        // L0 merch must be 0 ([Q1])
        _expectBand(IFeeRouter.UtilityTier.L0, _fees(500, 60, 20, 20, 0, 1));
    }

    function test_Band_Premium_Boundaries() public {
        // swap sum band [100,150]: 99 reverts, 151 reverts, edges ok
        _expectBand(IFeeRouter.UtilityTier.L1, _fees(750, 40, 30, 29, 0, 400)); // sum 99
        _expectBand(IFeeRouter.UtilityTier.L1, _fees(750, 60, 61, 30, 0, 400)); // sum 151
        router.setFees(IFeeRouter.UtilityTier.L1, _fees(750, 40, 30, 30, 0, 400)); // sum 100
        router.setFees(IFeeRouter.UtilityTier.L1, _fees(750, 60, 40, 30, 20, 400)); // sum 150
        // swap platform band [20,60]: 19 reverts, 61 reverts
        _expectBand(IFeeRouter.UtilityTier.L1, _fees(750, 19, 61, 30, 10, 400));
        _expectBand(IFeeRouter.UtilityTier.L1, _fees(750, 61, 40, 30, 19, 400));
        // offering fee band [500,1000]: 499 reverts, 1001 reverts, edges ok
        _expectBand(IFeeRouter.UtilityTier.L1, _fees(499, 40, 60, 30, 20, 400));
        _expectBand(IFeeRouter.UtilityTier.L1, _fees(1001, 40, 60, 30, 20, 400));
        router.setFees(IFeeRouter.UtilityTier.L1, _fees(500, 40, 60, 30, 20, 400));
        router.setFees(IFeeRouter.UtilityTier.L1, _fees(1000, 40, 60, 30, 20, 400));
        // merch ceil 500: 501 reverts, 500 ok
        _expectBand(IFeeRouter.UtilityTier.L1, _fees(750, 40, 60, 30, 20, 501));
        router.setFees(IFeeRouter.UtilityTier.L1, _fees(750, 40, 60, 30, 20, 500));
    }

    // ------------------------------------------------------------------
    // invariant 7: L0 swap-platform floor 60 unreachable from below (fuzz)
    // ------------------------------------------------------------------

    function testFuzz_L0_SwapPlatformFloor(uint16 platform, uint16 royalty, uint16 burn, uint16 lp) public {
        platform = uint16(bound(platform, 0, 200));
        royalty = uint16(bound(royalty, 0, 200));
        burn = uint16(bound(burn, 0, 200));
        lp = uint16(bound(lp, 0, 200));
        IFeeRouter.TierFees memory f = _fees(500, platform, royalty, burn, lp, 0);
        uint256 sum = uint256(platform) + royalty + burn + lp;
        bool inBand = platform >= 60 && platform <= 80 && sum >= 80 && sum <= 100;
        if (inBand) {
            router.setFees(IFeeRouter.UtilityTier.L0, f);
            // whatever is stored, the platform floor holds
            assertGe(router.getFees(IFeeRouter.UtilityTier.L0).swapPlatformBps, 60);
        } else {
            vm.expectRevert(FeeRouter.OutOfBand.selector);
            router.setFees(IFeeRouter.UtilityTier.L0, f);
        }
        // Regardless of the attempt, the stored L0 platform is never below 60.
        assertGe(router.getFees(IFeeRouter.UtilityTier.L0).swapPlatformBps, 60);
    }

    // ------------------------------------------------------------------
    // invariant 6: full-struct fuzz — stored fees ALWAYS satisfy the band
    // ------------------------------------------------------------------

    function testFuzz_SetFees_NeverEscapesBand(
        uint8 tierRaw,
        uint16 off,
        uint16 plat,
        uint16 roy,
        uint16 burn,
        uint16 lp,
        uint16 merch
    ) public {
        IFeeRouter.UtilityTier tier = IFeeRouter.UtilityTier(bound(tierRaw, 0, 2));
        off = uint16(bound(off, 0, 2000));
        plat = uint16(bound(plat, 0, 300));
        roy = uint16(bound(roy, 0, 300));
        burn = uint16(bound(burn, 0, 300));
        lp = uint16(bound(lp, 0, 300));
        merch = uint16(bound(merch, 0, 1000));
        try router.setFees(tier, _fees(off, plat, roy, burn, lp, merch)) {
            // Accepted → must be inside the band.
            IFeeRouter.TierFees memory s = router.getFees(tier);
            uint256 sum = uint256(s.swapPlatformBps) + s.swapRoyaltyBps + s.swapBurnBps + s.swapLpBps;
            if (tier == IFeeRouter.UtilityTier.L0) {
                assertTrue(s.swapPlatformBps >= 60 && s.swapPlatformBps <= 80);
                assertTrue(sum >= 80 && sum <= 100);
                assertTrue(s.offeringFeeBps <= 500);
                assertEq(s.merchFeeBps, 0);
            } else {
                assertTrue(sum >= 100 && sum <= 150);
                assertTrue(s.swapPlatformBps >= 20 && s.swapPlatformBps <= 60);
                assertTrue(s.offeringFeeBps >= 500 && s.offeringFeeBps <= 1000);
                assertTrue(s.merchFeeBps <= 500);
            }
        } catch {
            // Rejected → the previously stored (valid) fees are untouched.
        }
    }

    function _expectBand(IFeeRouter.UtilityTier tier, IFeeRouter.TierFees memory f) internal {
        vm.expectRevert(FeeRouter.OutOfBand.selector);
        router.setFees(tier, f);
    }
}
