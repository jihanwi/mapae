// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GiwaSepolia} from "../src/Constants.sol";
import {CurveFactory} from "../src/CurveFactory.sol";
import {CurveSale} from "../src/CurveSale.sol";
import {DeployV3} from "../script/DeployV3.s.sol";
import {DeployV3_2} from "../script/DeployV3_2.s.sol";
import {DeployV3_5} from "../script/DeployV3_5.s.sol";
import {TestWETH9} from "./CurveFactoryETH.t.sol";

/// @notice C-T5: DeployV3_5.deploy() on a local v3.1 + v3.2 stack.
contract DeployV3_5Test is Test {
    DeployV3.Deployed internal v31;
    DeployV3_2.Deployed internal v32;
    DeployV3_5 internal script;
    address internal deployer = makeAddr("deployer");
    address internal treasury = makeAddr("treasury");
    address internal dev = makeAddr("dev");

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
        script = new DeployV3_5();
    }

    function _reused() internal view returns (DeployV3_5.Reused memory) {
        return DeployV3_5.Reused({
            dojangAnyOf: address(v32.dojang),
            feeRouter: address(v31.feeRouter),
            poolFactory: address(v31.poolFactory),
            mapaeFactory: address(v31.factoryMock),
            mockKRW: address(v31.krw),
            membershipTokenDeployer: v31.membershipTokenDeployer,
            oldCurveFactory: address(v32.curveFactory)
        });
    }

    function test_DeploysTheCapFactoryOnTheReusedStack() public {
        DeployV3_5.Deployed memory d = script.deploy(deployer, _reused());
        CurveFactory f = d.curveFactory;
        assertEq(f.priorityMaxHoldingBps(), 200);
        assertEq(f.priorityWindow(), 600);
        assertEq(address(f.dojang()), address(v32.dojang));
        assertEq(address(f.mapaeFactory()), address(v31.factoryMock));
        assertEq(f.owner(), deployer);
        assertTrue(f.curveEnabled());

        // a curve opened on it carries the 2% cap
        vm.prank(dev);
        v31.mockDojang.selfVerify();
        vm.prank(dev);
        (address ca,) = f.createCurve(IERC20(address(v31.krw)), "Cap", "CAP", 0, 0);
        assertEq(CurveSale(ca).priorityMaxHolding(), 20_000_000e18);
    }

    function test_StopsWithoutTheLinkedLibrary() public {
        DeployV3_5.Reused memory r = _reused();
        r.membershipTokenDeployer = address(0xbeef);
        vm.expectRevert(bytes("DeployV3_5: pass --libraries with the v3.2 MembershipTokenDeployer"));
        script.deploy(deployer, r);
    }
}
