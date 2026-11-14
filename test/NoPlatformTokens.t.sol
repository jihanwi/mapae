// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {Offering} from "../src/Offering.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {RedeemManager} from "../src/RedeemManager.sol";
import {Sponsorship} from "../src/Sponsorship.sol";
import {MapaeFactoryTestBase} from "./MapaeFactory.t.sol";

/// @notice Decision 21 (MAPAE v3 / Phase 1 / T10): the platform never receives the issued token,
///         and the remainder share (+ LP-seed surplus) is burned at settle. N1..N5.
contract NoPlatformTokensTest is MapaeFactoryTestBase {
    bytes32 internal constant TRANSFER_SIG = keccak256("Transfer(address,address,uint256)");
    bytes32 internal constant UNSOLD_SIG = keccak256("UnsoldBurned(uint256)");
    bytes32 internal constant REMAINDER_SIG = keccak256("RemainderBurned(uint256)");

    address internal fan = makeAddr("npFan");

    function _params(IFeeRouter.UtilityTier tier) internal view returns (MapaeFactory.CreateParams memory cp) {
        cp = tier == IFeeRouter.UtilityTier.L0 ? l0CreateParams() : defaultCreateParams();
        cp.tier = tier;
        cp.refundMode = IOffering.RefundMode.Partial;
    }

    /// @dev Create, commit `amount` from one fan, settle selling floor(amount / P).
    function _createAndSettle(IFeeRouter.UtilityTier tier, uint256 amount)
        internal
        returns (Offering o, MembershipToken t, uint256 totalSold)
    {
        MapaeFactory.CreateParams memory cp = _params(tier);
        amount = bound(amount, cp.minCommit, cp.walletLimit);
        address who = tier == IFeeRouter.UtilityTier.L2 ? creator2 : creator;
        vm.prank(who);
        (address oa, address ta,) = factory.createOffering(cp);
        o = Offering(oa);
        t = MembershipToken(ta);
        commitAs(o, fan, amount);
        vm.warp(o.deadline());
        totalSold = amount * 1e18 / cp.price;
        uint256 totalRaised = totalSold * cp.price / 1e18;
        o.settle(leafFor(fan, totalSold, amount - totalRaised), totalSold, totalRaised, bytes32(uint256(7)));
    }

    function _tier(uint8 raw) internal pure returns (IFeeRouter.UtilityTier) {
        return IFeeRouter.UtilityTier(raw % 3);
    }

    // N1 circulating supply right after settle = sold + creator + pool seed (rest burned)
    function testFuzz_N1_SupplyAfterSettle(uint8 tierRaw, uint256 amount) public {
        IFeeRouter.UtilityTier tier = _tier(tierRaw);
        (Offering o, MembershipToken t, uint256 totalSold) = _createAndSettle(tier, amount);
        address pool = address(o.pool());
        uint256 seeded = pool == address(0) ? 0 : t.balanceOf(pool);
        uint256 creatorAmt = t.balanceOf(factory.vestingOf(address(o)));
        uint256 supply = totalSold * 10_000 / o.fBps();

        assertEq(creatorAmt, supply * o.creatorTokenBps() / 10_000, "creator share");
        assertEq(t.totalSupply(), totalSold + creatorAmt + seeded, "N1 circulating");
        // everything else of S' (remainder + LP surplus) and all unsold are gone
        uint256 remainder = supply - totalSold - creatorAmt - supply * o.lpTokenBps() / 10_000;
        uint256 lpSurplus = supply * o.lpTokenBps() / 10_000 - seeded;
        assertEq(supply - t.totalSupply(), remainder + lpSurplus, "N1 burned share");
        assertEq(t.balanceOf(platform), 0);
        assertEq(t.balanceOf(treasury), 0);
        assertEq(t.balanceOf(reserve), 0);
    }

    // N2 mixed lifecycle: platform + treasury never hold the issued token
    function testFuzz_N2_PlatformNeverHoldsToken(uint256[8] memory seeds) public {
        (Offering o, MembershipToken t, uint256 totalSold) = _createAndSettle(IFeeRouter.UtilityTier.L1, WALLET_LIMIT);
        vm.prank(fan);
        o.claim(totalSold, 0, new bytes32[](0));
        MapaePool pool = o.pool();
        RedeemManager rm = RedeemManager(factory.redeemManagerOf(address(o)));
        Sponsorship sp = Sponsorship(factory.sponsorshipOf(address(o)));

        vm.prank(creator);
        rm.createPaidDrop(1, 10_000e18, 0, 0);
        vm.startPrank(fan);
        krw.approve(address(pool), type(uint256).max);
        krw.approve(address(sp), type(uint256).max);
        krw.approve(address(rm), type(uint256).max);
        t.approve(address(pool), type(uint256).max);
        t.approve(address(sp), type(uint256).max);
        vm.stopPrank();
        krw.approve(address(buybackVault), type(uint256).max);

        for (uint256 i; i < seeds.length; ++i) {
            uint256 op = seeds[i] % 6;
            uint256 amt = bound(seeds[i] >> 8, 1e18, 50_000e18);
            if (op == 0) {
                vm.startPrank(fan);
                krw.faucet(amt);
                pool.swapQuoteForToken(amt, 0, fan);
                vm.stopPrank();
            } else if (op == 1) {
                uint256 bal = t.balanceOf(fan);
                if (bal > 1e15) {
                    vm.prank(fan);
                    pool.swapTokenForQuote(bal / 4, 0, fan);
                }
            } else if (op == 2) {
                uint256 s = bound(amt, 1e18, 2000e18); // stay inside the sponsor burn-buy slippage guard
                vm.startPrank(fan);
                krw.faucet(s);
                sp.sponsorKRWs(s, "n2");
                vm.stopPrank();
            } else if (op == 3) {
                uint256 bal = t.balanceOf(fan);
                if (bal > 1e15) {
                    vm.prank(fan);
                    sp.sponsorToken(bal / 10, "n2");
                }
            } else if (op == 4) {
                vm.startPrank(fan);
                krw.faucet(10_000e18);
                rm.purchaseDrop(1);
                vm.stopPrank();
            } else {
                krw.faucet(amt);
                buybackVault.topUp(address(t), amt);
                buybackVault.executeBuyback(address(t), amt, 0);
            }
            assertEq(t.balanceOf(platform), 0, "N2 platform");
            assertEq(t.balanceOf(feeRouter.platformTreasury()), 0, "N2 treasury");
        }
    }

    // N3 right after settle only offering / vesting / pool hold tokens (dEaD holds LP only)
    function test_N3_HoldersAfterSettle() public {
        MapaeFactory.CreateParams memory cp = _params(IFeeRouter.UtilityTier.L1);
        vm.prank(creator);
        (address oa, address ta,) = factory.createOffering(cp);
        Offering o = Offering(oa);
        MembershipToken t = MembershipToken(ta);
        commitAs(o, fan, WALLET_LIMIT);
        vm.warp(o.deadline());
        uint256 sold = WALLET_LIMIT * 1e18 / cp.price;

        vm.recordLogs();
        o.settle(leafFor(fan, sold, 0), sold, WALLET_LIMIT, bytes32(uint256(7)));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        address vesting = factory.vestingOf(oa);
        address pool = address(o.pool());
        uint256 holders;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != ta || logs[i].topics[0] != TRANSFER_SIG) continue;
            address to = address(uint160(uint256(logs[i].topics[2])));
            if (to == address(0)) continue;
            assertTrue(to == oa || to == vesting || to == pool, "unexpected token recipient");
        }
        if (t.balanceOf(oa) > 0) holders++;
        if (t.balanceOf(vesting) > 0) holders++;
        if (t.balanceOf(pool) > 0) holders++;
        assertEq(holders, 3);
        assertEq(t.balanceOf(oa) + t.balanceOf(vesting) + t.balanceOf(pool), t.totalSupply());
        MapaePool p = MapaePool(pool);
        assertEq(t.balanceOf(p.DEAD()), 0, "dEaD holds no issued token");
        assertEq(p.balanceOf(p.DEAD()), p.totalSupply(), "dEaD holds all LP");
    }

    // N4 feasibility: Σ shares > 100% reverts; exactly 100% settles with remainder = rounding only
    function test_N4_FeasibilityBoundary() public {
        IOffering.OfferingParams memory p = defaultParams(IOffering.RefundMode.Partial);
        p.walletLimit = RAISE;
        p.fBps = 7000;
        p.cBps = 1500; // lp = 1050
        p.creatorTokenBps = 1951; // 7000 + 1951 + 1050 = 10001
        vm.expectRevert(IOffering.InvalidConfig.selector);
        new Offering(p);

        p.creatorTokenBps = 1950; // exactly 100%
        Offering o = new Offering(p);
        commitAs(o, fan, RAISE);
        vm.warp(p.deadline);
        uint256 sold = 70_001e15; // odd amount to exercise rounding
        uint256 raised = sold * PRICE / 1e18;
        vm.recordLogs();
        o.settle(leafFor(fan, sold, RAISE - raised), sold, raised, bytes32(0));
        (, uint256 remainderBurned) = _burnTotals(vm.getRecordedLogs(), address(o));
        // remainder + LP surplus are pure bps rounding: a few wei at most
        assertLe(remainderBurned, 10, "rounding only");
    }

    // N5 RemainderBurned + UnsoldBurned == Σ Transfer(→0x0) during settle
    function testFuzz_N5_BurnEventsReconcile(uint8 tierRaw, uint256 amount) public {
        IFeeRouter.UtilityTier tier = _tier(tierRaw);
        MapaeFactory.CreateParams memory cp = _params(tier);
        amount = bound(amount, cp.minCommit, cp.walletLimit);
        address who = tier == IFeeRouter.UtilityTier.L2 ? creator2 : creator;
        vm.prank(who);
        (address oa, address ta,) = factory.createOffering(cp);
        Offering o = Offering(oa);
        commitAs(o, fan, amount);
        vm.warp(o.deadline());
        uint256 sold = amount * 1e18 / cp.price;
        uint256 raised = sold * cp.price / 1e18;

        vm.recordLogs();
        o.settle(leafFor(fan, sold, amount - raised), sold, raised, bytes32(0));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (uint256 unsold, uint256 remainder) = _burnTotals(logs, oa);
        uint256 burnedByTransfer;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == ta && logs[i].topics[0] == TRANSFER_SIG && logs[i].topics[2] == bytes32(0)) {
                burnedByTransfer += abi.decode(logs[i].data, (uint256));
            }
        }
        assertEq(unsold + remainder, burnedByTransfer, "N5 reconcile");
        assertEq(unsold, o.qSale() - sold);
        assertGt(remainder, 0, "default presets always burn a remainder");
    }

    function _burnTotals(Vm.Log[] memory logs, address offering)
        internal
        pure
        returns (uint256 unsold, uint256 remainder)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != offering) continue;
            if (logs[i].topics[0] == UNSOLD_SIG) unsold += abi.decode(logs[i].data, (uint256));
            else if (logs[i].topics[0] == REMAINDER_SIG) remainder += abi.decode(logs[i].data, (uint256));
        }
    }
}
