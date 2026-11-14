// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CurvePresets as P} from "../src/CurvePresets.sol";
import {CurveMath} from "../src/lib/CurveMath.sol";

/// @notice Pins every v3 C0 preset (v6.2 §12) and checks the arithmetic they
///         must satisfy. A preset edit must fail here first.
contract CurvePresetsTest is Test {
    // ------------------------------------------------------------------
    // geometry
    // ------------------------------------------------------------------

    function test_Geometry() public pure {
        assertEq(P.TOTAL_SUPPLY, 1_000_000_000e18);
        assertEq(P.CURVE_SUPPLY, 800_000_000e18);
        assertEq(P.DEX_SUPPLY, 200_000_000e18);
        assertEq(P.VIRTUAL_TOKEN_RESERVE, 1_066_666_666_666_666_666_666_666_667);
        // Vt = ceil(S^2 / (S - DEX)) = ceil(3.2B / 3)
        assertEq(
            P.VIRTUAL_TOKEN_RESERVE,
            (P.CURVE_SUPPLY * P.CURVE_SUPPLY + (P.CURVE_SUPPLY - P.DEX_SUPPLY) - 1) / (P.CURVE_SUPPLY - P.DEX_SUPPLY)
        );
        assertEq(P.CURVE_SUPPLY + P.DEX_SUPPLY, P.TOTAL_SUPPLY);
        // curve must be sellable: virtual token reserve exceeds curve supply
        assertGt(P.VIRTUAL_TOKEN_RESERVE, P.CURVE_SUPPLY);
    }

    function test_VirtualQuoteReserves() public pure {
        assertEq(P.VIRTUAL_QUOTE_RESERVE_KRWS, 2_000_000e18);
        assertEq(P.VIRTUAL_QUOTE_RESERVE_WETH, 0.6e18);
    }

    /// @dev Graduation threshold (quote to drain CURVE_SUPPLY) = 3 Vq and closing FDV = 15 Vq
    ///      under Vt = 3.2B/3 (PM 2026-11-14). Tolerance 1e-9 covers integer division.
    function test_GraduationEconomics_Krws() public pure {
        uint256 vq = P.VIRTUAL_QUOTE_RESERVE_KRWS;
        uint256 raised = P.graduationThreshold(vq);
        assertApproxEqRel(raised, 6_000_000e18, 1e9);
        assertApproxEqRel(raised, 3 * vq, 1e9);
        assertApproxEqRel(_closingFdv(vq, raised), 30_000_000e18, 1e9);
        assertApproxEqRel(_closingFdv(vq, raised), 15 * vq, 1e9);
    }

    function test_GraduationEconomics_Weth() public pure {
        uint256 vq = P.VIRTUAL_QUOTE_RESERVE_WETH;
        uint256 raised = P.graduationThreshold(vq);
        assertApproxEqRel(raised, 1.8e18, 1e9);
        assertApproxEqRel(_closingFdv(vq, raised), 9e18, 1e9);
    }

    /// @dev closing / start price = (Vq + r)/(Vt − S) ÷ Vq/Vt = 16, independent of Vq.
    function test_PriceMultiple16x() public pure {
        uint256 vq = P.VIRTUAL_QUOTE_RESERVE_KRWS;
        uint256 raised = P.graduationThreshold(vq);
        uint256 vt = P.VIRTUAL_TOKEN_RESERVE;
        // ratio scaled by 1e18: (vq + r) · Vt / ((Vt − S) · vq)
        uint256 ratio = (vq + raised) * 1e18 / vq * vt / (vt - P.CURVE_SUPPLY);
        assertApproxEqRel(ratio, 16e18, 1e9);
    }

    /// @dev P1: preset closed-form threshold (floor) and CurveMath sell-out cost (ceil) agree within 1 wei.
    function test_P1_ThresholdMatchesCurveMath() public pure {
        _p1(P.VIRTUAL_QUOTE_RESERVE_KRWS);
        _p1(P.VIRTUAL_QUOTE_RESERVE_WETH);
    }

    /// @dev P2: AMM seed price r / DEX_SUPPLY equals the curve closing price (Vq + r)/(Vt − S) within 1e-9.
    function test_P2_ListingPriceContinuity() public pure {
        _p2(P.VIRTUAL_QUOTE_RESERVE_KRWS);
        _p2(P.VIRTUAL_QUOTE_RESERVE_WETH);
    }

    function _params(uint256 vq) internal pure returns (CurveMath.Params memory) {
        return CurveMath.Params({vQuote: vq, vToken: P.VIRTUAL_TOKEN_RESERVE, saleSupply: P.CURVE_SUPPLY});
    }

    function _closingFdv(uint256 vq, uint256 raised) internal pure returns (uint256) {
        // closing spot = (vq + raised) / (vToken - curve); FDV = spot × TOTAL_SUPPLY
        return (vq + raised) * P.TOTAL_SUPPLY / (P.VIRTUAL_TOKEN_RESERVE - P.CURVE_SUPPLY);
    }

    function _p1(uint256 vq) internal pure {
        uint256 preset = P.graduationThreshold(vq);
        uint256 math = CurveMath.costToSellOut(_params(vq), 0, 0);
        uint256 diff = preset > math ? preset - math : math - preset;
        assertLe(diff, 1, "P1");
    }

    function _p2(uint256 vq) internal pure {
        uint256 r = CurveMath.costToSellOut(_params(vq), 0, 0);
        // Compare r/DEX vs (vq + r)/(Vt − S) by cross-multiplication, scaled by 1e18.
        uint256 seed = r * 1e18 / P.DEX_SUPPLY;
        uint256 close = (vq + r) * 1e18 / (P.VIRTUAL_TOKEN_RESERVE - P.CURVE_SUPPLY);
        assertApproxEqRel(seed, close, 1e9, "P2");
    }

    // ------------------------------------------------------------------
    // fees
    // ------------------------------------------------------------------

    function test_Fees() public pure {
        assertEq(P.CURVE_FEE_PLATFORM_BPS, 50);
        assertEq(P.CURVE_FEE_DEV_BPS, 35);
        assertEq(P.CURVE_FEE_LP_SEED_BPS, 15);
        assertEq(P.CURVE_FEE_PLATFORM_BPS + P.CURVE_FEE_DEV_BPS + P.CURVE_FEE_LP_SEED_BPS, 100);

        assertEq(P.SWAP_FEE_PLATFORM_BPS, 40);
        assertEq(P.SWAP_FEE_DEV_BPS, 30);
        assertEq(P.SWAP_FEE_LP_BPS, 30);
        assertEq(P.SWAP_FEE_PLATFORM_BPS + P.SWAP_FEE_DEV_BPS + P.SWAP_FEE_LP_BPS, 100);
    }

    // ------------------------------------------------------------------
    // buyback
    // ------------------------------------------------------------------

    function test_Buyback() public pure {
        assertEq(P.BUYBACK_BPS, 5000);
        assertEq(P.BPS, 10_000);
    }
}
