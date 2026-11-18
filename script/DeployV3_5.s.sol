// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// MAPAE v3.5 deploy (GIWA Sepolia, C-T5): the priority-window holding cap. Keystore account only,
// never a raw key; the deployer is the --sender. See docs/DEPLOY_V3_5.md.
//
//   forge script script/DeployV3_5.s.sol --account deployer --sender <deployer-addr> \
//     --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast \
//     --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:<v3.2 membershipTokenDeployer>
//
// New (1 transaction): CurveFactory with priorityWindow 600 s and priorityMaxHoldingBps 200 (2% of
// supply; also the Dev first-buy cap). Owner = the deployer, as in v3.2 (transfer separately).
// Reused (read from deployments/giwa-sepolia-v3_2.json and checked against the expected addresses):
// DojangAnyOf (real-name gate), FeeRouter (the v3.2 one the L0 curves use), PoolFactory, MapaeFactory
// (mock flavour: the quote registry with MockKRW at 2M won and WETH at 0.002 ETH), MockKRW and the
// MembershipTokenDeployer library. No registration is needed: the quote registry and the curve fee
// split are read by the new factory, and PoolFactory only checks the caller is the token's offering.
// The v3.2 CurveFactory and its curves keep the old rules. Output: deployments/giwa-sepolia-v3_5.json.

import {Script, console} from "forge-std/Script.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {GiwaSepolia} from "../src/Constants.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {CurveFactory} from "../src/CurveFactory.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {DeployV3} from "./DeployV3.s.sol";

