// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CurvePresets as P} from "../src/CurvePresets.sol";

/// @notice Pins every v3 C0 preset (v6.1 §12) and checks the arithmetic they
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

    /// @dev Constant product: quote needed to drain CURVE_SUPPLY from the
    ///      virtual reserves is V * curve / (vToken - curve) ≈ 2.93 V, and the
    ///      final spot ≈ 14.4 V / DEX_SUPPLY FDV (v6.1 §12 rationale).
    function test_GraduationEconomics() public pure {
        uint256 vq = P.VIRTUAL_QUOTE_RESERVE_KRWS;
        uint256 raised = vq * P.CURVE_SUPPLY / (P.VIRTUAL_TOKEN_RESERVE - P.CURVE_SUPPLY);
        // ≈ 2.93 × V
        assertApproxEqRel(raised, vq * 293 / 100, 0.01e18);

        // closing spot = (vq + raised) / (vToken - curve); FDV = spot × TOTAL_SUPPLY
        uint256 fdv = (vq + raised) * P.TOTAL_SUPPLY / (P.VIRTUAL_TOKEN_RESERVE - P.CURVE_SUPPLY);
        // ≈ 14.4 × V
        assertApproxEqRel(fdv, vq * 144 / 10, 0.01e18);
    }

    // ------------------------------------------------------------------
    // graduation N
    // ------------------------------------------------------------------

    function test_GraduationN() public pure {
        assertEq(P.GRADUATION_N_TESTNET, 10);
        assertEq(P.GRADUATION_N_MAINNET, 30);
    }

    // ------------------------------------------------------------------
    // per-wallet caps
    // ------------------------------------------------------------------

    function test_Caps() public pure {
        assertEq(P.CAP_PROGRESS_MID_BPS, 2500);
        assertEq(P.CAP_PROGRESS_LATE_BPS, 7500);
        assertEq(P.CAP_EARLY_BPS, 100);
        assertEq(P.CAP_MID_BPS, 200);
        assertEq(P.CAP_LATE_BPS, 300);
        assertLt(P.CAP_EARLY_BPS, P.CAP_MID_BPS);
        assertLt(P.CAP_MID_BPS, P.CAP_LATE_BPS);
    }

    /// @dev With a 3% cap, the curve (80% of supply) needs ≥ 27 wallets purely
    ///      arithmetically; N=30 mainnet is above that, so N is the binding
    ///      constraint and cannot be trivially met by cap-maxing wallets.
    function test_CapVsGraduationN() public pure {
        uint256 maxPerWallet = P.TOTAL_SUPPLY * P.CAP_LATE_BPS / P.BPS;
        uint256 minWallets = (P.CURVE_SUPPLY + maxPerWallet - 1) / maxPerWallet;
        assertEq(minWallets, 27);
        assertGe(P.GRADUATION_N_MAINNET, minWallets);
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
    // refund floor / buyback
    // ------------------------------------------------------------------

    function test_RefundFloor() public pure {
        assertEq(P.REFUND_FLOOR_BPS, 5000);
        assertEq(P.REFUND_DEADLINE, 72 hours);
    }

    function test_Buyback() public pure {
        assertEq(P.BUYBACK_BPS, 5000);
        assertEq(P.BPS, 10_000);
    }
}
