// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {GiwaSepolia} from "../src/Constants.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {DeployV3} from "../script/DeployV3.s.sol";
import {DeployV3_2} from "../script/DeployV3_2.s.sol";
import {DeployV3_2_L1} from "../script/DeployV3_2_L1.s.sol";
import {DeployV3_3_L1} from "../script/DeployV3_3_L1.s.sol";
import {TestWETH9} from "./CurveFactoryETH.t.sol";

/// @notice C-T3: DeployV3_3_L1.deploy() on a local v3.1 + v3.2 + v3.2-L1 stack.
contract DeployV3_3_L1Test is Test {
    DeployV3.Deployed internal v31;
    DeployV3_2.Deployed internal v32;
    DeployV3_2_L1.Deployed internal l1;
    DeployV3_3_L1 internal script;
    address internal deployer = makeAddr("deployer");
    address internal treasury = makeAddr("treasury");

    function setUp() public virtual {
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
        l1 = new DeployV3_2_L1()
            .deploy(
                deployer,
                DeployV3_2_L1.Reused({
                    oldFactory: address(v31.factoryMock),
                    dojangAnyOf: address(v32.dojang),
                    mockKRW: address(v31.krw),
                    poolFactory: address(v31.poolFactory),
                    feeRouter: address(v31.feeRouter),
                    buybackVault: address(v31.buybackVault),
                    membershipTokenDeployer: v31.membershipTokenDeployer
                })
            );
        script = new DeployV3_3_L1();
    }

    function _reused() internal view returns (DeployV3_3_L1.Reused memory) {
        return DeployV3_3_L1.Reused({
            oldFactory: address(l1.factory),
            oldFeeRouter: address(v31.feeRouter),
            dojangAnyOf: address(v32.dojang),
            mockKRW: address(v31.krw),
            poolFactory: address(v31.poolFactory),
            buybackVault: address(v31.buybackVault),
            proceedsLockDeployer: address(l1.proceedsLockDeployer),
            membershipTokenDeployer: v31.membershipTokenDeployer
        });
    }

    function test_DeploysRouterAndFactory_SettingsCopied() public {
        DeployV3_3_L1.Deployed memory d = script.deploy(deployer, _reused());
        FeeRouter fr = d.feeRouter;
        assertEq(fr.owner(), v31.feeRouter.owner());
        assertEq(fr.platformTreasury(), treasury);
        IFeeRouter.TierFees memory f = fr.getFees(IFeeRouter.UtilityTier.L1);
        assertEq(abi.encode(f), abi.encode(IFeeRouter.TierFees(0, 40, 60, 30, 20, 400)));
        MapaeFactory nf = d.factory;
        assertEq(address(nf.feeRouter()), address(fr));
        assertEq(address(nf.proceedsLockDeployer()), address(l1.proceedsLockDeployer), "lock deployer reused");
        assertTrue(address(nf.offeringDeployer()) != address(l1.factory.offeringDeployer()), "offering deployer is new");
        assertEq(nf.owner(), script.PLATFORM_OWNER());
        assertEq(nf.platformOwner(), script.PLATFORM_OWNER());
        assertEq(nf.minRaise(), l1.factory.minRaise());
        assertEq(nf.feeRecipients(), l1.factory.feeRecipients());
        assertEq(abi.encode(nf.proceedsBand()), abi.encode(l1.factory.proceedsBand()));
        assertEq(nf.allOfferings().length, 0);
        assertTrue(nf.isBurner(address(v31.buybackVault)));
        // the L0 router and the old L1 factory are untouched
        assertEq(address(l1.factory.feeRouter()), address(v31.feeRouter));
    }

    function test_StopsOnWrongOldRouter() public {
        DeployV3_3_L1.Reused memory r = _reused();
        r.oldFeeRouter = address(new FeeRouter(deployer, treasury));
        vm.expectRevert(bytes("DeployV3_3_L1: old factory FeeRouter"));
        script.deploy(deployer, r);
    }
}
