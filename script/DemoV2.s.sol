// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// v5.2 demo — the four milestone scenarios, end to end:
//   ① L1 offering full cycle  (commit → settle → claim → list → swap → sponsor)
//   ② L0 mini offering (T=1h)  same-day full cycle (commit → settle → claim → list)
//   ③ paid drop                (merch fee → treasury, reroute → vault, rest → creator)
//   ④ buyback                  (BuybackExecutor.run buys-and-burns from the vault)
//
// This script is SELF-CONTAINED: it deploys the whole stack and runs every
// scenario in one simulation, using vm.warp for the deadlines. Validate with:
//
//   forge script script/DemoV2.s.sol -vvv          # pure simulation (no broadcast)
//
// On a live chain (where time cannot be warped) the create/settle steps are run
// as separate transactions once the real deadline passes — the deployed
// addresses come from deployments/giwa-sepolia.json (see Deploy.s.sol). Here the
// warps let the whole thing run and self-check in one shot.

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {ProceedsLockDeployer} from "../src/ProceedsLockDeployer.sol";
import {Offering} from "../src/Offering.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {BuybackVault} from "../src/BuybackVault.sol";
import {BuybackExecutor} from "../src/BuybackExecutor.sol";
import {RedeemManager} from "../src/RedeemManager.sol";
import {Sponsorship} from "../src/Sponsorship.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

