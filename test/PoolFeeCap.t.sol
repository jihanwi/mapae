// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {Offering} from "../src/Offering.sol";
import {OfferingTestBase} from "./utils/OfferingTestBase.sol";

/// @notice Decision 28 (T11): pool total swap fee hard caps — router share (platform + lp)
///         + pool share (royalty + burn) ≤ 100 bps on L0 and ≤ 150 bps on L1/L2. F1..F6
///         (F7 — curve-graduated pool totalFeeBps == 100 — is CurveSale.t.sol test_C10).
contract PoolFeeCapTest is OfferingTestBase {
    MembershipToken internal tok = MembershipToken(makeAddr("token"));

    function _pool(IFeeRouter.UtilityTier tier, uint16 royalty, uint16 burn) internal returns (MapaePool) {
        return new MapaePool(tok, IERC20(address(krw)), creator, feeRouter, tier, address(0), royalty, burn);
    }

    function _f(uint16 off, uint16 plat, uint16 roy, uint16 burn, uint16 lp, uint16 merch)
        internal
        pure
        returns (IFeeRouter.TierFees memory)
    {
        return IFeeRouter.TierFees(off, plat, roy, burn, lp, merch);
    }

    // F1 any accepted L0 schedule keeps every L0 pool (royalty 0..30) at ≤ 100 bps
    function testFuzz_F1_L0PoolCap(uint16 off, uint16 plat, uint16 roy, uint16 burn, uint16 lp, uint16 royalty) public {
        MapaePool pool = _pool(IFeeRouter.UtilityTier.L0, uint16(bound(royalty, 0, 30)), 0);
        IFeeRouter.TierFees memory f = _f(
            uint16(bound(off, 0, 500)),
            uint16(bound(plat, 0, 120)),
            uint16(bound(roy, 0, 120)),
            uint16(bound(burn, 0, 120)),
            uint16(bound(lp, 0, 120)),
            0
        );
        try feeRouter.setFees(IFeeRouter.UtilityTier.L0, f) {} catch {}
        assertLe(pool.totalFeeBps(), 100, "L0 pool > 100 bps");
    }

    // F2 any accepted premium schedule keeps every L1/L2 pool (royalty + burn ≤ 90) at ≤ 150 bps
    function testFuzz_F2_PremiumPoolCap(
        bool l2,
        uint16 plat,
        uint16 roy,
        uint16 burn,
        uint16 lp,
        uint16 poolRoyalty,
        uint16 poolBurn
    ) public {
        IFeeRouter.UtilityTier tier = l2 ? IFeeRouter.UtilityTier.L2 : IFeeRouter.UtilityTier.L1;
        uint16 r = uint16(bound(poolRoyalty, 0, 90));
        uint16 b = uint16(bound(poolBurn, 0, 90 - r));
        MapaePool pool = _pool(tier, r, b);
        IFeeRouter.TierFees memory f = _f(
            750,
            uint16(bound(plat, 0, 160)),
            uint16(bound(roy, 0, 160)),
            uint16(bound(burn, 0, 160)),
            uint16(bound(lp, 0, 160)),
            400
        );
        try feeRouter.setFees(tier, f) {} catch {}
        assertLe(pool.totalFeeBps(), 150, "premium pool > 150 bps");
    }

    // F3 L0 router share 80 + 20 rejected
    function test_F3_L0RouterShareOver70() public {
        vm.expectRevert(FeeRouter.OutOfBand.selector);
        feeRouter.setFees(IFeeRouter.UtilityTier.L0, _f(500, 80, 0, 0, 20, 0));
        vm.expectRevert(FeeRouter.OutOfBand.selector);
        feeRouter.setFees(IFeeRouter.UtilityTier.L0, _f(500, 40, 20, 0, 40, 0)); // router 80
        feeRouter.setFees(IFeeRouter.UtilityTier.L0, _f(500, 40, 30, 0, 30, 0)); // preset, router 70
    }

    // F4 L1 router share platform 60 + lp 20 rejected
    function test_F4_PremiumRouterShareOver60() public {
        vm.expectRevert(FeeRouter.OutOfBand.selector);
        feeRouter.setFees(IFeeRouter.UtilityTier.L1, _f(750, 60, 40, 30, 20, 400));
        vm.expectRevert(FeeRouter.OutOfBand.selector);
        feeRouter.setFees(IFeeRouter.UtilityTier.L2, _f(750, 60, 40, 30, 20, 300));
        feeRouter.setFees(IFeeRouter.UtilityTier.L1, _f(750, 40, 60, 30, 20, 400)); // preset, router 60
    }

    // F5 direct pool construction enforces the pool-share caps
    function test_F5_PoolShareOutOfBand() public {
        vm.expectRevert(MapaePool.PoolShareOutOfBand.selector);
        _pool(IFeeRouter.UtilityTier.L0, 0, 1);
        vm.expectRevert(MapaePool.PoolShareOutOfBand.selector);
        _pool(IFeeRouter.UtilityTier.L0, 31, 0);
        vm.expectRevert(MapaePool.PoolShareOutOfBand.selector);
        _pool(IFeeRouter.UtilityTier.L1, 80, 50);
        vm.expectRevert(MapaePool.PoolShareOutOfBand.selector);
        _pool(IFeeRouter.UtilityTier.L2, 60, 31);
        // edges pass
        assertEq(_pool(IFeeRouter.UtilityTier.L0, 30, 0).totalFeeBps(), 100);
        assertEq(_pool(IFeeRouter.UtilityTier.L1, 60, 30).totalFeeBps(), 150);
        assertEq(_pool(IFeeRouter.UtilityTier.L2, 90, 0).totalFeeBps(), 150);
    }

    // F6 Offering rejects L1 royalty + burn > 90 early
    function test_F6_OfferingPoolShareCap() public {
        IOffering.OfferingParams memory p = defaultParams(IOffering.RefundMode.AllOrNothing);
        p.swapRoyaltyBps = 80;
        p.swapBurnBps = 20;
        vm.expectRevert(IOffering.InvalidConfig.selector);
        new Offering(p);
        p.swapRoyaltyBps = 60;
        p.swapBurnBps = 30;
        Offering o = new Offering(p);
        assertEq(o.swapRoyaltyBps() + o.swapBurnBps(), 90);
    }
}
