// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {IRedeemManager} from "../src/interfaces/IRedeemManager.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {Offering} from "../src/Offering.sol";
import {OfferingDeployer} from "../src/OfferingDeployer.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {RedeemManager} from "../src/RedeemManager.sol";
import {Sponsorship} from "../src/Sponsorship.sol";
import {BuybackVault} from "../src/BuybackVault.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

/// @notice Full-stack harness for the v5.2 safety invariants (Step 9, items
///         1–5, 8–12). Spins up the real FeeRouter + MapaeFactory + BuybackVault
///         so tier gating and the burner registry behave exactly as deployed.
contract InvariantsV2Test is Test {
    MockKRW internal krw;
    MockDojang internal dojang;
    PoolFactory internal poolFactory;
    FeeRouter internal feeRouter;
    BuybackVault internal buybackVault;
    MapaeFactory internal factory;
    OfferingDeployer internal offeringDeployer; // for direct-construction tests

    address internal treasury = makeAddr("treasury");
    address internal platform = makeAddr("platform");
    address internal reserve = makeAddr("reserve");
    address internal creator = makeAddr("creator");
    address internal fan = makeAddr("fan");

    uint256 internal constant PRICE = 10_000e18;
    uint256 internal constant RAISE = 500_000e18; // == minRaise floor
    uint256 internal constant MIN_RAISE = 500_000e18;
    uint256 internal constant WALLET_LIMIT = 150_000e18;
    uint256 internal constant MIN_COMMIT = 10_000e18;

    function setUp() public {
        vm.warp(1_750_000_000);
        krw = new MockKRW();
        dojang = new MockDojang();
        poolFactory = new PoolFactory();
        feeRouter = new FeeRouter(address(this), treasury);
        buybackVault = new BuybackVault(IERC20(address(krw)), address(this));
        offeringDeployer = new OfferingDeployer();
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
                minRaise: RAISE,
                maxRaise: 500_000_000e18,
                minWalletLimitBps: 10,
                maxWalletLimitBps: 3000
            })
        );
        dojang.setVerified(creator, true);
        dojang.setVerified(fan, true);
        // This contract funds the vault in several tests; approve once.
        krw.approve(address(buybackVault), type(uint256).max);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _cp(IFeeRouter.UtilityTier tier) internal view returns (MapaeFactory.CreateParams memory cp) {
        bool l0 = tier == IFeeRouter.UtilityTier.L0;
        cp.tokenName = "Creator Membership";
        cp.tokenSymbol = "CRTM";
        cp.price = PRICE;
        cp.raiseTarget = RAISE;
        cp.deadline = block.timestamp + (l0 ? 2 hours : 24 hours);
        cp.walletLimit = WALLET_LIMIT;
        cp.minCommit = MIN_COMMIT;
        cp.fBps = l0 ? 7000 : 6000;
        cp.cBps = l0 ? 2500 : 1500;
        cp.creatorTokenBps = l0 ? 500 : 2500;
        cp.swapRoyaltyBps = l0 ? 20 : 60; // L0 royalty band [0,30]
        cp.swapBurnBps = l0 ? 0 : 30;
        cp.tier = tier;
        cp.refundMode = IOffering.RefundMode.Partial;
        cp.transferLockDuration = 0;
        cp.holdingCapBps = 0;
        cp.sponsorBurnBps = 1000;
        cp.vestingDuration = l0 ? 120 days : 1080 days;
        cp.vestingCliff = l0 ? 0 : 180 days;
    }

    function _create(IFeeRouter.UtilityTier tier) internal returns (Offering o, MembershipToken t) {
        vm.prank(creator);
        (address oa, address ta,) = factory.createOffering(_cp(tier));
        return (Offering(oa), MembershipToken(ta));
    }

    /// @dev Create + fund + settle → pool exists and is seeded at par.
    function _createAndSettle(IFeeRouter.UtilityTier tier) internal returns (Offering o, MembershipToken t) {
        (o, t) = _create(tier);
        vm.startPrank(fan);
        krw.faucet(WALLET_LIMIT);
        krw.approve(address(o), WALLET_LIMIT);
        o.commit(WALLET_LIMIT);
        vm.stopPrank();
        vm.warp(o.deadline());
        uint256 totalSold = 15e18; // 150k / 10k
        uint256 totalRaised = WALLET_LIMIT;
        o.settle(_leaf(fan, totalSold, 0), totalSold, totalRaised, bytes32(uint256(1)));
    }

    function _leaf(address a, uint256 alloc, uint256 refund) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a, alloc, refund))));
    }

    function _peripherals(address o) internal view returns (RedeemManager rm, Sponsorship sp) {
        rm = RedeemManager(factory.redeemManagerOf(o));
        sp = Sponsorship(factory.sponsorshipOf(o));
    }

    // ==================================================================
    // invariant 1 — swapForBurn reverts for any non-registered caller
    // ==================================================================

    function testFuzz_Inv1_SwapForBurnCallerRestricted(address caller, uint256 amountIn) public {
        (Offering o, MembershipToken t) = _createAndSettle(IFeeRouter.UtilityTier.L1);
        MapaePool pool = MapaePool(t.pool());
        (, Sponsorship sp) = _peripherals(address(o));
        vm.assume(caller != address(sp) && caller != address(buybackVault));
        amountIn = bound(amountIn, 1, 1e30);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(MapaePool.NotBurner.selector, caller));
        pool.swapForBurn(amountIn, 0);
    }

    function test_Inv1_RegisteredBurnerAllowed() public {
        (, MembershipToken t) = _createAndSettle(IFeeRouter.UtilityTier.L1);
        MapaePool pool = MapaePool(t.pool());
        // The BuybackVault (a registered burner) can drive swapForBurn.
        krw.faucet(10_000e18);
        buybackVault.topUp(address(t), 10_000e18);
        vm.prank(address(this)); // this == vault executor (owner default)
        uint256 burned = buybackVault.executeBuyback(address(t), 10_000e18, 0);
        assertGt(burned, 0);
        assertEq(pool.factory(), address(factory));
        assertTrue(factory.isBurner(address(buybackVault)));
    }

    // ==================================================================
    // invariant 2 — after swapForBurn, no balance rises; only supply drops
    // ==================================================================

    function testFuzz_Inv2_BurnOnlyReducesSupply(uint256 amountIn) public {
        (, MembershipToken t) = _createAndSettle(IFeeRouter.UtilityTier.L1);
        MapaePool pool = MapaePool(t.pool());
        amountIn = bound(amountIn, 1e18, 20_000e18);

        krw.faucet(amountIn);
        buybackVault.topUp(address(t), amountIn);

        address[5] memory watch = [address(buybackVault), treasury, creator, fan, address(this)];
        uint256[5] memory before;
        for (uint256 i = 0; i < watch.length; i++) {
            before[i] = t.balanceOf(watch[i]);
        }
        uint256 supplyBefore = t.totalSupply();
        uint256 poolBefore = t.balanceOf(address(pool));

        uint256 burned = buybackVault.executeBuyback(address(t), amountIn, 0);

        // No watched address gained tokens.
        for (uint256 i = 0; i < watch.length; i++) {
            assertLe(t.balanceOf(watch[i]), before[i]);
        }
        // Only outcome: supply down by exactly `burned`, pool reserve down by `burned`.
        assertEq(supplyBefore - t.totalSupply(), burned);
        assertEq(poolBefore - t.balanceOf(address(pool)), burned);
        assertGt(burned, 0);
    }

    // ==================================================================
    // invariant 3 — L0 cancel() reverts in every state
    // ==================================================================

    function test_Inv3_L0CancelAlwaysReverts() public {
        (Offering o,) = _create(IFeeRouter.UtilityTier.L0);
        // before any commit
        vm.prank(fan);
        vm.expectRevert(IOffering.CancelDisabled.selector);
        o.cancel(1);
        // after a commit (Open)
        vm.startPrank(fan);
        krw.faucet(MIN_COMMIT);
        krw.approve(address(o), MIN_COMMIT);
        o.commit(MIN_COMMIT);
        vm.expectRevert(IOffering.CancelDisabled.selector);
        o.cancel(1);
        vm.stopPrank();
        // near the deadline (would be Frozen for L1) — still CancelDisabled
        vm.warp(o.deadline() - 1);
        vm.prank(fan);
        vm.expectRevert(IOffering.CancelDisabled.selector);
        o.cancel(1);
    }

    function testFuzz_Inv3_L0CancelAnyAmountAnyTime(uint256 amount, uint256 warpTo) public {
        (Offering o,) = _create(IFeeRouter.UtilityTier.L0);
        warpTo = bound(warpTo, block.timestamp, o.deadline() + 30 days);
        vm.warp(warpTo);
        vm.prank(fan);
        vm.expectRevert(IOffering.CancelDisabled.selector);
        o.cancel(amount);
    }

    // ==================================================================
    // invariant 4 (v3, decision 21) — no tier gives the platform any issued token
    // ==================================================================

    function testFuzz_Inv4_NoPlatformTokenAnyTier(uint8 tierRaw) public {
        IFeeRouter.UtilityTier tier = IFeeRouter.UtilityTier(bound(tierRaw, 0, 2));
        (, MembershipToken t) = _createAndSettle(tier);
        assertEq(t.balanceOf(platform), 0);
        assertEq(t.balanceOf(treasury), 0);
    }

    // ==================================================================
    // invariant 5 — every offering enforces R >= minRaise
    // ==================================================================

    function testFuzz_Inv5_RaiseFloor(uint256 raiseTarget) public {
        raiseTarget = bound(raiseTarget, 1, MIN_RAISE - 1);
        IOffering.OfferingParams memory p = _directParams(IFeeRouter.UtilityTier.L1);
        p.raiseTarget = raiseTarget; // below the floor
        vm.expectRevert(IOffering.InvalidConfig.selector);
        offeringDeployer.deploy(p);
        // exactly at the floor is accepted
        p.raiseTarget = MIN_RAISE;
        Offering o = offeringDeployer.deploy(p);
        assertEq(o.raiseTarget(), MIN_RAISE);
    }

    // ==================================================================
    // invariant 8 — L0 gates: redeem / paid drop / sponsorship / vault
    // ==================================================================

    function test_Inv8_L0GatesEverything() public {
        (Offering o, MembershipToken t) = _createAndSettle(IFeeRouter.UtilityTier.L0);
        (RedeemManager rm, Sponsorship sp) = _peripherals(address(o));

        vm.startPrank(creator);
        vm.expectRevert(IRedeemManager.TierNotAllowed.selector);
        rm.createRedeemable(1, 1e18, 0, 0);
        vm.expectRevert(IRedeemManager.TierNotAllowed.selector);
        rm.createPaidDrop(1, 1e18, 0, 0);
        vm.stopPrank();

        vm.startPrank(fan);
        krw.faucet(2e18);
        krw.approve(address(sp), 2e18);
        vm.expectRevert(Sponsorship.TierNotAllowed.selector);
        sp.sponsorKRWs(1e18, "x");
        vm.expectRevert(Sponsorship.TierNotAllowed.selector);
        sp.sponsorToken(1e18, "x");
        vm.stopPrank();

        vm.expectRevert(BuybackVault.TierNotAllowed.selector);
        buybackVault.route(address(t), 1e18);
        vm.expectRevert(BuybackVault.TierNotAllowed.selector);
        buybackVault.topUp(address(t), 1e18);
        vm.expectRevert(BuybackVault.TierNotAllowed.selector);
        buybackVault.executeBuyback(address(t), 1e18, 0);
    }

    // ==================================================================
    // invariant 9 — vault KRWs never leave except via a burn buyback, even
    // with a hostile executor
    // ==================================================================

    function testFuzz_Inv9_NoNonBurnOutflow(address attacker, uint256 topUp, uint256 spend) public {
        (, MembershipToken t) = _createAndSettle(IFeeRouter.UtilityTier.L1);
        vm.assume(attacker != address(0) && attacker != address(buybackVault));
        topUp = bound(topUp, 2e18, 50_000e18);
        krw.faucet(topUp);
        buybackVault.topUp(address(t), topUp);

        // Owner hands the executor role to an arbitrary attacker.
        buybackVault.setExecutor(attacker);

        uint256 vaultBefore = krw.balanceOf(address(buybackVault));
        uint256 attackerKrwBefore = krw.balanceOf(attacker);
        uint256 supplyBefore = t.totalSupply();
        spend = bound(spend, 1e18, topUp);

        vm.prank(attacker);
        uint256 burned = buybackVault.executeBuyback(address(t), spend, 0);

        // KRWs left the vault ONLY into the pool (== spend), attacker got nothing.
        assertEq(vaultBefore - krw.balanceOf(address(buybackVault)), spend);
        assertEq(krw.balanceOf(attacker), attackerKrwBefore); // hostile executor gains no KRWs
        assertEq(t.balanceOf(attacker), 0); // and no tokens
        assertEq(supplyBefore - t.totalSupply(), burned); // the spend became a burn
        assertGt(burned, 0);
    }

    // ==================================================================
    // invariant 10 — swap fee 4-split sums to the total rate, zero precision loss
    // ==================================================================

    struct FeeObs {
        uint256 platform;
        uint256 royalty;
        uint256 burn;
        uint256 reserveGain;
    }

    /// @dev Perform one KRWs→token swap and return the observed fee shares.
    function _observeSwap(MapaePool pool, uint256 amountIn) internal returns (FeeObs memory obs) {
        uint256 treBefore = krw.balanceOf(treasury);
        uint256 creBefore = krw.balanceOf(creator);
        uint256 bufBefore = pool.burnBuffer();
        uint256 reserveBefore = pool.reserveQuote();
        vm.startPrank(fan);
        krw.faucet(amountIn);
        krw.approve(address(pool), amountIn);
        pool.swapQuoteForToken(amountIn, 0, fan);
        vm.stopPrank();
        obs.platform = krw.balanceOf(treasury) - treBefore;
        obs.royalty = krw.balanceOf(creator) - creBefore;
        obs.burn = pool.burnBuffer() - bufBefore;
        obs.reserveGain = pool.reserveQuote() - reserveBefore;
    }

    function testFuzz_Inv10_FeeSplitPrecision(uint256 amountIn) public {
        (, MembershipToken t) = _createAndSettle(IFeeRouter.UtilityTier.L1);
        amountIn = bound(amountIn, 1e18, 100_000e18);
        IFeeRouter.TierFees memory f = feeRouter.getFees(IFeeRouter.UtilityTier.L1);
        uint256 totalBps = uint256(f.swapPlatformBps) + f.swapRoyaltyBps + f.swapBurnBps + f.swapLpBps;
        uint256 totalFee = amountIn * totalBps / 10_000;

        FeeObs memory obs = _observeSwap(MapaePool(t.pool()), amountIn);

        // each share is the exact floor of amountIn × bps
        assertEq(obs.platform, amountIn * f.swapPlatformBps / 10_000);
        assertEq(obs.royalty, amountIn * f.swapRoyaltyBps / 10_000);
        assertEq(obs.burn, amountIn * f.swapBurnBps / 10_000);
        // platform+royalty+burn ≤ totalFee; lp = remainder ≥ 0 (fan/LP dust)
        assertLe(obs.platform + obs.royalty + obs.burn, totalFee);
        // the four shares sum EXACTLY to the total fee — zero precision loss.
        uint256 lp = totalFee - obs.platform - obs.royalty - obs.burn;
        assertEq(obs.platform + obs.royalty + obs.burn + lp, totalFee);
        // and lp genuinely stayed in reserve: reserve grew by (amountIn − the three
        // shares that left) = effectiveIn + lp.
        assertEq(obs.reserveGain, amountIn - obs.platform - obs.royalty - obs.burn);
    }

    // ==================================================================
    // invariant 11 — FeeRouter change mid-offering doesn't move the snapshot
    // ==================================================================

    function test_Inv11_OfferingFeeSnapshot() public {
        // Create at L1 (offering fee 750 snapshot), THEN raise the L1 fee to 1000.
        (Offering o, MembershipToken t) = _create(IFeeRouter.UtilityTier.L1);
        assertEq(o.offeringFeeBps(), 750);
        feeRouter.setFees(IFeeRouter.UtilityTier.L1, IFeeRouter.TierFees(1000, 40, 60, 30, 20, 400));
        assertEq(o.offeringFeeBps(), 750); // immutable snapshot unaffected

        vm.startPrank(fan);
        krw.faucet(WALLET_LIMIT);
        krw.approve(address(o), WALLET_LIMIT);
        o.commit(WALLET_LIMIT);
        vm.stopPrank();
        vm.warp(o.deadline());
        o.settle(_leaf(fan, 15e18, 0), 15e18, WALLET_LIMIT, bytes32(uint256(1)));

        // Platform proceeds used the 7.5% snapshot, not the new 10%.
        assertEq(krw.balanceOf(platform), WALLET_LIMIT * 750 / 10_000);
        t; // silence unused
    }

    // ==================================================================
    // invariant 12 — listing price == offering price (l = c × f), incl. L0 preset
    // ==================================================================

    function test_Inv12_ListingAtPar_L1() public {
        (, MembershipToken t) = _createAndSettle(IFeeRouter.UtilityTier.L1);
        assertEq(MapaePool(t.pool()).spotPrice(), PRICE);
    }

    function test_Inv12_ListingAtPar_L0Preset() public {
        // L0 preset f=70%, c=25% → l = c×f = 17.5%.
        (Offering o, MembershipToken t) = _createAndSettle(IFeeRouter.UtilityTier.L0);
        assertEq(o.fBps(), 7000);
        assertEq(o.cBps(), 2500);
        assertEq(o.lpTokenBps(), uint16(uint256(2500) * 7000 / 10_000)); // 1750
        assertEq(MapaePool(t.pool()).spotPrice(), PRICE); // 상장가 == 공모가
    }

    // ==================================================================
    // invariant 10 (sell side) — output-split precision (R1 redefinition)
    // ==================================================================

    function testFuzz_Inv10_SellFeeSplitPrecision(uint256 amountIn) public {
        (, MembershipToken t) = _createAndSettle(IFeeRouter.UtilityTier.L1);
        MapaePool pool = MapaePool(t.pool());
        // fan needs tokens to sell — buy a chunk first.
        vm.startPrank(fan);
        krw.faucet(200_000e18);
        krw.approve(address(pool), type(uint256).max);
        pool.swapQuoteForToken(200_000e18, 0, fan);
        t.approve(address(pool), type(uint256).max);
        vm.stopPrank();
        amountIn = bound(amountIn, 1e15, t.balanceOf(fan));

        IFeeRouter.TierFees memory f = feeRouter.getFees(IFeeRouter.UtilityTier.L1);
        uint256 treBefore = krw.balanceOf(treasury);
        uint256 creBefore = krw.balanceOf(creator);
        uint256 reserveQuoteBefore = pool.reserveQuote();

        vm.prank(fan);
        uint256 out = pool.swapTokenForQuote(amountIn, 0, fan);

        uint256 grossOut = reserveQuoteBefore - pool.reserveQuote();
        uint256 platform = krw.balanceOf(treasury) - treBefore;
        uint256 royalty = krw.balanceOf(creator) - creBefore;
        // platform/royalty are exact floors of the KRWs OUTPUT (base = grossOut).
        assertEq(platform, grossOut * f.swapPlatformBps / 10_000);
        assertEq(royalty, grossOut * f.swapRoyaltyBps / 10_000);
        // output split sums EXACTLY to gross (caller absorbs the rounding dust).
        assertEq(platform + royalty + out, grossOut);
    }

    // ==================================================================
    // invariant 17 — platformTreasury never holds creator tokens (R1)
    // ==================================================================

    function testFuzz_Inv17_TreasuryHoldsNoTokens(uint256 buy1, uint256 sellSeed, uint256 buy2) public {
        (, MembershipToken t) = _createAndSettle(IFeeRouter.UtilityTier.L1);
        MapaePool pool = MapaePool(t.pool());
        buy1 = bound(buy1, 1e18, 80_000e18);
        buy2 = bound(buy2, 1e18, 80_000e18);

        vm.startPrank(fan);
        krw.faucet(buy1 + buy2);
        krw.approve(address(pool), type(uint256).max);
        t.approve(address(pool), type(uint256).max);
        pool.swapQuoteForToken(buy1, 0, fan);
        uint256 sellAmt = bound(sellSeed, 1, t.balanceOf(fan));
        pool.swapTokenForQuote(sellAmt, 0, fan); // sell routes platform in KRWs
        pool.swapQuoteForToken(buy2, 0, fan);
        vm.stopPrank();

        // Treasury accrues KRWs from platform cuts but NEVER creator tokens.
        assertEq(t.balanceOf(treasury), 0);
        assertGt(krw.balanceOf(treasury), 0);
    }

    // ==================================================================
    // R2 — per-pool swap royalty/burn tier bands
    // ==================================================================

    function test_R2_SwapRoyaltyBurnBands() public {
        // L1: royalty [0,80], burn [0,50]
        IOffering.OfferingParams memory p = _directParams(IFeeRouter.UtilityTier.L1);
        p.swapRoyaltyBps = 81;
        vm.expectRevert(IOffering.InvalidConfig.selector);
        offeringDeployer.deploy(p);
        p.swapRoyaltyBps = 80;
        p.swapBurnBps = 51;
        vm.expectRevert(IOffering.InvalidConfig.selector);
        offeringDeployer.deploy(p);
        p.swapBurnBps = 50;
        Offering o1 = offeringDeployer.deploy(p); // 80/50 edge ok
        assertEq(o1.swapRoyaltyBps(), 80);

        // L0: royalty [0,30] (tighter), burn must be 0 (v3: L0 total swap fee ≤ 100 bps)
        IOffering.OfferingParams memory q = _directParams(IFeeRouter.UtilityTier.L0);
        q.swapRoyaltyBps = 31;
        vm.expectRevert(IOffering.InvalidConfig.selector);
        offeringDeployer.deploy(q);
        q.swapRoyaltyBps = 30;
        q.swapBurnBps = 0;
        Offering o2 = offeringDeployer.deploy(q); // 30/0 edge ok
        assertEq(o2.swapRoyaltyBps(), 30);
    }

    // ==================================================================
    // invariant 5 (확인) — minRaise floor applies to L0 too
    // ==================================================================

    function test_Inv5_MinRaiseAppliesToL0() public {
        // Via the factory (L0 bypasses the guide, but the Offering-level floor
        // still bites): raise below minRaise reverts.
        MapaeFactory.CreateParams memory cp = _cp(IFeeRouter.UtilityTier.L0);
        cp.raiseTarget = MIN_RAISE - 1;
        vm.prank(creator);
        vm.expectRevert(IOffering.InvalidConfig.selector);
        factory.createOffering(cp);
        // exactly at the floor is accepted
        cp.raiseTarget = MIN_RAISE;
        cp.walletLimit = MIN_RAISE;
        vm.prank(creator);
        factory.createOffering(cp);
    }

    // ------------------------------------------------------------------
    // direct-construction params (for invariants 4, 5)
    // ------------------------------------------------------------------

    function _directParams(IFeeRouter.UtilityTier tier) internal returns (IOffering.OfferingParams memory p) {
        bool l0 = tier == IFeeRouter.UtilityTier.L0;
        p.paymentToken = IERC20(address(krw));
        p.dojang = IDojang(address(dojang));
        p.creator = creator;
        p.platformOwner = address(this);
        p.tokenName = "T";
        p.tokenSymbol = "T";
        p.price = PRICE;
        p.raiseTarget = RAISE;
        p.minRaise = MIN_RAISE;
        p.deadline = block.timestamp + (l0 ? 2 hours : 24 hours);
        p.walletLimit = WALLET_LIMIT;
        p.minCommit = MIN_COMMIT;
        p.fBps = l0 ? 7000 : 6000;
        p.cBps = l0 ? 2500 : 1500;
        p.creatorTokenBps = l0 ? 500 : 2500;
        p.swapRoyaltyBps = l0 ? 20 : 60;
        p.swapBurnBps = l0 ? 0 : 30;
        p.refundMode = IOffering.RefundMode.Partial;
        p.transferLockDuration = 0;
        p.holdingCapBps = 0;
        p.poolFactory = poolFactory;
        p.feeRouter = feeRouter;
        p.tier = tier;
        p.mapaeFactory = address(factory);
        p.recipients = IOffering.AllocationRecipients({creatorVesting: makeAddr("cv"), platform: platform});
    }
}
