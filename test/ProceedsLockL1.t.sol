// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {ProceedsLockDeployer} from "../src/ProceedsLockDeployer.sol";
import {ProceedsLock} from "../src/ProceedsLock.sol";
import {Offering} from "../src/Offering.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MapaeFactoryTestBase} from "./MapaeFactory.t.sol";
import {TESTNET_PROCEEDS_BAND} from "./utils/ProceedsDefaults.sol";

/// @notice Decision 56 (C-T2): optional sponsorship, the issuer-proceeds lock band, the settle
///         split (total conserved, platform never above its cut), ProceedsLock release schedule
///         and who can move the locked funds, and the end-to-end flow with and without sponsorship.
contract ProceedsLockL1Test is MapaeFactoryTestBase {
    uint16 internal constant BPS = 10_000;
    address internal fanA = makeAddr("fanA");
    address internal fanB = makeAddr("fanB");
    address internal fanC = makeAddr("fanC");
    address internal fanD = makeAddr("fanD");

    function setUp() public override {
        super.setUp();
        // The deployment band (30% max upfront) instead of the permissive pre-56 test band.
        factory = new MapaeFactory(
            IDojang(address(dojang)),
            IERC20(address(krw)),
            address(this),
            poolFactory,
            feeRouter,
            buybackVault,
            MIN_RAISE,
            MapaeFactory.FeeRecipients({platform: platform}),
            MapaeFactory.Guide({
                minPrice: 1000e18,
                maxPrice: 100_000e18,
                minRaise: 500_000e18,
                maxRaise: 500_000_000e18,
                minWalletLimitBps: 10,
                maxWalletLimitBps: 3000
            }),
            TESTNET_PROCEEDS_BAND(),
            new ProceedsLockDeployer(),
            address(0) // decision 62: no settler
        );
    }

    function l1(uint16 upfront, uint64 dur, uint64 cliff, bool sponsor)
        internal
        view
        returns (MapaeFactory.CreateParams memory cp)
    {
        cp = defaultCreateParams();
        cp.proceedsUpfrontBps = upfront;
        cp.proceedsLockDuration = dur;
        cp.proceedsLockCliff = cliff;
        cp.withSponsorship = sponsor;
    }

    function create(MapaeFactory.CreateParams memory cp) internal returns (Offering) {
        vm.prank(creator);
        (address o,,) = factory.createOffering(cp);
        return Offering(o);
    }

    /// @dev Four fans fill the raise target exactly (wallet limit 30%), then settle.
    function fillAndSettle(Offering o) internal returns (uint256 totalRaised) {
        commitAs(o, fanA, 300_000e18);
        commitAs(o, fanB, 300_000e18);
        commitAs(o, fanC, 300_000e18);
        commitAs(o, fanD, 100_000e18);
        vm.warp(o.deadline());
        uint256 sold = RAISE * 1e18 / PRICE;
        totalRaised = sold * PRICE / 1e18;
        o.settle(bytes32(uint256(1)), sold, totalRaised, bytes32(0));
    }

    // ------------------------------------------------------------------
    // 1. Optional sponsorship
    // ------------------------------------------------------------------

    function test_NoSponsorship_ZeroAddress_NoBurner_Event() public {
        vm.recordLogs();
        Offering o = create(l1(3000, 365 days, 30 days, false));
        assertEq(factory.sponsorshipOf(address(o)), address(0));
        assertFalse(factory.isBurner(address(0)));
        assertTrue(factory.redeemManagerOf(address(o)) != address(0), "RedeemManager always deployed");
        address lock = factory.proceedsLockOf(address(o));
        assertTrue(lock != address(0));
        assertEq(o.proceedsLock(), lock);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("OfferingCreated(address,address,address,address,address,address,address)");
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != sig) continue;
            found = true;
            (address rm, address vesting, address sp, address pl) =
                abi.decode(logs[i].data, (address, address, address, address));
            assertEq(rm, factory.redeemManagerOf(address(o)));
            assertEq(vesting, factory.vestingOf(address(o)));
            assertEq(sp, address(0), "event sponsorship = 0");
            assertEq(pl, lock, "event proceedsLock");
        }
        assertTrue(found);
    }

    function test_WithSponsorship_AsBefore() public {
        Offering o = create(l1(3000, 365 days, 30 days, true));
        address sp = factory.sponsorshipOf(address(o));
        assertTrue(sp != address(0));
        assertTrue(factory.isBurner(sp));
    }

    // ------------------------------------------------------------------
    // 2. Band checks
    // ------------------------------------------------------------------

    function test_Band_ExposedAndImmutable() public view {
        MapaeFactory.ProceedsBand memory b = factory.proceedsBand();
        assertEq(b.maxUpfrontBps, 3000);
        assertEq(b.minLockDuration, 1 hours);
        assertEq(b.maxLockDuration, 1095 days);
        assertEq(b.maxLockCliff, 180 days);
    }

    function test_Band_BoundariesPass() public {
        create(l1(3000, 1 hours, 0, false)); // max upfront, min duration
        vm.warp(block.timestamp + 1);
        dojang.setVerified(creator2, true);
        vm.prank(creator2);
        factory.createOffering(l1(0, 1095 days, 180 days, true)); // max duration, max cliff
        address c3 = makeAddr("c3");
        dojang.setVerified(c3, true);
        vm.prank(c3);
        factory.createOffering(l1(1500, 2 hours, 2 hours, false)); // cliff == duration
    }

    function test_Band_OutOfBandReverts() public {
        uint16[5] memory up = [uint16(3001), 3000, 3000, 3000, 3000];
        uint64[5] memory dur = [uint64(365 days), 1 hours - 1, 1095 days + 1, 365 days, 2 hours];
        uint64[5] memory cl = [uint64(0), 0, 0, 180 days + 1, 2 hours + 1];
        for (uint256 i; i < 5; i++) {
            vm.prank(creator);
            vm.expectRevert(MapaeFactory.ProceedsLockOutOfBand.selector);
            factory.createOffering(l1(up[i], dur[i], cl[i], false));
        }
    }

    function test_Band_L0MustBeZero() public {
        MapaeFactory.CreateParams memory cp = l0CreateParams();
        cp.proceedsUpfrontBps = 1;
        vm.prank(creator);
        vm.expectRevert(MapaeFactory.ProceedsLockOutOfBand.selector);
        factory.createOffering(cp);
        cp.proceedsUpfrontBps = 0;
        cp.proceedsLockDuration = 1 days;
        vm.prank(creator);
        vm.expectRevert(MapaeFactory.ProceedsLockOutOfBand.selector);
        factory.createOffering(cp);
        cp.proceedsLockDuration = 0;
        cp.proceedsLockCliff = 1;
        vm.prank(creator);
        vm.expectRevert(MapaeFactory.ProceedsLockOutOfBand.selector);
        factory.createOffering(cp);
        cp.proceedsLockCliff = 0;
        vm.prank(creator);
        (address o,,) = factory.createOffering(cp);
        assertEq(factory.proceedsLockOf(o), address(0), "L0 has no lock");
        assertEq(Offering(o).proceedsLock(), address(0));
    }

    function test_Band_ConstructorValidation() public {
        MapaeFactory.ProceedsBand memory bad = TESTNET_PROCEEDS_BAND();
        bad.maxUpfrontBps = 10_001;
        _expectBadBand(bad);
        bad = TESTNET_PROCEEDS_BAND();
        bad.minLockDuration = 0;
        _expectBadBand(bad);
        bad = TESTNET_PROCEEDS_BAND();
        bad.minLockDuration = bad.maxLockDuration + 1;
        _expectBadBand(bad);
    }

    function _expectBadBand(MapaeFactory.ProceedsBand memory band) internal {
        MapaeFactory.Guide memory g = MapaeFactory.Guide(1000e18, 100_000e18, 500_000e18, 500_000_000e18, 10, 3000);
        ProceedsLockDeployer d = new ProceedsLockDeployer();
        MapaeFactory.FeeRecipients memory r = MapaeFactory.FeeRecipients({platform: platform});
        vm.expectRevert(MapaeFactory.InvalidProceedsBand.selector);
        new MapaeFactory(
            IDojang(address(dojang)),
            IERC20(address(krw)),
            address(this),
            poolFactory,
            feeRouter,
            buybackVault,
            MIN_RAISE,
            r,
            g,
            band,
            d,
            address(0) // decision 62: no settler
        );
    }

    function test_Offering_L0WithLockRejected() public {
        IOffering.OfferingParams memory p = defaultParams(IOffering.RefundMode.AllOrNothing);
        p.tier = IFeeRouter.UtilityTier.L0;
        p.fBps = 7000;
        p.creatorTokenBps = 500;
        p.swapRoyaltyBps = 20;
        p.swapBurnBps = 0;
        p.proceedsLock = makeAddr("lock");
        vm.expectRevert(IOffering.InvalidConfig.selector);
        new Offering(p);
        p = defaultParams(IOffering.RefundMode.AllOrNothing);
        p.proceedsUpfrontBps = 10_001;
        vm.expectRevert(IOffering.InvalidConfig.selector);
        new Offering(p);
    }

    // ------------------------------------------------------------------
    // 3. Settle split
    // ------------------------------------------------------------------

    function testFuzz_Split_ConservesTotal(uint16 upfrontBps, uint64 dur, uint64 cliff) public {
        upfrontBps = uint16(bound(upfrontBps, 0, 3000));
        dur = uint64(bound(dur, 1 hours, 1095 days));
        cliff = uint64(bound(cliff, 0, dur < 180 days ? dur : 180 days));
        Offering o = create(l1(upfrontBps, dur, cliff, upfrontBps % 2 == 0));
        address lock = o.proceedsLock();
        uint256 creatorBefore = krw.balanceOf(creator);
        uint256 platformBefore = krw.balanceOf(platform);

        uint256 totalRaised = fillAndSettle(o);

        uint256 platformGot = krw.balanceOf(platform) - platformBefore;
        uint256 upfront = krw.balanceOf(creator) - creatorBefore;
        uint256 locked = krw.balanceOf(lock);
        uint256 krwSeed = krw.balanceOf(address(o.pool()));
        assertEq(platformGot + krwSeed + upfront + locked, totalRaised, "total conserved");
        uint256 creatorProceeds = totalRaised - krwSeed - platformGot;
        assertLe(upfront, creatorProceeds * 3000 / BPS, "upfront within the band");
        assertEq(upfront, creatorProceeds * upfrontBps / BPS, "upfront rounds down");
        assertLe(platformGot, totalRaised * o.offeringFeeBps() / BPS, "platform never above its cut");
        assertEq(krw.balanceOf(address(o)), 0, "offering keeps no proceeds (no refunds in a full raise)");
    }

    function test_Split_EmitsProceedsDistributed() public {
        Offering o = create(l1(2500, 365 days, 30 days, false));
        commitAs(o, fanA, 300_000e18);
        commitAs(o, fanB, 300_000e18);
        commitAs(o, fanC, 300_000e18);
        commitAs(o, fanD, 100_000e18);
        vm.warp(o.deadline());
        uint256 sold = RAISE * 1e18 / PRICE;
        vm.recordLogs();
        o.settle(bytes32(uint256(1)), sold, RAISE, bytes32(0));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("ProceedsDistributed(uint256,uint256,uint256,address)");
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != sig) continue;
            found = true;
            (uint256 plat, uint256 up, uint256 lk, address lock) =
                abi.decode(logs[i].data, (uint256, uint256, uint256, address));
            assertEq(lock, o.proceedsLock());
            assertEq(krw.balanceOf(lock), lk);
            assertEq(plat, RAISE * o.offeringFeeBps() / BPS);
            assertEq(up, (up + lk) * 2500 / BPS);
        }
        assertTrue(found);
    }

    // ------------------------------------------------------------------
    // 4. ProceedsLock schedule and access
    // ------------------------------------------------------------------

    function _lockFunded(uint64 dur, uint64 cliff) internal returns (Offering o, ProceedsLock lock, uint256 locked) {
        o = create(l1(3000, dur, cliff, false));
        lock = ProceedsLock(payable(o.proceedsLock()));
        fillAndSettle(o);
        locked = krw.balanceOf(address(lock));
    }

    function test_Lock_Schedule() public {
        uint64 dur = 360 days;
        uint64 cliff = 90 days;
        (Offering o, ProceedsLock lock, uint256 locked) = _lockFunded(dur, cliff);
        address token = address(krw);
        uint256 start = o.deadline();
        assertEq(lock.start(), start);
        assertEq(lock.duration(), dur);
        assertEq(lock.cliff(), start + cliff);
        assertEq(lock.owner(), creator);

        // before the cliff: nothing
        vm.warp(start + cliff - 1);
        assertEq(lock.releasable(token), 0);
        // during: at most linear
        vm.warp(start + 180 days);
        uint256 linear = locked * 180 days / dur;
        assertLe(lock.releasable(token), linear);
        assertEq(lock.releasable(token), linear);
        uint256 before = krw.balanceOf(creator);
        lock.release(token);
        assertEq(krw.balanceOf(creator) - before, linear);
        // end: all
        vm.warp(start + dur);
        lock.release(token);
        assertEq(krw.balanceOf(address(lock)), 0);
        assertEq(krw.balanceOf(creator) - before, locked);
    }

    function test_Lock_OnlyIssuerEverReceives() public {
        (Offering o, ProceedsLock lock, uint256 locked) = _lockFunded(30 days, 0);
        vm.warp(o.deadline() + 30 days);
        address[3] memory callers = [factory.owner(), platform, makeAddr("anyone")];
        // (callers are computed before any prank / expectRevert)
        uint256 creatorBefore = krw.balanceOf(creator);
        for (uint256 i; i < 3; i++) {
            uint256 callerBefore = krw.balanceOf(callers[i]);
            vm.prank(callers[i]);
            lock.release(address(krw)); // permissionless, but always pays the beneficiary
            assertEq(krw.balanceOf(callers[i]), callerBefore, "caller got nothing");
            vm.prank(callers[i]);
            vm.expectRevert(ProceedsLock.BeneficiaryFixed.selector);
            lock.transferOwnership(callers[i]);
        }
        assertEq(krw.balanceOf(creator) - creatorBefore, locked, "all of it went to the issuer");
        // nobody, the issuer included, can redirect or strand the lock
        vm.prank(creator);
        vm.expectRevert(ProceedsLock.BeneficiaryFixed.selector);
        lock.transferOwnership(makeAddr("other"));
        vm.prank(creator);
        vm.expectRevert(ProceedsLock.BeneficiaryFixed.selector);
        lock.renounceOwnership();
        assertEq(lock.owner(), creator);
    }

    function test_Lock_RefusesEther() public {
        (, ProceedsLock lock,) = _lockFunded(30 days, 0);
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(lock).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_Lock_EmptyAfterRefund() public {
        Offering o = create(l1(3000, 365 days, 0, false));
        commitAs(o, fanA, 100_000e18); // below target (all-or-nothing)
        vm.warp(o.deadline());
        o.enableRefunds();
        vm.prank(fanA);
        o.refund();
        assertEq(krw.balanceOf(o.proceedsLock()), 0);
    }

    // ------------------------------------------------------------------
    // 5. End to end, with and without sponsorship
    // ------------------------------------------------------------------

    function _e2e(bool sponsor) internal {
        Offering o = create(l1(3000, 365 days, 30 days, sponsor));
        MembershipToken token = o.token();
        ProceedsLock lock = ProceedsLock(payable(o.proceedsLock()));
        uint256 creatorBefore = krw.balanceOf(creator);
        uint256 totalRaised = fillAndSettle(o);
        uint256 platformGot = totalRaised * o.offeringFeeBps() / BPS;
        uint256 creatorProceeds = totalRaised - krw.balanceOf(address(o.pool())) - platformGot;
        uint256 upfront = creatorProceeds * 3000 / BPS;
        assertEq(krw.balanceOf(creator) - creatorBefore, upfront, "upfront at settle");
        assertEq(krw.balanceOf(address(lock)), creatorProceeds - upfront, "rest locked");
        assertGt(token.totalSupply(), 0);

        vm.warp(o.deadline() + 30 days - 1);
        assertEq(lock.releasable(address(krw)), 0, "cliff");
        vm.warp(o.deadline() + 365 days);
        lock.release(address(krw));
        assertEq(krw.balanceOf(creator) - creatorBefore, creatorProceeds, "all of it by the end");
        assertEq(factory.sponsorshipOf(address(o)) != address(0), sponsor);
    }

    function test_E2E_WithoutSponsorship() public {
        _e2e(false);
    }

    function test_E2E_WithSponsorship() public {
        _e2e(true);
    }

    function test_Owner_HasNoPathToLockedFunds() public {
        (, ProceedsLock lock, uint256 locked) = _lockFunded(365 days, 0);
        // the factory owner has no function touching the lock; the lock's only "owner" is the issuer
        assertTrue(factory.owner() != creator);
        assertEq(lock.owner(), creator);
        address platformOwner = factory.owner();
        vm.prank(platformOwner);
        vm.expectRevert(ProceedsLock.BeneficiaryFixed.selector);
        lock.transferOwnership(platformOwner);
        assertEq(krw.balanceOf(address(lock)), locked);
    }
}
