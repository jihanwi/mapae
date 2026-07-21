// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {Offering} from "../src/Offering.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {RedeemManager} from "../src/RedeemManager.sol";
import {OfferingTestBase} from "./utils/OfferingTestBase.sol";

abstract contract MapaeFactoryTestBase is OfferingTestBase {
    MapaeFactory internal factory;

    address internal creator2 = makeAddr("creator2");
    address internal fan1 = makeAddr("fan1");

    function setUp() public virtual override {
        super.setUp();
        factory = new MapaeFactory(
            IDojang(address(dojang)),
            IERC20(address(krw)),
            address(this), // platform ops wallet (settle authority)
            MapaeFactory.FeeRecipients({platform: platform, reserve: reserve, lpEscrow: lpEscrow}),
            // Test guide: wide enough for the E2E fixtures (L = 30% of R).
            MapaeFactory.Guide({
                minPrice: 1000e18,
                maxPrice: 100_000e18,
                minRaise: 500_000e18,
                maxRaise: 500_000_000e18,
                minWalletLimitBps: 10,
                maxWalletLimitBps: 3000
            })
        );
        dojang.setVerified(creator, true);
        dojang.setVerified(creator2, true);
    }

    function defaultCreateParams() internal view returns (MapaeFactory.CreateParams memory cp) {
        cp.tokenName = "Creator Membership";
        cp.tokenSymbol = "CRTM";
        cp.price = PRICE;
        cp.raiseTarget = RAISE;
        cp.deadline = block.timestamp + 24 hours;
        cp.walletLimit = WALLET_LIMIT;
        cp.minCommit = MIN_COMMIT;
        cp.fBps = F_BPS;
        cp.cBps = C_BPS;
        cp.creatorTokenBps = CREATOR_TOKEN_BPS;
        cp.refundMode = IOffering.RefundMode.AllOrNothing;
        cp.transferLockDuration = 0;
        cp.holdingCapBps = 0;
    }

    function createAs(address who) internal returns (Offering, MembershipToken, RedeemManager) {
        vm.prank(who);
        (address o, address t, address rm) = factory.createOffering(defaultCreateParams());
        return (Offering(o), MembershipToken(t), RedeemManager(rm));
    }
}

