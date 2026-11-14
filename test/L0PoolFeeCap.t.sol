// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IOffering} from "../src/interfaces/IOffering.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {Offering} from "../src/Offering.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {MapaeFactoryTestBase} from "./MapaeFactory.t.sol";

/// @notice v3 (T7 commit 1): L0 pools cap the total swap fee at 100 bps — burn share must be 0.
contract L0PoolFeeCapTest is MapaeFactoryTestBase {
    function testFuzz_L0BurnShareNonZeroReverts(uint16 burn) public {
        MapaeFactory.CreateParams memory cp = l0CreateParams();
        cp.swapBurnBps = uint16(bound(burn, 1, 50));
        vm.prank(creator);
        vm.expectRevert(IOffering.InvalidConfig.selector);
        factory.createOffering(cp);
    }

    function testFuzz_L0ListedPoolTotalFeeAtMost100(uint16 royalty) public {
        MapaeFactory.CreateParams memory cp = l0CreateParams();
        cp.swapRoyaltyBps = uint16(bound(royalty, 0, 30));
        vm.prank(creator);
        (address oa,,) = factory.createOffering(cp);
        Offering o = Offering(oa);

        commitAs(o, fan1, cp.raiseTarget);
        vm.warp(o.deadline());
        uint256 sold = cp.raiseTarget * 1e18 / cp.price;
        o.settle(leafFor(fan1, sold, 0), sold, cp.raiseTarget, bytes32(uint256(1)));

        MapaePool pool = o.pool();
        assertTrue(address(pool) != address(0));
        assertEq(pool.burnBps(), 0);
        assertLe(pool.totalFeeBps(), 100);
        assertEq(pool.totalFeeBps(), 40 + 30 + cp.swapRoyaltyBps);
    }
}
