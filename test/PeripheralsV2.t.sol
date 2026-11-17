// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {IRedeemManager} from "../src/interfaces/IRedeemManager.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {ProceedsLockDeployer} from "../src/ProceedsLockDeployer.sol";
import {TEST_PROCEEDS_BAND} from "./utils/ProceedsDefaults.sol";
import {Offering} from "../src/Offering.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {RedeemManager} from "../src/RedeemManager.sol";
import {Sponsorship} from "../src/Sponsorship.sol";
import {BuybackVault} from "../src/BuybackVault.sol";
import {BuybackExecutor} from "../src/BuybackExecutor.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

/// @notice Paid drops (Step 5), the reroute hook (Step 6), and the BuybackVault
///         + BuybackExecutor happy paths (Step 7). L1 tier throughout.
contract PeripheralsV2Test is Test {
    MockKRW internal krw;
    MockDojang internal dojang;
    PoolFactory internal poolFactory;
    FeeRouter internal feeRouter;
    BuybackVault internal vault;
    BuybackExecutor internal executor;
    MapaeFactory internal factory;

    address internal treasury = makeAddr("treasury");
    address internal platform = makeAddr("platform");
    address internal reserve = makeAddr("reserve");
    address internal creator = makeAddr("creator");
    address internal fan = makeAddr("fan");
    address internal buyer = makeAddr("buyer");

    uint256 internal constant PRICE = 10_000e18;
    uint256 internal constant RAISE = 500_000e18;
    uint256 internal constant WALLET_LIMIT = 150_000e18;

    Offering internal offering;
    MembershipToken internal token;
    RedeemManager internal rm;
    Sponsorship internal sp;

    function setUp() public {
        vm.warp(1_750_000_000);
        krw = new MockKRW();
        dojang = new MockDojang();
        poolFactory = new PoolFactory();
        feeRouter = new FeeRouter(address(this), treasury);
        vault = new BuybackVault(IERC20(address(krw)), address(this));
        executor = new BuybackExecutor(vault, address(this));
        vault.setExecutor(address(executor));
        factory = new MapaeFactory(
            IDojang(address(dojang)),
            IERC20(address(krw)),
            address(this),
            poolFactory,
            feeRouter,
            vault,
            RAISE,
            MapaeFactory.FeeRecipients({platform: platform}),
            MapaeFactory.Guide({
                minPrice: 1000e18,
                maxPrice: 100_000e18,
                minRaise: RAISE,
                maxRaise: 500_000_000e18,
                minWalletLimitBps: 10,
                maxWalletLimitBps: 3000
            }),
            TEST_PROCEEDS_BAND(),
            new ProceedsLockDeployer(),
            address(0) // decision 62: no settler
        );
        dojang.setVerified(creator, true);
        dojang.setVerified(fan, true);
        _createAndSettleL1();
    }

    function _cp() internal view returns (MapaeFactory.CreateParams memory cp) {
        cp.tokenName = "Creator Membership";
        cp.tokenSymbol = "CRTM";
        cp.price = PRICE;
        cp.raiseTarget = RAISE;
        cp.deadline = block.timestamp + 24 hours;
        cp.walletLimit = WALLET_LIMIT;
        cp.minCommit = 10_000e18;
        cp.fBps = 6000;
        cp.cBps = 1500;
        cp.creatorTokenBps = 2500;
        cp.swapRoyaltyBps = 60;
        cp.swapBurnBps = 30;
        cp.tier = IFeeRouter.UtilityTier.L1;
        cp.refundMode = IOffering.RefundMode.Partial;
        cp.sponsorBurnBps = 1000;
        cp.vestingDuration = 1080 days;
        cp.vestingCliff = 180 days;
        cp.withSponsorship = true;
        cp.proceedsUpfrontBps = 10_000; // pre-56 expectations: the whole issuer share at settle
        cp.proceedsLockDuration = 1 hours;
        cp.proceedsLockCliff = 0;
    }

    function _createAndSettleL1() internal {
        vm.prank(creator);
        (address oa, address ta,) = factory.createOffering(_cp());
        offering = Offering(oa);
        token = MembershipToken(ta);
        rm = RedeemManager(factory.redeemManagerOf(oa));
        sp = Sponsorship(factory.sponsorshipOf(oa));

        vm.startPrank(fan);
        krw.faucet(WALLET_LIMIT);
        krw.approve(oa, WALLET_LIMIT);
        offering.commit(WALLET_LIMIT);
        vm.stopPrank();
        vm.warp(offering.deadline());
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(fan, uint256(15e18), uint256(0)))));
        offering.settle(leaf, 15e18, WALLET_LIMIT, bytes32(uint256(1)));
    }

    // ------------------------------------------------------------------
    // Paid drops (Step 5)
    // ------------------------------------------------------------------

    function test_PaidDrop_SplitsMerchRerouteCreator() public {
        vm.prank(creator);
        rm.createPaidDrop(1, 100_000e18, 0, 0);
        // creator reroutes 20% of their proceeds to buyback
        vm.prank(creator);
        vault.setRerouteRate(2000);

        uint256 treBefore = krw.balanceOf(treasury);
        uint256 creBefore = krw.balanceOf(creator); // creator already holds settle proceeds

        vm.startPrank(buyer);
        krw.faucet(100_000e18);
        krw.approve(address(rm), 100_000e18);
        rm.purchaseDrop(1);
        vm.stopPrank();

        // merch fee = 4% (L1 merchFeeBps 400) → treasury
        uint256 merch = 100_000e18 * 400 / 10_000;
        assertEq(krw.balanceOf(treasury) - treBefore, merch);
        uint256 remainder = 100_000e18 - merch;
        uint256 reroute = remainder * 2000 / 10_000;
        assertEq(vault.krwBalance(address(token)), reroute);
        assertEq(krw.balanceOf(creator) - creBefore, remainder - reroute);
        assertEq(krw.balanceOf(address(rm)), 0);
    }

    function test_PaidDrop_Gates() public {
        vm.prank(fan); // not creator
        vm.expectRevert(abi.encodeWithSelector(IRedeemManager.NotCreator.selector, fan));
        rm.createPaidDrop(1, 1e18, 0, 0);

        vm.startPrank(creator);
        vm.expectRevert(IRedeemManager.ZeroPrice.selector);
        rm.createPaidDrop(1, 0, 0, 0);
        rm.createPaidDrop(1, 1e18, 1, block.timestamp + 1 days); // maxClaims 1, deadline
        vm.expectRevert(abi.encodeWithSelector(IRedeemManager.PaidDropExists.selector, 1));
        rm.createPaidDrop(1, 1e18, 0, 0);
        vm.stopPrank();

        vm.startPrank(buyer);
        krw.faucet(10e18);
        krw.approve(address(rm), 10e18);
        rm.purchaseDrop(1); // first claim ok
        vm.expectRevert(abi.encodeWithSelector(IRedeemManager.PaidDropSoldOut.selector, 1, 1));
        rm.purchaseDrop(1); // sold out
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(IRedeemManager.UnknownPaidDrop.selector, 99));
        rm.purchaseDrop(99);
    }

    // ------------------------------------------------------------------
    // Sponsorship reroute hook (Step 6)
    // ------------------------------------------------------------------

    function test_Sponsorship_RerouteHook() public {
        vm.prank(creator);
        vault.setRerouteRate(2000); // 20%

        // Small vs the seeded pool so the burn buy clears the slippage guard.
        uint256 amount = 1000e18;
        uint256 creatorBefore = krw.balanceOf(creator);

        vm.startPrank(fan);
        krw.faucet(amount);
        krw.approve(address(sp), amount);
        sp.sponsorKRWs(amount, unicode"후원+환원");
        vm.stopPrank();

        uint256 burnKrw = amount * 1000 / 10_000; // 10% burned via swapForBurn
        uint256 creatorShare = amount - burnKrw; // 90%
        uint256 reroute = creatorShare * 2000 / 10_000; // 20% of 90%
        assertEq(vault.krwBalance(address(token)), reroute);
        assertEq(krw.balanceOf(creator) - creatorBefore, creatorShare - reroute);
    }

    // ------------------------------------------------------------------
    // BuybackVault config
    // ------------------------------------------------------------------

    function test_Vault_SetRerouteRate_Max30() public {
        vm.prank(creator);
        vm.expectRevert(BuybackVault.RateTooHigh.selector);
        vault.setRerouteRate(3001);
        vm.prank(creator);
        vault.setRerouteRate(3000); // edge ok
        assertEq(vault.rerouteRateBps(creator), 3000);
    }

    function test_Vault_SetExecutor_OnlyOwner() public {
        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, fan));
        vault.setExecutor(fan);
    }

    // ------------------------------------------------------------------
    // BuybackExecutor (Step 7)
    // ------------------------------------------------------------------

    function test_Executor_RunBurnsAndRespectsInterval() public {
        executor.setParams(24 hours, 100, 1000); // 1% depth cap, 10% slippage
        krw.faucet(100_000e18);
        krw.approve(address(vault), 100_000e18);
        vault.topUp(address(token), 100_000e18);

        uint256 supplyBefore = token.totalSupply();
        uint256 burned = executor.run(address(token));
        assertGt(burned, 0);
        assertEq(supplyBefore - token.totalSupply(), burned);
        assertEq(vault.totalBurned(address(token)), burned);

        // interval not elapsed → TooSoon
        vm.expectRevert();
        executor.run(address(token));

        // after the interval, it runs again
        vm.warp(block.timestamp + 24 hours);
        uint256 burned2 = executor.run(address(token));
        assertGt(burned2, 0);
    }

    function test_Executor_OnlyOwner() public {
        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, fan));
        executor.run(address(token));
    }

    function test_Executor_SetParamsBounds() public {
        vm.expectRevert(BuybackExecutor.BadParams.selector);
        executor.setParams(1 hours, 0, 500); // zero cap
        vm.expectRevert(BuybackExecutor.BadParams.selector);
        executor.setParams(1 hours, 500, 10_000); // slippage >= 100%
        executor.setParams(1 hours, 500, 500); // ok
    }
}
