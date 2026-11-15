// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// MAPAE v3.2 deploy (GIWA Sepolia). Keystore account only, never a raw key. See docs/DEPLOY_V3_2.md.
//
//   forge script script/DeployV3_2.s.sol --account deployer --sender <deployer-addr> \
//     --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL \
//     --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:<v3.1 membershipTokenDeployer>
//
// v3.2 (STATUS 결정 46, 49): the Dojang adapter looks up the ATTESTER ID (TESTNET_FAUCET), a
// DojangAnyOf accepts the official Dojang OR MockDojang, and CurveFactory caps the Dev first buy
// in the creation tx at 5% of supply.
//
// Reused from v3.1 (read from DEPLOYMENT_IN, default deployments/giwa-sepolia-v3_1.json; their
// bytecode is unchanged in v3.2): MockKRW, MockDojang, PoolFactory, FeeRouter, MapaeFactory (mock
// flavour, which already lists MockKRW at 2M won and WETH at 0.002 ETH) and the linked
// MembershipTokenDeployer library (pass it with --libraries so forge does not deploy a new one; the
// script checks the link).
// New: DojangEASAdapter(TESTNET_FAUCET), DojangAnyOf(adapter, MockDojang), CurveFactory(dojang =
// DojangAnyOf; priorityWindow 600 s by default). Output: deployments/giwa-sepolia-v3_2.json (older
// deployment files are never touched).

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IEAS, IDojangScroll} from "../src/interfaces/IEAS.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {GiwaSepolia} from "../src/Constants.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {CurveFactory} from "../src/CurveFactory.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {DojangEASAdapter} from "../src/DojangEASAdapter.sol";
import {DojangAnyOf} from "../src/DojangAnyOf.sol";
import {DeployV3} from "./DeployV3.s.sol";

contract DeployV3_2 is Script {
    uint256 public constant TESTNET_WETH_VIRTUAL_QUOTE = 0.002 ether;
    uint32 public constant PRIORITY_WINDOW = 600;
    string internal constant DEFAULT_IN = "deployments/giwa-sepolia-v3_1.json";
    string internal constant OUT = "deployments/giwa-sepolia-v3_2.json";

    struct Reused {
        address mockKRW;
        address mockDojang;
        address poolFactory;
        address feeRouter;
        address mapaeFactory;
        address membershipTokenDeployer;
    }

    struct Deployed {
        address deployer;
        Reused reused;
        DojangEASAdapter adapter;
        DojangAnyOf dojang;
        CurveFactory curveFactory;
    }

    function run() external {
        (, address deployer,) = vm.readCallers();
        string memory inPath = vm.envOr("DEPLOYMENT_IN", string(DEFAULT_IN));
        string memory j = vm.readFile(inPath);
        Reused memory r = Reused({
            mockKRW: vm.parseJsonAddress(j, ".mockKRW"),
            mockDojang: vm.parseJsonAddress(j, ".mockDojang"),
            poolFactory: vm.parseJsonAddress(j, ".poolFactory"),
            feeRouter: vm.parseJsonAddress(j, ".feeRouter"),
            mapaeFactory: vm.parseJsonAddress(j, ".factoryMock"),
            membershipTokenDeployer: vm.parseJsonAddress(j, ".membershipTokenDeployer")
        });
        uint256 deployBlock = block.number;
        Deployed memory d = deploy(deployer, r);
        _writeJson(d, deployBlock);
        _log(d);
    }

    /// @notice Deploys the v3.2 contracts on top of the reused v3.1 ones. Callable from tests.
    function deploy(address deployer, Reused memory r) public returns (Deployed memory d) {
        require(r.mockDojang.code.length > 0, "DeployV3_2: MockDojang has no code");
        require(r.poolFactory.code.length > 0 && r.feeRouter.code.length > 0, "DeployV3_2: infra has no code");
        MapaeFactory mf = MapaeFactory(r.mapaeFactory);
        require(mf.isQuoteAllowed(r.mockKRW), "DeployV3_2: MockKRW not listed");
        require(
            mf.quoteConfig(GiwaSepolia.WETH).curveVirtualQuote == TESTNET_WETH_VIRTUAL_QUOTE,
            "DeployV3_2: WETH not listed at 0.002 ETH"
        );
        // the CurveSale code in this build must call the reused library, not a fresh one
        require(
            new DeployV3().linkedMembershipTokenDeployer() == r.membershipTokenDeployer,
            "DeployV3_2: pass --libraries with the v3.1 MembershipTokenDeployer"
        );
        d.deployer = deployer;
        d.reused = r;

        vm.startBroadcast(deployer);
        d.adapter = new DojangEASAdapter(
            IEAS(GiwaSepolia.EAS),
            IDojangScroll(GiwaSepolia.DOJANG_SCROLL),
            GiwaSepolia.ATTESTER_TESTNET_FAUCET,
            GiwaSepolia.VERIFIED_ADDRESS_SCHEMA_UID
        );
        d.dojang = new DojangAnyOf(IDojang(address(d.adapter)), IDojang(r.mockDojang));
        d.curveFactory = new CurveFactory(
            IDojang(address(d.dojang)),
            FeeRouter(r.feeRouter),
            PoolFactory(r.poolFactory),
            mf,
            IWETH(GiwaSepolia.WETH),
            deployer
        );
        vm.stopBroadcast();
        require(d.curveFactory.priorityWindow() == PRIORITY_WINDOW, "DeployV3_2: priority window");
    }

    function _writeJson(Deployed memory d, uint256 deployBlock) internal {
        string memory j = "v3_2";
        vm.serializeString(j, "version", "v3.2");
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeUint(j, "deployBlock", deployBlock);
        vm.serializeAddress(j, "deployer", d.deployer);
        vm.serializeAddress(j, "mockKRW", d.reused.mockKRW);
        vm.serializeAddress(j, "mockDojang", d.reused.mockDojang);
        vm.serializeAddress(j, "poolFactory", d.reused.poolFactory);
        vm.serializeAddress(j, "feeRouter", d.reused.feeRouter);
        vm.serializeAddress(j, "factoryMock", d.reused.mapaeFactory);
        vm.serializeAddress(j, "membershipTokenDeployer", d.reused.membershipTokenDeployer);
        vm.serializeAddress(j, "dojangEASAdapter", address(d.adapter));
        vm.serializeAddress(j, "dojangAnyOf", address(d.dojang));
        vm.serializeAddress(j, "curveFactory", address(d.curveFactory));
        vm.serializeAddress(j, "weth", GiwaSepolia.WETH);
        vm.serializeBytes32(j, "attesterId", GiwaSepolia.ATTESTER_TESTNET_FAUCET);
        vm.serializeBytes32(j, "schemaUid", GiwaSepolia.VERIFIED_ADDRESS_SCHEMA_UID);
        vm.serializeUint(j, "devFirstBuyMaxTokens", 50_000_000e18);
        vm.serializeUint(j, "priorityWindow", d.curveFactory.priorityWindow());
        string memory out = vm.serializeUint(j, "wethVirtualQuote", TESTNET_WETH_VIRTUAL_QUOTE);
        vm.writeJson(out, OUT);
    }

    function _log(Deployed memory d) internal pure {
        console.log("DojangEASAdapter (TESTNET_FAUCET):", address(d.adapter));
        console.log("DojangAnyOf (adapter | MockDojang):", address(d.dojang));
        console.log("CurveFactory (v3.2):               ", address(d.curveFactory));
        console.log("reused MapaeFactory(mock):         ", d.reused.mapaeFactory);
    }
}