contract DeployV3_5 is Script {
    uint256 public constant TESTNET_WETH_VIRTUAL_QUOTE = 0.002 ether;
    uint32 public constant PRIORITY_WINDOW = 600;
    uint16 public constant PRIORITY_MAX_HOLDING_BPS = 200;
    string internal constant IN = "deployments/giwa-sepolia-v3_2.json";
    string internal constant OUT = "deployments/giwa-sepolia-v3_5.json";

    // Expected GIWA Sepolia addresses (v3.2 record); run() stops on any mismatch.
    address internal constant EXPECTED_DOJANG_ANY_OF = 0x87326FbbF76e724bA2bA954dAc04c3B939999f84;
    address internal constant EXPECTED_FEE_ROUTER = 0xAB665B7867080cd62Aa316717400f3Cc094E7bd6;
    address internal constant EXPECTED_POOL_FACTORY = 0xf4E7Bf1ACe429400AC23E271E4409D212677e44F;
    address internal constant EXPECTED_MAPAE_FACTORY = 0xC0E22127A44266cCC56B2503504373777d0645A9;
    address internal constant EXPECTED_MOCK_KRW = 0x74eC9141afAd51F346BA5B841Ba93D573e8786fD;
    address internal constant EXPECTED_LIBRARY = 0x9F011858B85b93a73330B56319Dc76a6f3255279;
    address internal constant EXPECTED_OLD_CURVE_FACTORY = 0x9b8155C39cdB912557d8588157fC11e8D989e652;

    struct Reused {
        address dojangAnyOf;
        address feeRouter;
        address poolFactory;
        address mapaeFactory; // mock flavour, the quote registry
        address mockKRW;
        address membershipTokenDeployer;
        address oldCurveFactory; // v3.2, recorded as previousCurveFactory
    }

    struct Deployed {
        address deployer;
        Reused reused;
        CurveFactory curveFactory;
    }

    function run() external {
        require(block.chainid == GiwaSepolia.CHAIN_ID, "DeployV3_5: not GIWA Sepolia");
        (, address deployer,) = vm.readCallers();
        string memory j = vm.readFile(IN);
        Reused memory r = Reused({
            dojangAnyOf: vm.parseJsonAddress(j, ".dojangAnyOf"),
            feeRouter: vm.parseJsonAddress(j, ".feeRouter"),
            poolFactory: vm.parseJsonAddress(j, ".poolFactory"),
            mapaeFactory: vm.parseJsonAddress(j, ".factoryMock"),
            mockKRW: vm.parseJsonAddress(j, ".mockKRW"),
            membershipTokenDeployer: vm.parseJsonAddress(j, ".membershipTokenDeployer"),
            oldCurveFactory: vm.parseJsonAddress(j, ".curveFactory")
        });
        require(r.dojangAnyOf == EXPECTED_DOJANG_ANY_OF, "DeployV3_5: DojangAnyOf");
        require(r.feeRouter == EXPECTED_FEE_ROUTER, "DeployV3_5: FeeRouter");
        require(r.poolFactory == EXPECTED_POOL_FACTORY, "DeployV3_5: PoolFactory");
        require(r.mapaeFactory == EXPECTED_MAPAE_FACTORY, "DeployV3_5: MapaeFactory");
        require(r.mockKRW == EXPECTED_MOCK_KRW, "DeployV3_5: MockKRW");
        require(r.membershipTokenDeployer == EXPECTED_LIBRARY, "DeployV3_5: library");
        require(r.oldCurveFactory == EXPECTED_OLD_CURVE_FACTORY, "DeployV3_5: old CurveFactory");
        uint256 deployBlock = block.number;
        Deployed memory d = deploy(deployer, r);
        _writeJson(d, deployBlock);
        _log(d);
    }

    /// @notice Deploys the v3.5 CurveFactory on the reused v3.2 contracts. Callable from tests.
    function deploy(address deployer, Reused memory r) public returns (Deployed memory d) {
        require(r.dojangAnyOf.code.length > 0, "DeployV3_5: DojangAnyOf has no code");
        require(r.poolFactory.code.length > 0 && r.feeRouter.code.length > 0, "DeployV3_5: infra has no code");
        MapaeFactory mf = MapaeFactory(r.mapaeFactory);
        require(mf.isQuoteAllowed(r.mockKRW), "DeployV3_5: MockKRW not listed");
        require(
            mf.quoteConfig(GiwaSepolia.WETH).curveVirtualQuote == TESTNET_WETH_VIRTUAL_QUOTE,
            "DeployV3_5: WETH not listed at 0.002 ETH"
        );
        // the CurveSale code in this build must call the reused library, not a fresh one
        require(
            new DeployV3().linkedMembershipTokenDeployer() == r.membershipTokenDeployer,
            "DeployV3_5: pass --libraries with the v3.2 MembershipTokenDeployer"
        );
        d.deployer = deployer;
        d.reused = r;
        vm.startBroadcast(deployer);
        d.curveFactory = new CurveFactory(
            IDojang(r.dojangAnyOf),
            IFeeRouter(r.feeRouter),
            PoolFactory(r.poolFactory),
            mf,
            IWETH(GiwaSepolia.WETH),
            deployer,
            PRIORITY_MAX_HOLDING_BPS
        );
        vm.stopBroadcast();
        CurveFactory f = d.curveFactory;
        require(f.priorityWindow() == PRIORITY_WINDOW, "check: priority window");
        require(f.priorityMaxHoldingBps() == PRIORITY_MAX_HOLDING_BPS, "check: holding cap");
        require(address(f.dojang()) == r.dojangAnyOf, "check: dojang");
        require(address(f.feeRouter()) == r.feeRouter, "check: fee router");
        require(address(f.poolFactory()) == r.poolFactory, "check: pool factory");
        require(address(f.mapaeFactory()) == r.mapaeFactory, "check: quote registry");
        require(address(f.weth()) == GiwaSepolia.WETH, "check: weth");
        require(f.owner() == deployer && f.curveEnabled(), "check: owner / enabled");
        require(f.allCurves().length == 0, "check: no curves");
    }

    function _writeJson(Deployed memory d, uint256 deployBlock) internal {
        string memory j = "v3_5";
        vm.serializeString(j, "version", "v3.5");
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeUint(j, "deployBlock", deployBlock);
        vm.serializeAddress(j, "deployer", d.deployer);
        vm.serializeAddress(j, "owner", d.curveFactory.owner());
        vm.serializeAddress(j, "curveFactory", address(d.curveFactory));
        vm.serializeUint(j, "priorityWindow", d.curveFactory.priorityWindow());
        vm.serializeUint(j, "priorityMaxHoldingBps", d.curveFactory.priorityMaxHoldingBps());
        vm.serializeUint(j, "priorityMaxHoldingTokens", 20_000_000e18);
        vm.serializeAddress(j, "dojangAnyOf", d.reused.dojangAnyOf);
        vm.serializeAddress(j, "feeRouter", d.reused.feeRouter);
        vm.serializeAddress(j, "poolFactory", d.reused.poolFactory);
        vm.serializeAddress(j, "factoryMock", d.reused.mapaeFactory);
        vm.serializeAddress(j, "mockKRW", d.reused.mockKRW);
        vm.serializeAddress(j, "membershipTokenDeployer", d.reused.membershipTokenDeployer);
        vm.serializeAddress(j, "weth", GiwaSepolia.WETH);
        vm.serializeUint(j, "wethVirtualQuote", TESTNET_WETH_VIRTUAL_QUOTE);
        string memory out = vm.serializeAddress(j, "previousCurveFactory", d.reused.oldCurveFactory);
        vm.writeJson(out, OUT);
    }

    function _log(Deployed memory d) internal view {
        console.log("CurveFactory (v3.5):", address(d.curveFactory));
        console.log("priorityWindow:", d.curveFactory.priorityWindow());
        console.log("priorityMaxHoldingBps:", d.curveFactory.priorityMaxHoldingBps());
        console.log("owner:", d.curveFactory.owner());
    }
}
