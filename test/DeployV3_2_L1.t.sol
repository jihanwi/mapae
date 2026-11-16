// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {GiwaSepolia} from "../src/Constants.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {DeployV3} from "../script/DeployV3.s.sol";
import {DeployV3_2} from "../script/DeployV3_2.s.sol";
import {DeployV3_2_L1} from "../script/DeployV3_2_L1.s.sol";
import {TestWETH9} from "./CurveFactoryETH.t.sol";

/// @notice C-T2: DeployV3_2_L1.deploy() on a local v3.1 + v3.2 stack.
contract DeployV3_2_L1Test is Test {
    DeployV3.Deployed internal v31;
    DeployV3_2.Deployed internal v32;
    DeployV3_2_L1 internal script;
    address internal deployer = makeAddr("deployer");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        vm.etch(GiwaSepolia.WETH, address(new TestWETH9()).code);
        v31 = new DeployV3().deploy(deployer, treasury);
        v32 = new DeployV3_2()
            .deploy(
                deployer,
                DeployV3_2.Reused({
                    mockKRW: address(v31.krw),
                    mockDojang: address(v31.mockDojang),
                    poolFactory: address(v31.poolFactory),
                    feeRouter: address(v31.feeRouter),
                    mapaeFactory: address(v31.factoryMock),
                    membershipTokenDeployer: v31.membershipTokenDeployer
                })
            );
        script = new DeployV3_2_L1();
    }

    function _reused() internal view returns (DeployV3_2_L1.Reused memory) {
        return DeployV3_2_L1.Reused({
            oldFactory: address(v31.factoryMock),
            dojangAnyOf: address(v32.dojang),
            mockKRW: address(v31.krw),
            poolFactory: address(v31.poolFactory),
            feeRouter: address(v31.feeRouter),
            buybackVault: address(v31.buybackVault),
            membershipTokenDeployer: v31.membershipTokenDeployer
        });
    }

    function test_DeploysAndChecks() public {
        DeployV3_2_L1.Deployed memory d = script.deploy(deployer, _reused());
        MapaeFactory f = d.factory;
        assertEq(address(f.dojang()), address(v32.dojang), "real names from DojangAnyOf");
        assertEq(f.owner(), script.PLATFORM_OWNER());
        assertEq(f.platformOwner(), script.PLATFORM_OWNER());
        assertEq(f.allOfferings().length, 0);
        MapaeFactory.ProceedsBand memory b = f.proceedsBand();
        assertEq(b.maxUpfrontBps, 3000);
        assertEq(b.minLockDuration, 1 hours);
        assertEq(b.maxLockDuration, 1095 days);
        assertEq(b.maxLockCliff, 180 days);
        assertEq(f.minRaise(), v31.factoryMock.minRaise());
        assertEq(f.feeRecipients(), treasury);
        assertEq(address(f.buybackVault()), address(v31.buybackVault));
        assertTrue(f.isBurner(address(v31.buybackVault)));
        // the L0 quote registry stays on the old factory
        assertTrue(v31.factoryMock.isQuoteAllowed(address(v31.krw)));
        assertFalse(f.isQuoteAllowed(address(v31.krw)));
    }

    function test_StopsWhenTheGuideDiffers() public {
        vm.prank(deployer);
        v31.factoryMock
            .setGuide(
                MapaeFactory.Guide({
                    minPrice: 1000e18,
                    maxPrice: 100_000e18,
                    minRaise: 5_000_000e18,
                    maxRaise: 500_000_000e18,
                    minWalletLimitBps: 10,
                    maxWalletLimitBps: 2000
                })
            );
        DeployV3_2_L1.Reused memory r = _reused();
        vm.expectRevert(bytes("DeployV3_2_L1: guide differs"));
        script.deploy(deployer, r);
    }
}
