// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IOffering} from "../src/interfaces/IOffering.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {Offering} from "../src/Offering.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {MapaeVesting} from "../src/MapaeVesting.sol";
import {Sponsorship} from "../src/Sponsorship.sol";
import {MapaeFactoryTestBase} from "./MapaeFactory.t.sol";

/// @notice M4 full-cycle E2E — the "three markets" on one stack:
///         발행 (offering → settle → at-par listing) → 유통 (AMM swaps) →
///         소비 (sponsorship burn + mini buyback) + creator vesting.
contract MapaeM4E2ETest is MapaeFactoryTestBase {
    function test_E2E_ThreeMarketsFullCycle() public {
        // ---- 발행: create → oversubscribe-ish commits → settle ----
        (Offering offering, MembershipToken token,) = createAs(creator);
        address fanA = makeAddr("fanA");
        address fanB = makeAddr("fanB");
        commitAs(offering, fanA, 300_000e18);
        commitAs(offering, fanB, 300_000e18);
        commitAs(offering, makeAddr("fanC"), 300_000e18);
        commitAs(offering, makeAddr("fanD"), 100_000e18); // total 1M = R
        vm.warp(block.timestamp + 24 hours);

        // single-leaf root: fanA gets 30 tokens (unit-style settle)
        offering.settle(leafFor(fanA, 30e18, 0), 100e18, 1_000_000e18, bytes32(0));

        // ---- 상장 검증: spot == P, LP locked at dEaD ----
        MapaePool pool = offering.pool();
        assertEq(pool.spotPrice(), PRICE);
        assertEq(pool.balanceOf(pool.DEAD()), pool.totalSupply());
        assertEq(token.pool(), address(pool));

        vm.prank(fanA);
        offering.claim(30e18, 0, new bytes32[](0));

        // ---- 유통: fan buys and sells on the AMM ----
        uint256 supplyBefore = token.totalSupply();
        vm.startPrank(fanB);
        krw.faucet(50_000e18);
        krw.approve(address(pool), 50_000e18);
        uint256 bought = pool.swapKrwForToken(50_000e18, 0, fanB);
        // 50k into a 150k-deep pool: ~3.7 tokens after 2% fee + real price impact
        assertGt(bought, 3.5e18);
        vm.stopPrank();

        vm.startPrank(fanA);
        token.approve(address(pool), 5e18);
        uint256 krwOut = pool.swapTokenForKrw(5e18, 0, fanA);
        assertGt(krwOut, 45_000e18);
        vm.stopPrank();
        // sell burned 0.5% of token input immediately
        assertLt(token.totalSupply(), supplyBefore);

        // ---- 소비: sponsorship (10% burn) + mini buyback ----
        // Sponsorship sized within the slippage band: the 10% burn buy (5k) must
        // stay under ~5% impact on the ~150k-deep pool — larger sponsorships
        // revert by design (§8-B ② guard, unit-tested separately).
        Sponsorship sponsorship = Sponsorship(factory.sponsorshipOf(address(offering)));
        supplyBefore = token.totalSupply();
        uint256 creatorKrwBefore = krw.balanceOf(creator);
        vm.startPrank(fanB);
        krw.faucet(50_000e18);
        krw.approve(address(sponsorship), 50_000e18);
        sponsorship.sponsorKRWs(50_000e18, unicode"마패 최고");
        vm.stopPrank();
        assertLt(token.totalSupply(), supplyBefore); // 10% burned via pool buy
        assertGe(krw.balanceOf(creator) - creatorKrwBefore, 45_000e18);

        // mini buyback: accrued KRW burn fees convert to a burn, anyone calls
        assertGt(pool.burnBuffer(), 0);
        supplyBefore = token.totalSupply();
        pool.convertAndBurn(0);
        assertLt(token.totalSupply(), supplyBefore);
        assertEq(pool.burnBuffer(), 0);

        // ---- 베스팅: nothing before cliff, linear after (불변식 6) ----
        MapaeVesting vesting = MapaeVesting(payable(factory.vestingOf(address(offering))));
        uint256 vested = token.balanceOf(address(vesting));
        assertGt(vested, 0); // creator allocation sits in vesting
        assertEq(vesting.releasable(address(token)), 0); // pre-cliff
        vm.warp(vesting.cliff());
        assertGt(vesting.releasable(address(token)), 0);
        vesting.release(address(token));
        assertGt(token.balanceOf(creator), 0);
        assertLt(token.balanceOf(creator), vested); // linear, not all at once
    }
}
