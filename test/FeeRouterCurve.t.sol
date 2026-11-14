// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {CurvePresets as P} from "../src/CurvePresets.sol";

/// @notice v3 curve fee schedule + L0 swap band 40-80 (MAPAE v3 / Phase 1 / T6), F1..F5.
contract FeeRouterCurveTest is Test {
    FeeRouter internal router;
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        router = new FeeRouter(address(this), treasury);
    }

    function _c(uint16 platform, uint16 dev, uint16 lpSeed) internal pure returns (IFeeRouter.CurveFees memory) {
        return IFeeRouter.CurveFees({platformBps: platform, devBps: dev, lpSeedBps: lpSeed});
    }

    function _expectOut(uint16 platform, uint16 dev, uint16 lpSeed) internal {
        vm.expectRevert(FeeRouter.OutOfBand.selector);
        router.setCurveFees(_c(platform, dev, lpSeed));
    }

    function _assertCurve(uint16 platform, uint16 dev, uint16 lpSeed) internal view {
        IFeeRouter.CurveFees memory f = router.getCurveFees();
        assertEq(f.platformBps, platform);
        assertEq(f.devBps, dev);
        assertEq(f.lpSeedBps, lpSeed);
    }

    // F1 initial curve fees (50, 35, 15), total 100
    function test_F1_InitialCurveFees() public view {
        _assertCurve(50, 35, 15);
        IFeeRouter.CurveFees memory f = router.getCurveFees();
        assertEq(uint256(f.platformBps) + f.devBps + f.lpSeedBps, 100);
    }

    // F2a boundaries ±1 for each component and for the total
    function test_F2_CurveBandBoundaries() public {
        // platform [40,60]
        _expectOut(39, 40, 20); // sum 99
        router.setCurveFees(_c(40, 40, 20)); // sum 100
        router.setCurveFees(_c(60, 20, 0)); // sum 80
        _expectOut(61, 20, 0); // sum 81
        // dev [20,40]
        _expectOut(60, 19, 20); // sum 99
        router.setCurveFees(_c(60, 20, 20)); // sum 100
        router.setCurveFees(_c(40, 40, 0)); // sum 80
        _expectOut(40, 41, 0); // sum 81
        // lpSeed [0,20]
        router.setCurveFees(_c(50, 35, 0)); // sum 85
        router.setCurveFees(_c(40, 20, 20)); // sum 80
        _expectOut(40, 20, 21); // sum 81
        // total [80,100]
        _expectOut(40, 20, 19); // sum 79
        router.setCurveFees(_c(40, 20, 20)); // sum 80
        router.setCurveFees(_c(60, 40, 0)); // sum 100
        _expectOut(60, 40, 1); // sum 101
        _assertCurve(60, 40, 0); // last accepted value stored
    }

    // F2b exhaustive fuzz: accepted iff inside every band; stored value always in band
    function testFuzz_F2_CurveBand(uint16 platform, uint16 dev, uint16 lpSeed) public {
        platform = uint16(bound(platform, 0, 120));
        dev = uint16(bound(dev, 0, 120));
        lpSeed = uint16(bound(lpSeed, 0, 120));
        uint256 sum = uint256(platform) + dev + lpSeed;
        bool inBand =
            platform >= 40 && platform <= 60 && dev >= 20 && dev <= 40 && lpSeed <= 20 && sum >= 80 && sum <= 100;
        if (inBand) {
            vm.expectEmit(false, false, false, true, address(router));
            emit FeeRouter.CurveFeesUpdated(router.getCurveFees(), _c(platform, dev, lpSeed));
            router.setCurveFees(_c(platform, dev, lpSeed));
            _assertCurve(platform, dev, lpSeed);
        } else {
            _expectOut(platform, dev, lpSeed);
            _assertCurve(50, 35, 15);
        }
    }

    // F3 onlyOwner
    function test_F3_OnlyOwner() public {
        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        router.setCurveFees(_c(50, 35, 15));
    }

    // F4 router presets == CurvePresets constants
    function test_F4_PresetsMatchCurvePresets() public view {
        IFeeRouter.CurveFees memory c = router.getCurveFees();
        assertEq(c.platformBps, P.CURVE_FEE_PLATFORM_BPS);
        assertEq(c.devBps, P.CURVE_FEE_DEV_BPS);
        assertEq(c.lpSeedBps, P.CURVE_FEE_LP_SEED_BPS);

        IFeeRouter.TierFees memory l0 = router.getFees(IFeeRouter.UtilityTier.L0);
        assertEq(l0.swapPlatformBps, P.SWAP_FEE_PLATFORM_BPS);
        assertEq(l0.swapRoyaltyBps, P.SWAP_FEE_DEV_BPS);
        assertEq(l0.swapLpBps, P.SWAP_FEE_LP_BPS);
        assertEq(l0.swapBurnBps, 0);
        assertEq(router.swapTotalBps(IFeeRouter.UtilityTier.L0), 100);
    }

    // F5 new L0 swap-platform floor: 39 reverts, 40 ok
    function test_F5_L0SwapPlatformFloor40() public {
        vm.expectRevert(FeeRouter.OutOfBand.selector);
        router.setFees(IFeeRouter.UtilityTier.L0, IFeeRouter.TierFees(500, 39, 31, 0, 30, 0));
        router.setFees(IFeeRouter.UtilityTier.L0, IFeeRouter.TierFees(500, 40, 30, 0, 30, 0));
        assertEq(router.getFees(IFeeRouter.UtilityTier.L0).swapPlatformBps, 40);
    }
}
