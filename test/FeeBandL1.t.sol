// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {ProceedsLockDeployer} from "../src/ProceedsLockDeployer.sol";
import {Offering} from "../src/Offering.sol";
import {MapaeFactoryTestBase} from "./MapaeFactory.t.sol";
import {TESTNET_PROCEEDS_BAND} from "./utils/ProceedsDefaults.sol";

/// @notice Decision 59 (C-T3, v3.3-L1): the L1/L2 offering fee band is [0, 500] bps with a 0
///         preset. Settlement at 0, 250 and 500 bps: platform = raised x fee, issuer = raised -
///         LP seed - platform, upfront + locked = issuer; a 0 fee sends no 0-amount transfer.
contract FeeBandL1Test is MapaeFactoryTestBase {
    uint16 internal constant BPS = 10_000;
    address internal fanA = makeAddr("fanA");
    address internal fanB = makeAddr("fanB");
    address internal fanC = makeAddr("fanC");
    address internal fanD = makeAddr("fanD");

    function setUp() public override {
        super.setUp();
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

    function _fees(uint16 off, uint16 merch) internal pure returns (IFeeRouter.TierFees memory) {
        return IFeeRouter.TierFees(off, 40, 60, 30, 20, merch);
    }

    function _open(uint16 feeBps) internal returns (Offering o) {
        feeRouter.setFees(IFeeRouter.UtilityTier.L1, _fees(feeBps, 400));
        MapaeFactory.CreateParams memory cp = defaultCreateParams();
        cp.proceedsUpfrontBps = 3000;
        cp.proceedsLockDuration = 365 days;
        cp.proceedsLockCliff = 30 days;
        vm.prank(creator);
        (address a,,) = factory.createOffering(cp);
        o = Offering(a);
        assertEq(o.offeringFeeBps(), feeBps, "snapshot");
    }

    /// @dev Fills the raise target and settles; returns the raised amount and the LP KRW seed.
    function _settle(Offering o) internal returns (uint256 raised, uint256 krwSeed, uint256 platformInEvent) {
        commitAs(o, fanA, 300_000e18);
        commitAs(o, fanB, 300_000e18);
        commitAs(o, fanC, 300_000e18);
        commitAs(o, fanD, 100_000e18);
        vm.warp(o.deadline());
        uint256 sold = RAISE * 1e18 / PRICE;
        raised = sold * PRICE / 1e18;
        vm.recordLogs();
        o.settle(bytes32(uint256(1)), sold, raised, bytes32(0));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 listed = keccak256("Listed(address,uint256,uint256,uint256)");
        bytes32 dist = keccak256("ProceedsDistributed(uint256,uint256,uint256,address)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(o)) continue;
            if (logs[i].topics[0] == listed) (, krwSeed,) = abi.decode(logs[i].data, (uint256, uint256, uint256));
            if (logs[i].topics[0] == dist) {
                (platformInEvent,,,) = abi.decode(logs[i].data, (uint256, uint256, uint256, address));
            }
        }
    }

    // ------------------------------------------------------------------
    // band
    // ------------------------------------------------------------------

    function test_Preset_L1_L2_OfferingFeeZero_SwapSplitUnchanged() public view {
        IFeeRouter.TierFees memory l1 = feeRouter.getFees(IFeeRouter.UtilityTier.L1);
        assertEq(abi.encode(l1), abi.encode(_fees(0, 400)), "getFees(L1) = (0, 40, 60, 30, 20, 400)");
        assertEq(abi.encode(feeRouter.getFees(IFeeRouter.UtilityTier.L2)), abi.encode(_fees(0, 300)));
        assertEq(feeRouter.swapTotalBps(IFeeRouter.UtilityTier.L1), 150);
        // L0 and the curve presets are untouched
        IFeeRouter.TierFees memory l0 = feeRouter.getFees(IFeeRouter.UtilityTier.L0);
        assertEq(abi.encode(l0), abi.encode(IFeeRouter.TierFees(500, 40, 30, 0, 30, 0)));
    }

    function test_Band_0_and_500_pass_501_reverts() public {
        feeRouter.setFees(IFeeRouter.UtilityTier.L1, _fees(0, 400));
        feeRouter.setFees(IFeeRouter.UtilityTier.L1, _fees(500, 400));
        vm.expectRevert(FeeRouter.OutOfBand.selector);
        feeRouter.setFees(IFeeRouter.UtilityTier.L1, _fees(501, 400));
        feeRouter.setFees(IFeeRouter.UtilityTier.L2, _fees(500, 300));
        vm.expectRevert(FeeRouter.OutOfBand.selector);
        feeRouter.setFees(IFeeRouter.UtilityTier.L2, _fees(501, 300));
    }

    // ------------------------------------------------------------------
    // settlement at 0 / 2.5% / 5%
    // ------------------------------------------------------------------

    function _checkSplit(uint16 feeBps) internal {
        Offering o = _open(feeBps);
        address lock = factory.proceedsLockOf(address(o));
        uint256 creatorBefore = krw.balanceOf(creator);
        uint256 platformBefore = krw.balanceOf(platform);
        (uint256 raised, uint256 krwSeed, uint256 platformInEvent) = _settle(o);
        assertEq(platformInEvent, raised * feeBps / BPS, "event platformProceeds");
        uint256 platformGot = krw.balanceOf(platform) - platformBefore;
        uint256 upfront = krw.balanceOf(creator) - creatorBefore;
        uint256 locked = krw.balanceOf(lock);
        assertEq(platformGot, raised * feeBps / BPS, "platform = raised x fee");
        uint256 issuer = raised - krwSeed - platformGot;
        assertEq(upfront + locked, issuer, "upfront + locked = issuer share");
        assertEq(upfront, issuer * 3000 / BPS, "upfront share");
        assertEq(krw.balanceOf(address(o)), 0, "nothing left in the offering");
        assertGt(krwSeed, 0);
    }

    function test_Settle_Fee0() public {
        _checkSplit(0);
    }

    function test_Settle_Fee250() public {
        _checkSplit(250);
    }

    function test_Settle_Fee500() public {
        _checkSplit(500);
    }

    /// @dev A payment token that reverts on a 0-amount transfer would break a 0 fee: the platform
    ///      leg is skipped, so settle still succeeds and the event reports 0.
    function test_Fee0_SendsNoZeroTransfer_EventReportsZero() public {
        Offering o = _open(0);
        vm.mockCallRevert(
            address(krw), abi.encodeWithSelector(IERC20.transfer.selector, platform, uint256(0)), "zero transfer"
        );
        (uint256 raised, uint256 krwSeed, uint256 platformInEvent) = _settle(o);
        assertEq(platformInEvent, 0, "event reports 0");
        assertEq(krw.balanceOf(platform), 0);
        assertGt(raised - krwSeed, 0);
    }

    function testFuzz_Split_ConservedAcrossBand(uint16 feeBps) public {
        feeBps = uint16(bound(feeBps, 0, 500));
        _checkSplit(feeBps);
    }
}
