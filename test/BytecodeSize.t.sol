// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

/// @notice EIP-170 (runtime ≤ 24,576 B) and EIP-3860 (initcode ≤ 49,152 B)
///         guard over every deployable production contract (지시서 v3.1 C8).
///         Add new contracts here; a size regression fails CI before deploy.
contract BytecodeSizeTest is Test {
    uint256 internal constant EIP170_RUNTIME_MAX = 24_576;
    uint256 internal constant EIP3860_INITCODE_MAX = 49_152;

    /// @dev Headroom OfferingDeployer must keep so Offering logic changes
    ///      (C1~C7) don't silently eat the budget again. Pre-C8 margin was 442.
    uint256 internal constant OFFERING_DEPLOYER_MIN_MARGIN = 4_096;

    function _contracts() internal pure returns (string[] memory c) {
        c = new string[](18);
        c[0] = "MapaeFactory.sol:MapaeFactory";
        c[1] = "OfferingDeployer.sol:OfferingDeployer";
        c[2] = "StackDeployer.sol:StackDeployer";
        c[3] = "Offering.sol:Offering";
        c[4] = "MembershipToken.sol:MembershipToken";
        c[5] = "MembershipTokenDeployer.sol:MembershipTokenDeployer";
        c[6] = "MapaePool.sol:MapaePool";
        c[7] = "PoolFactory.sol:PoolFactory";
        c[8] = "FeeRouter.sol:FeeRouter";
        c[9] = "BuybackVault.sol:BuybackVault";
        c[10] = "BuybackExecutor.sol:BuybackExecutor";
        c[11] = "MapaeVesting.sol:MapaeVesting";
        c[12] = "RedeemManager.sol:RedeemManager";
        c[13] = "Sponsorship.sol:Sponsorship";
        c[14] = "DojangEASAdapter.sol:DojangEASAdapter";
        c[15] = "MockKRW.sol:MockKRW";
        c[16] = "CurveSale.sol:CurveSale";
        c[17] = "CurveFactory.sol:CurveFactory";
    }

    function test_AllContracts_UnderEip170AndEip3860() public view {
        string[] memory c = _contracts();
        for (uint256 i; i < c.length; ++i) {
            uint256 runtime = vm.getDeployedCode(c[i]).length;
            uint256 initcode = vm.getCode(c[i]).length;
            assertGt(runtime, 0, string.concat("empty runtime: ", c[i]));
            assertLe(runtime, EIP170_RUNTIME_MAX, string.concat("EIP-170: ", c[i]));
            assertLe(initcode, EIP3860_INITCODE_MAX, string.concat("EIP-3860: ", c[i]));
        }
    }

    function test_OfferingDeployer_KeepsHeadroom() public view {
        uint256 runtime = vm.getDeployedCode("OfferingDeployer.sol:OfferingDeployer").length;
        assertLe(runtime + OFFERING_DEPLOYER_MIN_MARGIN, EIP170_RUNTIME_MAX, "OfferingDeployer headroom < 4 KiB");
    }

    /// @dev The factory's initcode embeds both deployers' creation code; it is
    ///      the next-tightest budget after OfferingDeployer.
    function test_MapaeFactory_InitcodeKeepsHeadroom() public view {
        uint256 initcode = vm.getCode("MapaeFactory.sol:MapaeFactory").length;
        assertLe(initcode + OFFERING_DEPLOYER_MIN_MARGIN, EIP3860_INITCODE_MAX, "MapaeFactory initcode headroom < 4 KiB");
    }
}
