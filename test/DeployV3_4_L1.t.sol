// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MapaeFactory} from "../src/MapaeFactory.sol";
import {DeployV3_3_L1} from "../script/DeployV3_3_L1.s.sol";
import {DeployV3_4_L1} from "../script/DeployV3_4_L1.s.sol";
import {DeployV3_3_L1Test} from "./DeployV3_3_L1.t.sol";

/// @notice C-T4: DeployV3_4_L1.deploy() on a local v3.1 + v3.2 + v3.2-L1 + v3.3-L1 stack.
contract DeployV3_4_L1Test is DeployV3_3_L1Test {
    DeployV3_3_L1.Deployed internal l13;
    DeployV3_4_L1 internal script34;
    address internal owner34 = makeAddr("owner34");
    address internal settler34 = makeAddr("settler34");

    function setUp() public override {
        super.setUp();
        l13 = script.deploy(deployer, _reused());
        script34 = new DeployV3_4_L1();
    }

    function _reused34() internal view returns (DeployV3_4_L1.Reused memory) {
        return DeployV3_4_L1.Reused({
            oldFactory: address(l13.factory),
            feeRouter: address(l13.feeRouter),
            dojangAnyOf: address(v32.dojang),
            mockKRW: address(v31.krw),
            poolFactory: address(v31.poolFactory),
            buybackVault: address(v31.buybackVault),
            proceedsLockDeployer: address(l1.proceedsLockDeployer),
            membershipTokenDeployer: v31.membershipTokenDeployer
        });
    }

    function test_DeploysFactory_SettingsCopiedRouterReused() public {
        DeployV3_4_L1.Deployed memory d = script34.deploy(deployer, _reused34(), owner34, settler34);
        MapaeFactory nf = d.factory;
        MapaeFactory old = l13.factory;
        assertEq(address(nf.feeRouter()), address(l13.feeRouter), "v3.3-L1 FeeRouter reused");
        assertEq(nf.owner(), owner34);
        assertEq(nf.platformOwner(), owner34);
        assertEq(nf.settler(), settler34);
        assertEq(address(nf.proceedsLockDeployer()), address(l1.proceedsLockDeployer));
        assertTrue(address(nf.offeringDeployer()) != address(old.offeringDeployer()), "offering deployer is new");
        assertEq(nf.minRaise(), old.minRaise());
        assertEq(nf.feeRecipients(), old.feeRecipients());
        assertEq(abi.encode(nf.proceedsBand()), abi.encode(old.proceedsBand()));
        assertEq(nf.allOfferings().length, 0);
        assertTrue(nf.isBurner(address(v31.buybackVault)));
        // the v3.3-L1 factory is untouched
        assertEq(old.settler(), address(0));
        assertEq(address(old.feeRouter()), address(l13.feeRouter));
    }

    function test_ZeroSettlerAllowed() public {
        DeployV3_4_L1.Deployed memory d = script34.deploy(deployer, _reused34(), owner34, address(0));
        assertEq(d.factory.settler(), address(0));
    }

    function test_StopsOnZeroOwner() public {
        vm.expectRevert(bytes("DeployV3_4_L1: PLATFORM_OWNER is zero"));
        script34.deploy(deployer, _reused34(), address(0), settler34);
    }

    function test_StopsOnWrongRouter() public {
        DeployV3_4_L1.Reused memory r = _reused34();
        r.feeRouter = address(v31.feeRouter);
        vm.expectRevert(bytes("DeployV3_4_L1: old factory FeeRouter"));
        script34.deploy(deployer, r, owner34, settler34);
    }
}
