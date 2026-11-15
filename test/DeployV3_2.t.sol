// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GiwaSepolia} from "../src/Constants.sol";
import {CurveFactory} from "../src/CurveFactory.sol";
import {CurveSale} from "../src/CurveSale.sol";
import {DeployV3} from "../script/DeployV3.s.sol";
import {DeployV3_2} from "../script/DeployV3_2.s.sol";
import {TestWETH9} from "./CurveFactoryETH.t.sol";

/// @notice C-T1: DeployV3_2.deploy() on top of a local v3.1 stack (DeployV3.deploy()).
contract DeployV3_2Test is Test {
    DeployV3.Deployed internal v31;
    DeployV3_2.Deployed internal d;
    address internal deployer = makeAddr("deployer");
    address internal treasury = makeAddr("treasury");
    address internal dev = makeAddr("dev");

    function setUp() public {
        vm.etch(GiwaSepolia.WETH, address(new TestWETH9()).code);
        DeployV3 s31 = new DeployV3();
        v31 = s31.deploy(deployer, treasury);
        DeployV3_2.Reused memory r = DeployV3_2.Reused({
            mockKRW: address(v31.krw),
            mockDojang: address(v31.mockDojang),
            poolFactory: address(v31.poolFactory),
            feeRouter: address(v31.feeRouter),
            mapaeFactory: address(v31.factoryMock),
            membershipTokenDeployer: v31.membershipTokenDeployer
        });
        d = new DeployV3_2().deploy(deployer, r);
    }

    function test_Wiring() public view {
        assertEq(d.adapter.attesterId(), GiwaSepolia.ATTESTER_TESTNET_FAUCET);
        assertEq(d.adapter.schemaUid(), GiwaSepolia.VERIFIED_ADDRESS_SCHEMA_UID);
        assertEq(address(d.dojang.a()), address(d.adapter));
        assertEq(address(d.dojang.b()), address(v31.mockDojang));
        assertEq(address(d.curveFactory.dojang()), address(d.dojang));
        assertEq(address(d.curveFactory.mapaeFactory()), address(v31.factoryMock));
        assertEq(address(d.curveFactory.poolFactory()), address(v31.poolFactory));
        assertEq(address(d.curveFactory.feeRouter()), address(v31.feeRouter));
        assertEq(address(d.curveFactory.weth()), GiwaSepolia.WETH);
        assertEq(d.curveFactory.priorityWindow(), 600);
        assertEq(d.curveFactory.owner(), deployer);
    }

    function test_MockVerifiedWalletOpensAndFirstBuyIsCapped() public {
        // no official attestation in this local chain: the adapter reads false, MockDojang decides
        vm.prank(dev);
        v31.mockDojang.selfVerify();
        assertTrue(d.dojang.isVerified(dev));
        vm.deal(dev, 1 ether);
        vm.prank(dev);
        (address ca,) = d.curveFactory.createCurveWithETH{value: 0.000_05 ether}("Ok", "OK", 0);
        assertEq(address(CurveSale(ca).quote()), GiwaSepolia.WETH);
        vm.prank(dev);
        vm.expectPartialRevert(CurveFactory.DevFirstBuyTooLarge.selector);
        d.curveFactory.createCurveWithETH{value: 0.001 ether}("Big", "BIG", 0);
    }

    function test_UnverifiedCannotOpen() public {
        address anon = makeAddr("anon");
        vm.prank(anon);
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.NotVerified.selector, anon));
        d.curveFactory.createCurve(IERC20(address(v31.krw)), "No", "NO", 0, 0);
    }

    function test_ReusedLibraryCheck() public {
        DeployV3_2.Reused memory r = d.reused;
        r.membershipTokenDeployer = address(0xbeef);
        DeployV3_2 s = new DeployV3_2();
        vm.expectRevert(bytes("DeployV3_2: pass --libraries with the v3.1 MembershipTokenDeployer"));
        s.deploy(deployer, r);
    }
}