contract MapaeFactoryTest is MapaeFactoryTestBase {
    // ------------------------------------------------------------------
    // createOffering — verification, wiring, registry
    // ------------------------------------------------------------------

    function test_Create_WiresFullStack() public {
        (Offering o, MembershipToken t, RedeemManager rm) = createAs(creator);
        // creator is always msg.sender (no proxy issuance)
        assertEq(o.creator(), creator);
        assertEq(rm.creator(), creator);
        assertEq(address(rm.token()), address(t));
        assertEq(address(o.token()), address(t));
        // settle authority is the platform ops wallet, not the factory
        assertEq(o.owner(), address(this));
        // recipients wired from factory config, creatorVesting = creator EOA (M2)
        (address cv, address lp, address pf, address rs) = o.recipients();
        assertEq(cv, creator);
        assertEq(lp, lpEscrow);
        assertEq(pf, platform);
        assertEq(rs, reserve);
        // registry
        assertEq(factory.allOfferings().length, 1);
        assertEq(factory.offeringsByCreator(creator)[0], address(o));
        assertEq(factory.redeemManagerOf(address(o)), address(rm));
    }

    function test_Create_RevertUnverified() public {
        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.NotVerifiedCreator.selector, rando));
        factory.createOffering(defaultCreateParams());
    }

    function test_Create_EmitsEvent() public {
        vm.prank(creator);
        vm.expectEmit(true, false, false, false); // only creator topic predictable pre-deploy
        emit MapaeFactory.OfferingCreated(creator, address(0), address(0), address(0));
        factory.createOffering(defaultCreateParams());
    }

    // ------------------------------------------------------------------
    // guide bands
    // ------------------------------------------------------------------

    function test_Create_GuideBands() public {
        MapaeFactory.CreateParams memory cp = defaultCreateParams();

        cp.price = 1000e18 - 1;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.PriceOutOfBand.selector, cp.price));
        factory.createOffering(cp);

        cp = defaultCreateParams();
        cp.raiseTarget = 500_000_000e18 + 1;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.RaiseOutOfBand.selector, cp.raiseTarget));
        factory.createOffering(cp);

        // L below 0.1% of R
        cp = defaultCreateParams();
        cp.walletLimit = RAISE * 10 / 10_000 - 1;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.WalletLimitOutOfBand.selector, cp.walletLimit));
        factory.createOffering(cp);

        // L above 30% of R (test guide max)
        cp = defaultCreateParams();
        cp.walletLimit = RAISE * 3000 / 10_000 + 1;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.WalletLimitOutOfBand.selector, cp.walletLimit));
        factory.createOffering(cp);
    }

    function test_Create_OfferingBandsPropagate() public {
        // duration/f/c/creatorToken checks live in the Offering constructor and
        // must propagate through the factory call.
        MapaeFactory.CreateParams memory cp = defaultCreateParams();
        cp.deadline = block.timestamp + 11 hours;
        vm.prank(creator);
        vm.expectRevert(IOffering.InvalidDuration.selector);
        factory.createOffering(cp);

        cp = defaultCreateParams();
        cp.cBps = 3001;
        vm.prank(creator);
        vm.expectRevert(IOffering.InvalidConfig.selector);
        factory.createOffering(cp);
    }

    function test_SetGuide_OnlyOwner() public {
        MapaeFactory.Guide memory g = MapaeFactory.Guide({
            minPrice: 1e18,
            maxPrice: 2e18,
            minRaise: 1e18,
            maxRaise: 2e18,
            minWalletLimitBps: 10,
            maxWalletLimitBps: 500
        });
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, creator));
        factory.setGuide(g);
        factory.setGuide(g); // owner ok
        (uint256 minPrice,,,,,) = factory.guide();
        assertEq(minPrice, 1e18);
    }

    // ------------------------------------------------------------------
    // one live token per creator
    // ------------------------------------------------------------------

    function test_OneLive_BlocksWhileOpen() public {
        (Offering first,,) = createAs(creator);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.ActiveOfferingExists.selector, creator, address(first)));
        factory.createOffering(defaultCreateParams());
    }

    function test_OneLive_BlocksAfterSuccessfulSettle() public {
        (Offering first,,) = createAs(creator);
        commitAs(first, fan1, WALLET_LIMIT);
        address fan2 = makeAddr("fan2");
        address fan3 = makeAddr("fan3");
        address fan4 = makeAddr("fan4");
        commitAs(first, fan2, WALLET_LIMIT);
        commitAs(first, fan3, WALLET_LIMIT);
        commitAs(first, fan4, 100_000e18); // total 1M = R
        vm.warp(block.timestamp + 24 hours);
        first.settle(leafFor(fan1, 30e18, 0), 100e18, 1_000_000e18, bytes32(0));

        // live token now exists → blocked forever (M2 scope: no sunset rule)
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.ActiveOfferingExists.selector, creator, address(first)));
        factory.createOffering(defaultCreateParams());
    }

    function test_OneLive_ReissueAllowedAfterModeAFailure() public {
        (Offering first, MembershipToken t1,) = createAs(creator);
        commitAs(first, fan1, 100_000e18); // << R
        vm.warp(block.timestamp + 24 hours);
        first.enableRefunds();
        assertTrue(first.refunding());
        assertEq(t1.totalSupply(), 0);

        // failed raise frees the slot — retry is intended product behavior
        vm.warp(1_750_000_000); // rewind so the new deadline is in band
        (Offering second,,) = createAs(creator);
        assertEq(factory.offeringsByCreator(creator).length, 2);
        assertTrue(address(second) != address(first));
    }

    function test_OneLive_ReissueAllowedAfterEmergencyRefund() public {
        (Offering first,,) = createAs(creator);
        commitAs(first, fan1, 100_000e18);
        vm.warp(block.timestamp + 24 hours + 7 days);
        first.emergencyRefund();

        vm.warp(1_750_000_000);
        createAs(creator); // allowed
        assertEq(factory.offeringsByCreator(creator).length, 2);
    }
}
