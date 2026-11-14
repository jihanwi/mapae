// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {GiwaSepolia} from "../src/Constants.sol";
import {CurveSale} from "../src/CurveSale.sol";
import {CurvePresets} from "../src/CurvePresets.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {DeployV3} from "../script/DeployV3.s.sol";
import {DemoCurve} from "../script/DemoCurve.s.sol";
import {TestWETH9} from "./CurveFactoryETH.t.sol";

/// @notice T12: runs DemoCurve scenario A and B (the script's own functions, not a copy) on top of
///         a local DeployV3 deployment. Every require-based self-check inside the script must pass.
contract DemoCurveSimTest is Test {
    DeployV3.Deployed internal d;
    DemoCurve internal demo;
    DemoCurve.Ctx internal ctx;
    address internal deployer = makeAddr("deployer");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        vm.etch(GiwaSepolia.WETH, address(new TestWETH9()).code);
        d = (new DeployV3()).deploy(deployer, treasury);
        vm.deal(deployer, 1 ether);
        demo = new DemoCurve();
        ctx = DemoCurve.Ctx({
            operator: deployer,
            krw: d.krw,
            dojang: d.mockDojang,
            curveFactory: d.curveFactoryMock,
            feeRouter: d.feeRouter,
            baseIdx: 20,
            gasTopUp: 0.0003 ether
        });
    }

    function test_ScenarioA_KrwsCurveTwelveBuyers() public {
        uint256 g = gasleft();
        DemoCurve.Result memory a = demo.scenarioA(ctx);
        emit log_named_uint("DemoCurve scenario A gas (simulated)", g - gasleft());
        assertTrue(CurveSale(a.curve).graduated());
        assertEq(a.verifiedBuyers, 12);
        assertEq(MapaePool(a.pool).totalFeeBps(), 100);
        assertGt(a.devFeesClaimed, 0);
        assertGt(a.platformFeesSwept, 0);
        assertEq(MembershipToken(a.token).balanceOf(treasury), 0);
        assertGe(d.krw.balanceOf(treasury), a.platformFeesSwept); // + pool swap platform cut
    }

    function test_ScenarioB_EthSelfGraduation() public {
        uint256 opBefore = deployer.balance;
        DemoCurve.Result memory b = demo.scenarioB(ctx);
        assertTrue(CurveSale(b.curve).graduated());
        assertEq(address(CurveSale(b.curve).quote()), GiwaSepolia.WETH);
        assertEq(MapaePool(b.pool).totalFeeBps(), 100);
        assertEq(b.verifiedBuyers, 0, "dev self-buy is not counted");
        assertGt(b.devFeesClaimed, 0);
        assertEq(MembershipToken(b.token).balanceOf(treasury), 0);
        // operator funded ≈ 0.006 ETH budget (+1% fee) + gas top-up
        uint256 funded = opBefore - deployer.balance;
        emit log_named_uint("DemoCurve scenario B ETH funded (wei)", funded);
        assertLt(funded, 0.0065 ether);
        assertGt(funded, 0.006 ether);
    }

    function test_BothScenariosSequential() public {
        demo.scenarioA(ctx);
        demo.scenarioB(ctx);
        assertEq(d.curveFactoryMock.allCurves().length, 2);
    }
}
