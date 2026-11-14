// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {Offering} from "../src/Offering.sol";
import {CurvePresets} from "../src/CurvePresets.sol";
import {MapaeFactoryTestBase} from "./MapaeFactory.t.sol";

/// @dev 6-decimals quote stand-in (USDT/USDC-style KRWs variant).
contract MockQuote6 is ERC20 {
    constructor() ERC20("Mock Quote 6", "MQ6") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/// @notice C1 quote registry on MapaeFactory (MAPAE v3 / Phase 1 / T3), R1..R7.
contract QuoteRegistryTest is MapaeFactoryTestBase {
    MockQuote6 internal mock6;
    address internal rando = makeAddr("rando");

    function setUp() public override {
        super.setUp();
        mock6 = new MockQuote6();
    }

    // R1 onlyOwner
    function test_R1_OnlyOwner() public {
        vm.startPrank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        factory.allowQuote(IERC20(address(mock6)), 1);
        vm.stopPrank();

        factory.allowQuote(IERC20(address(mock6)), 1);
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        factory.setQuoteEnabled(address(mock6), false);
    }

    // R2 duplicate / zero address / zero value
    function test_R2_DuplicateAndZeroReverts() public {
        vm.expectRevert(MapaeFactory.ZeroAddress.selector);
        factory.allowQuote(IERC20(address(0)), 1);

        vm.expectRevert(MapaeFactory.ZeroCurveVirtualQuote.selector);
        factory.allowQuote(IERC20(address(mock6)), 0);

        factory.allowQuote(IERC20(address(mock6)), 123);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.QuoteAlreadyRegistered.selector, address(mock6)));
        factory.allowQuote(IERC20(address(mock6)), 123);
        // a different value is also a re-registration attempt
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.QuoteAlreadyRegistered.selector, address(mock6)));
        factory.allowQuote(IERC20(address(mock6)), 456);
        // disabling does not reopen registration
        factory.setQuoteEnabled(address(mock6), false);
        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.QuoteAlreadyRegistered.selector, address(mock6)));
        factory.allowQuote(IERC20(address(mock6)), 456);

        assertEq(factory.allQuotes().length, 1);
    }

    // R3 immutability under arbitrary toggles
    function testFuzz_R3_ConfigImmutableUnderToggles(uint256 vq, bool[16] calldata toggles, uint8 n) public {
        vq = bound(vq, 1, type(uint128).max);
        factory.allowQuote(IERC20(address(mock6)), vq);
        n = uint8(bound(n, 0, 16));
        for (uint256 i; i < n; ++i) {
            factory.setQuoteEnabled(address(mock6), toggles[i]);
            MapaeFactory.QuoteConfig memory c = factory.quoteConfig(address(mock6));
            assertTrue(c.registered);
            assertEq(c.enabled, toggles[i]);
            assertEq(c.decimals, 6);
            assertEq(c.curveVirtualQuote, vq);
        }
        assertEq(factory.allQuotes().length, 1);
    }

    // R4 decimals capture
    function test_R4_DecimalsCaptured() public {
        vm.expectEmit(true, false, false, true, address(factory));
        emit MapaeFactory.QuoteAllowed(address(mock6), 6, CurvePresets.krwsVirtualQuote(6));
        factory.allowQuote(IERC20(address(mock6)), CurvePresets.krwsVirtualQuote(6));

        factory.allowQuote(IERC20(address(krw)), CurvePresets.krwsVirtualQuote(18));

        MapaeFactory.QuoteConfig memory c6 = factory.quoteConfig(address(mock6));
        MapaeFactory.QuoteConfig memory c18 = factory.quoteConfig(address(krw));
        assertEq(c6.decimals, 6);
        assertEq(c6.curveVirtualQuote, 2_000_000e6);
        assertEq(c18.decimals, 18);
        assertEq(c18.curveVirtualQuote, 2_000_000e18);

        address[] memory all = factory.allQuotes();
        assertEq(all.length, 2);
        assertEq(all[0], address(mock6));
        assertEq(all[1], address(krw));
    }

    // R5 enable toggle
    function test_R5_EnableToggle() public {
        assertFalse(factory.isQuoteAllowed(address(mock6)));

        vm.expectRevert(abi.encodeWithSelector(MapaeFactory.QuoteNotRegistered.selector, address(mock6)));
        factory.setQuoteEnabled(address(mock6), true);

        factory.allowQuote(IERC20(address(mock6)), 1);
        assertTrue(factory.isQuoteAllowed(address(mock6)));

        vm.expectEmit(true, false, false, true, address(factory));
        emit MapaeFactory.QuoteEnabledSet(address(mock6), false);
        factory.setQuoteEnabled(address(mock6), false);
        assertFalse(factory.isQuoteAllowed(address(mock6)));

        factory.setQuoteEnabled(address(mock6), true);
        assertTrue(factory.isQuoteAllowed(address(mock6)));
        factory.setQuoteEnabled(address(mock6), false);
        assertFalse(factory.isQuoteAllowed(address(mock6)));
    }

    // R6 fixed-price offerings settle in paymentToken only, before and after other quotes exist
    function test_R6_FixedOfferingSettlesInPaymentTokenOnly() public {
        address pay = address(factory.paymentToken());

        _create(creator, l0CreateParams());
        _create(creator, defaultCreateParams()); // L1 (separate membership bucket)
        MapaeFactory.CreateParams memory l2 = defaultCreateParams();
        l2.tier = IFeeRouter.UtilityTier.L2;
        _create(creator2, l2);

        factory.allowQuote(IERC20(address(mock6)), CurvePresets.krwsVirtualQuote(6));
        _create(creator, l0CreateParams()); // after registry has a foreign quote

        address[] memory all = factory.allOfferings();
        assertEq(all.length, 4);
        for (uint256 i; i < all.length; ++i) {
            assertEq(address(Offering(all[i]).settlementToken()), pay);
            assertEq(address(Offering(all[i]).paymentToken()), pay);
        }
    }

    // R7 preset wiring: stored raw value yields the 6M-won threshold at 6 decimals
    function test_R7_PresetWiring() public {
        factory.allowQuote(IERC20(address(mock6)), CurvePresets.krwsVirtualQuote(6));
        uint256 stored = factory.quoteConfig(address(mock6)).curveVirtualQuote;
        assertApproxEqRel(CurvePresets.graduationThreshold(stored), 6_000_000e6, 1e9);
    }

    function _create(address who, MapaeFactory.CreateParams memory cp) internal {
        vm.prank(who);
        factory.createOffering(cp);
    }
}
