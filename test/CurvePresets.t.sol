// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CurvePresets as P} from "../src/CurvePresets.sol";

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
        assertEq(P.VIRTUAL_TOKEN_RESERVE, 1_073_000_000e18);
        assertEq(P.CURVE_SUPPLY + P.DEX_SUPPLY, P.TOTAL_SUPPLY);
        // curve must be sellable: virtual token reserve exceeds curve supply
        assertGt(P.VIRTUAL_TOKEN_RESERVE, P.CURVE_SUPPLY);
    }

    function test_VirtualQuoteReserves() public pure {
        assertEq(P.VIRTUAL_QUOTE_RESERVE_KRWS, 2_000_000e18);
        assertEq(P.VIRTUAL_QUOTE_RESERVE_WETH, 0.6e18);
    }

    /// @dev Graduation threshold (quote to drain CURVE_SUPPLY) ≈ 2.93 V and
    ///      closing FDV ≈ 14.4 V, reproducing the v6.2 §12 rationale.
    function test_GraduationEconomics() public pure {
        uint256 vq = P.VIRTUAL_QUOTE_RESERVE_KRWS;
        uint256 raised = P.graduationThreshold(vq);
        assertApproxEqRel(raised, vq * 293 / 100, 0.01e18);

        // closing spot = (vq + raised) / (vToken - curve); FDV = spot × TOTAL_SUPPLY
        uint256 fdv = (vq + raised) * P.TOTAL_SUPPLY / (P.VIRTUAL_TOKEN_RESERVE - P.CURVE_SUPPLY);
        assertApproxEqRel(fdv, vq * 144 / 10, 0.01e18);
    }

    /// @dev Threshold is linear in the virtual quote reserve, so the WETH
    ///      preset scales identically (≈ 1.76 ETH).
    function test_GraduationThreshold_Weth() public pure {
        uint256 raised = P.graduationThreshold(P.VIRTUAL_QUOTE_RESERVE_WETH);
        assertApproxEqRel(raised, 1.76e18, 0.01e18);
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