contract DemoV2 is Script {
    MockKRW internal krw;
    MockDojang internal dojang;
    FeeRouter internal feeRouter;
    BuybackVault internal vault;
    BuybackExecutor internal executor;
    MapaeFactory internal factory;

    address internal deployer = address(this);
    address internal creator1 = vm.addr(0xC1);
    address internal creator2 = vm.addr(0xC2);
    address internal fanA = vm.addr(0xFA);
    address internal fanB = vm.addr(0xFB);
    address internal buyer = vm.addr(0xB1);

    uint256 internal constant P = 10_000e18;

    function run() external {
        _deploy();
        (address tokenA, address rmA) = _scenario1_L1FullCycle();
        _scenario2_L0Mini();
        _scenario3_PaidDrop(tokenA, rmA);
        _scenario4_Buyback(tokenA);
        console.log(unicode"\n=== 데모 4 시나리오 완료 ===");
    }

    // ------------------------------------------------------------------

    function _deploy() internal {
        vm.warp(1_750_000_000);
        krw = new MockKRW();
        dojang = new MockDojang();
        PoolFactory poolFactory = new PoolFactory();
        feeRouter = new FeeRouter(deployer, deployer); // treasury = deployer
        vault = new BuybackVault(IERC20(address(krw)), deployer);
        executor = new BuybackExecutor(vault, deployer);
        vault.setExecutor(address(executor));
        factory = new MapaeFactory(
            IDojang(address(dojang)),
            IERC20(address(krw)),
            deployer,
            poolFactory,
            feeRouter,
            vault,
            500_000e18, // minRaise floor
            MapaeFactory.FeeRecipients({platform: deployer}),
            MapaeFactory.Guide({
                minPrice: 1000e18,
                maxPrice: 100_000e18,
                minRaise: 5_000_000e18,
                maxRaise: 500_000_000e18,
                minWalletLimitBps: 10,
                maxWalletLimitBps: 3000
            }),
            MapaeFactory.ProceedsBand({
                maxUpfrontBps: 3000, minLockDuration: 1 hours, maxLockDuration: 1095 days, maxLockCliff: 180 days
            }),
            new ProceedsLockDeployer()
        );
        address[] memory who = new address[](5);
        who[0] = creator1;
        who[1] = creator2;
        who[2] = fanA;
        who[3] = fanB;
        who[4] = buyer;
        dojang.setVerifiedBatch(who);
        console.log("FeeRouter/Vault/Executor/Factory deployed; 5 wallets verified.");
    }

    function _commit(address offering, address who, uint256 amount) internal {
        vm.startPrank(who);
        krw.faucet(amount);
        krw.approve(offering, amount);
        Offering(offering).commit(amount);
        vm.stopPrank();
    }

    function _leaf(address a, uint256 alloc, uint256 refund) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a, alloc, refund))));
    }

    // ------------------------------------------------------------------
    // ① L1 full cycle
    // ------------------------------------------------------------------

    function _scenario1_L1FullCycle() internal returns (address tokenA, address rmA) {
        console.log(unicode"\n[①] L1 공모 풀사이클");
        MapaeFactory.CreateParams memory cp;
        cp.tokenName = "MAPAE Demo L1";
        cp.tokenSymbol = "MAPL1";
        cp.price = P;
        cp.raiseTarget = 5_000_000e18;
        cp.deadline = block.timestamp + 12 hours + 30 minutes;
        cp.walletLimit = 1_500_000e18; // 30% of R (guide max)
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
        cp.proceedsUpfrontBps = 3000; // decision 56: 30% at settle, the rest locked
        cp.proceedsLockDuration = 365 days;
        cp.proceedsLockCliff = 30 days;

        vm.prank(creator1);
        (address off, address token, address rm) = factory.createOffering(cp);
        tokenA = token;
        rmA = rm;

        _commit(off, fanA, 1_500_000e18);
        console.log("  committed:", Offering(off).totalCommitted());

        vm.warp(Offering(off).deadline());
        // sell 150 tokens (=1.5M/P), burn the rest of qSale (undersell narrative)
        Offering(off).settle(_leaf(fanA, 150e18, 0), 150e18, 1_500_000e18, bytes32(uint256(1)));
        MapaePool pool = Offering(off).pool();
        console.log("  settled; pool spot == P?", pool.spotPrice() == P);

        vm.prank(fanA);
        Offering(off).claim(150e18, 0, new bytes32[](0));
        console.log("  fanA claimed tokens:", MembershipToken(token).balanceOf(fanA));

        // swap: fanB buys from the pool (platform cut → treasury)
        uint256 treBefore = krw.balanceOf(deployer);
        vm.startPrank(fanB);
        krw.faucet(50_000e18);
        krw.approve(address(pool), 50_000e18);
        uint256 out = pool.swapQuoteForToken(50_000e18, 0, fanB);
        vm.stopPrank();
        console.log("  fanB bought tokens:", out, "| platform swap cut:", krw.balanceOf(deployer) - treBefore);

        // sponsorship: fanA sponsors (10% burns via 0%-fee swapForBurn)
        Sponsorship sp = Sponsorship(factory.sponsorshipOf(off));
        uint256 supplyBefore = MembershipToken(token).totalSupply();
        vm.startPrank(fanA);
        krw.faucet(2000e18);
        krw.approve(address(sp), 2000e18);
        sp.sponsorKRWs(2000e18, unicode"방송 최고!");
        vm.stopPrank();
        console.log("  sponsorship burned:", supplyBefore - MembershipToken(token).totalSupply());
    }

    // ------------------------------------------------------------------
    // ② L0 mini (T=1h) same-day full cycle
    // ------------------------------------------------------------------

    function _scenario2_L0Mini() internal {
        console.log(unicode"\n[②] L0 미니 공모 (T=1h) 당일 풀사이클");
        MapaeFactory.CreateParams memory cp;
        cp.tokenName = "MAPAE Demo L0";
        cp.tokenSymbol = "MAPL0";
        cp.price = P;
        cp.raiseTarget = 500_000e18; // == minRaise floor (guide bypassed for L0)
        cp.deadline = block.timestamp + 1 hours + 5 minutes;
        cp.walletLimit = 500_000e18;
        cp.minCommit = 10_000e18;
        cp.fBps = 7000; // L0 band
        cp.cBps = 2500; // c 기본 25%
        cp.creatorTokenBps = 500; // issuer 5%
        cp.swapRoyaltyBps = 20; // L0 royalty band [0,30]
        cp.swapBurnBps = 20;
        cp.tier = IFeeRouter.UtilityTier.L0;
        cp.refundMode = IOffering.RefundMode.Partial;
        cp.sponsorBurnBps = 0; // L0 has no sponsorship anyway
        cp.vestingDuration = 120 days; // L0 3–6mo band
        cp.vestingCliff = 0; // L0 cliff 0 allowed
        cp.withSponsorship = true;
        cp.proceedsUpfrontBps = 0; // decision 56: L0 has no proceeds lock (must be 0, 0, 0)
        cp.proceedsLockDuration = 0;
        cp.proceedsLockCliff = 0;

        vm.prank(creator2);
        (address off, address token,) = factory.createOffering(cp);

        _commit(off, fanB, 500_000e18);
        console.log("  committed:", Offering(off).totalCommitted());

        vm.warp(Offering(off).deadline());
        Offering(off).settle(_leaf(fanB, 50e18, 0), 50e18, 500_000e18, bytes32(uint256(2)));
        MapaePool pool = Offering(off).pool();
        console.log("  settled same-day; pool spot == P (l=c*f)?", pool.spotPrice() == P);

        vm.prank(fanB);
        Offering(off).claim(50e18, 0, new bytes32[](0));
        console.log("  fanB claimed L0 tokens:", MembershipToken(token).balanceOf(fanB));
    }

    // ------------------------------------------------------------------
    // ③ paid drop
    // ------------------------------------------------------------------

    function _scenario3_PaidDrop(address token, address rm) internal {
        console.log(unicode"\n[③] 유료 드랍 1건");
        vm.prank(creator1);
        RedeemManager(rm).createPaidDrop(1, 100_000e18, 100, block.timestamp + 30 days);
        vm.prank(creator1);
        vault.setRerouteRate(2000); // 20% of creator proceeds → buyback

        uint256 treBefore = krw.balanceOf(deployer);
        vm.startPrank(buyer);
        krw.faucet(100_000e18);
        krw.approve(rm, 100_000e18);
        RedeemManager(rm).purchaseDrop(1);
        vm.stopPrank();
        console.log("  merch fee -> treasury:", krw.balanceOf(deployer) - treBefore);
        console.log("  rerouted -> vault (for token):", vault.krwBalance(token));
    }

    // ------------------------------------------------------------------
    // ④ buyback
    // ------------------------------------------------------------------

    function _scenario4_Buyback(address token) internal {
        console.log(unicode"\n[④] 바이백 실행 1건");
        executor.setParams(24 hours, 100, 1000); // 1% depth cap, 10% slippage
        uint256 supplyBefore = MembershipToken(token).totalSupply();
        uint256 burned = executor.run(token);
        console.log("  buyback burned:", burned);
        console.log("  supply delta:", supplyBefore - MembershipToken(token).totalSupply());
        console.log("  cumulative burned (vault view):", vault.totalBurned(token));
    }
}
