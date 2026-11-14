// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GiwaSepolia} from "../src/Constants.sol";
import {DeployV3} from "../script/DeployV3.s.sol";
import {TestWETH9} from "./CurveFactoryETH.t.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

/// @notice T12 / T14 (v3.1): DeployV3.deploy() against a local chain with a WETH mock etched at the predeploy.
contract DeployV3Test is Test {
    DeployV3 internal script;
    DeployV3.Deployed internal d;
    address internal deployer = makeAddr("deployer");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        vm.etch(GiwaSepolia.WETH, address(new TestWETH9()).code);
        script = new DeployV3();
        d = script.deploy(deployer, treasury);
    }

    function test_TreasurySeparateFromDeployer() public view {
        assertTrue(d.treasury != d.deployer);
        assertEq(d.feeRouter.platformTreasury(), treasury);
        assertEq(d.feeRouter.owner(), deployer);
        (address platform) = d.factoryMock.feeRecipients();
        assertEq(platform, treasury);
        (platform) = d.factoryDojang.feeRecipients();
        assertEq(platform, treasury);
    }

    function test_QuoteRegistry() public view {
        address krw = address(d.krw);
        for (uint256 i; i < 2; ++i) {
            MapaeFactoryLike f = MapaeFactoryLike(address(i == 0 ? d.factoryMock : d.factoryDojang));
            assertTrue(f.isQuoteAllowed(krw), "KRWs allowed");
            assertTrue(f.isQuoteAllowed(GiwaSepolia.WETH), "WETH allowed");
            assertEq(d.factoryMock.quoteConfig(krw).curveVirtualQuote, 2_000_000e18);
            assertEq(d.factoryDojang.quoteConfig(krw).curveVirtualQuote, 2_000_000e18);
            assertEq(d.factoryMock.quoteConfig(GiwaSepolia.WETH).curveVirtualQuote, 0.002 ether);
            assertEq(d.factoryDojang.quoteConfig(GiwaSepolia.WETH).curveVirtualQuote, 0.002 ether);
            assertEq(d.factoryMock.quoteConfig(GiwaSepolia.WETH).decimals, 18);
        }
        assertEq(d.wethVirtualQuote, 0.002 ether);
        assertEq(d.krwsVirtualQuote, 2_000_000e18);
    }

    function test_CurveFactoryWiring() public view {
        assertEq(address(d.curveFactoryMock.weth()), GiwaSepolia.WETH);
        assertEq(address(d.curveFactoryDojang.weth()), GiwaSepolia.WETH);
        assertEq(address(d.curveFactoryMock.mapaeFactory()), address(d.factoryMock));
        assertEq(address(d.curveFactoryDojang.mapaeFactory()), address(d.factoryDojang));
        assertEq(address(d.curveFactoryMock.dojang()), address(d.mockDojang));
        assertEq(address(d.curveFactoryDojang.dojang()), address(d.adapter));
        assertEq(address(d.curveFactoryMock.poolFactory()), address(d.poolFactory));
        assertEq(address(d.curveFactoryMock.feeRouter()), address(d.feeRouter));
        assertEq(d.curveFactoryMock.owner(), deployer);
        assertTrue(d.curveFactoryMock.curveEnabled());
        assertEq(d.buybackVault.executor(), address(d.buybackExecutor));
        assertTrue(d.membershipTokenDeployer.code.length > 0, "linked library found");
    }

    /// @dev Simulated deployment gas (single call; real broadcast adds ~21k base per tx).
    function test_DeployGasEstimate() public {
        DeployV3 s2 = new DeployV3();
        uint256 g = gasleft();
        s2.deploy(makeAddr("deployer2"), treasury);
        emit log_named_uint("DeployV3.deploy gas (simulated)", g - gasleft());
    }

    function test_V31_FreshMocksAndPriorityWindow() public view {
        assertFalse(d.reusedMockKRW);
        assertFalse(d.reusedMockDojang);
        assertEq(d.curveFactoryMock.priorityWindow(), 600);
        assertEq(d.curveFactoryDojang.priorityWindow(), 600);
    }

    /// @dev REUSE_MOCK_KRW / REUSE_MOCK_DOJANG path: existing mocks are wired in, nothing else reused.
    function test_V31_ReusesExistingMocks() public {
        MockKRW krw = new MockKRW();
        MockDojang dojang = new MockDojang();
        DeployV3 s2 = new DeployV3();
        DeployV3.Deployed memory r = s2.deploy(makeAddr("deployer3"), treasury, address(krw), address(dojang));
        assertTrue(r.reusedMockKRW);
        assertTrue(r.reusedMockDojang);
        assertEq(address(r.krw), address(krw));
        assertEq(address(r.mockDojang), address(dojang));
        assertEq(address(r.curveFactoryMock.dojang()), address(dojang), "curve factory uses the reused dojang");
        assertEq(address(r.factoryMock.dojang()), address(dojang), "mapae factory uses the reused dojang");
        assertTrue(r.factoryMock.isQuoteAllowed(address(krw)), "reused KRW registered");
        assertTrue(address(r.poolFactory) != address(d.poolFactory), "pool factory is always new");
        assertEq(address(r.curveFactoryMock.poolFactory()), address(r.poolFactory));
    }

    function test_V31_RejectsReuseWithoutCode() public {
        vm.expectRevert(bytes("DeployV3: REUSE_MOCK_KRW has no code"));
        script.deploy(deployer, treasury, makeAddr("nocode"), address(0));
        vm.expectRevert(bytes("DeployV3: REUSE_MOCK_DOJANG has no code"));
        script.deploy(deployer, treasury, address(0), makeAddr("nocode2"));
    }

    function test_RejectsBadTreasury() public {
        vm.expectRevert(bytes("DeployV3: bad treasury"));
        script.deploy(deployer, deployer);
        vm.expectRevert(bytes("DeployV3: bad treasury"));
        script.deploy(deployer, address(0));
    }
}

interface MapaeFactoryLike {
    function isQuoteAllowed(address) external view returns (bool);
}
