// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// MAPAE v3.1 deploy (GIWA Sepolia). Keystore account only, never a raw key; the treasury is a
// SEPARATE address passed through the environment (decision: treasury != deployer).
//
//   TREASURY_ADDRESS=0x... [REUSE_MOCK_KRW=0x...] [REUSE_MOCK_DOJANG=0x...] \
//   forge script script/DeployV3.s.sol --account deployer --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL
//
// v3.1 (priority window, open pool swaps): REUSE_MOCK_KRW / REUSE_MOCK_DOJANG reuse the testnet
// MockKRW / MockDojang (balances and verifications carry over). Everything else is deployed new:
// MapaePool's bytecode changed, so PoolFactory is new, and every contract holding PoolFactory or
// the new CurveSale / Offering code (MapaeFactory, CurveFactory) is new too. See docs/DEPLOY_V3_1.md.
//
// Stack (shared infra + two dojang flavours):
//   MockKRW, MockDojang, PoolFactory, FeeRouter(owner = deployer, treasury = TREASURY_ADDRESS),
//   BuybackVault + BuybackExecutor (v2 wiring), DojangEASAdapter,
//   MapaeFactory x2 (mock / EAS; FeeRecipients.platform = treasury; v2 Guide + MIN_RAISE),
//   CurveFactory x2 (mock / EAS; paired MapaeFactory + dojang; weth = GiwaSepolia.WETH).
// Quote registry on both MapaeFactories: MockKRW (krwsVirtualQuote(decimals) = 2M won, mainnet
// value) and WETH (TESTNET_WETH_VIRTUAL_QUOTE = 0.002 ether, decision 29; CurvePresets' 0.6 ETH
// mainnet constant is untouched).
//
// MembershipTokenDeployer is an external (linked) library. forge script deploys it automatically
// as part of the broadcast; this script recovers the linked address from CurveSale's creation
// code (the library's own runtime starts with PUSH20 <self>) and records it in the json, so
// verify-children.js can pass --libraries. Output: deployments/giwa-sepolia-v3_1.json (the v3 file
// deployments/giwa-sepolia-v3.json and the v2 file deployments/giwa-sepolia.json are never touched).

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IEAS, IDojangScroll} from "../src/interfaces/IEAS.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {GiwaSepolia} from "../src/Constants.sol";
import {CurvePresets} from "../src/CurvePresets.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {ProceedsLockDeployer} from "../src/ProceedsLockDeployer.sol";
import {CurveFactory} from "../src/CurveFactory.sol";
import {CurveSale} from "../src/CurveSale.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {BuybackVault} from "../src/BuybackVault.sol";
import {BuybackExecutor} from "../src/BuybackExecutor.sol";
import {DojangEASAdapter} from "../src/DojangEASAdapter.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

contract DeployV3 is Script {
    /// @notice Hard raise floor forwarded to every offering (v2 Deploy.s.sol value).
    uint256 internal constant MIN_RAISE = 500_000e18;
    /// @notice Testnet WETH virtual quote reserve (decision 29): 3 × 0.002 = 0.006 ETH graduation.
    uint256 public constant TESTNET_WETH_VIRTUAL_QUOTE = 0.002 ether;
    string internal constant OUT = "deployments/giwa-sepolia-v3_1.json";

    struct Deployed {
        address deployer;
        address treasury;
        MockKRW krw;
        MockDojang mockDojang;
        PoolFactory poolFactory;
        FeeRouter feeRouter;
        BuybackVault buybackVault;
        BuybackExecutor buybackExecutor;
        DojangEASAdapter adapter;
        MapaeFactory factoryMock;
        MapaeFactory factoryDojang;
        CurveFactory curveFactoryMock;
        CurveFactory curveFactoryDojang;
        address membershipTokenDeployer;
        uint256 krwsVirtualQuote;
        uint256 wethVirtualQuote;
        bool reusedMockKRW;
        bool reusedMockDojang;
    }

    function run() external {
        address treasury = vm.envOr("TREASURY_ADDRESS", address(0));
        (, address deployer,) = vm.readCallers();
        require(treasury != address(0), "DeployV3: TREASURY_ADDRESS env var is required");
        require(treasury != deployer, "DeployV3: TREASURY_ADDRESS must differ from the deployer");
        address reuseKrw = vm.envOr("REUSE_MOCK_KRW", address(0));
        address reuseDojang = vm.envOr("REUSE_MOCK_DOJANG", address(0));
        uint256 deployBlock = block.number;
        Deployed memory d = deploy(deployer, treasury, reuseKrw, reuseDojang);
        _writeJson(d, deployBlock);
        _log(d);
    }

    /// @notice Full deployment with fresh mocks, broadcast as `deployer`. Callable from tests.
    function deploy(address deployer, address treasury) public returns (Deployed memory d) {
        return deploy(deployer, treasury, address(0), address(0));
    }

    /// @notice Full deployment. Non-zero `reuseKrw` / `reuseDojang` reuse an existing MockKRW /
    ///         MockDojang instead of deploying new ones (they must have code).
    function deploy(address deployer, address treasury, address reuseKrw, address reuseDojang)
        public
        returns (Deployed memory d)
    {
        require(treasury != address(0) && treasury != deployer, "DeployV3: bad treasury");
        require(reuseKrw == address(0) || reuseKrw.code.length > 0, "DeployV3: REUSE_MOCK_KRW has no code");
        require(reuseDojang == address(0) || reuseDojang.code.length > 0, "DeployV3: REUSE_MOCK_DOJANG has no code");
        d.deployer = deployer;
        d.treasury = treasury;
        d.reusedMockKRW = reuseKrw != address(0);
        d.reusedMockDojang = reuseDojang != address(0);

        vm.startBroadcast(deployer);
        d.krw = d.reusedMockKRW ? MockKRW(reuseKrw) : new MockKRW();
        d.mockDojang = d.reusedMockDojang ? MockDojang(reuseDojang) : new MockDojang();
        d.poolFactory = new PoolFactory();
        d.feeRouter = new FeeRouter(deployer, treasury);
        d.buybackVault = new BuybackVault(IERC20(address(d.krw)), deployer);
        d.buybackExecutor = new BuybackExecutor(d.buybackVault, deployer);
        d.buybackVault.setExecutor(address(d.buybackExecutor));
        d.adapter = new DojangEASAdapter(
            IEAS(GiwaSepolia.EAS),
            IDojangScroll(GiwaSepolia.DOJANG_SCROLL),
            GiwaSepolia.ATTESTER_TESTNET_FAUCET,
            GiwaSepolia.VERIFIED_ADDRESS_SCHEMA_UID
        );

        d.factoryMock = _mapaeFactory(d, IDojang(address(d.mockDojang)));
        d.factoryDojang = _mapaeFactory(d, IDojang(address(d.adapter)));

        d.krwsVirtualQuote = CurvePresets.krwsVirtualQuote(d.krw.decimals());
        d.wethVirtualQuote = TESTNET_WETH_VIRTUAL_QUOTE;
        _registerQuotes(d.factoryMock, d);
        _registerQuotes(d.factoryDojang, d);

        d.curveFactoryMock = new CurveFactory(
            IDojang(address(d.mockDojang)), d.feeRouter, d.poolFactory, d.factoryMock, IWETH(GiwaSepolia.WETH), deployer
        );
        d.curveFactoryDojang = new CurveFactory(
            IDojang(address(d.adapter)), d.feeRouter, d.poolFactory, d.factoryDojang, IWETH(GiwaSepolia.WETH), deployer
        );
        vm.stopBroadcast();

        d.membershipTokenDeployer = linkedMembershipTokenDeployer();
    }

    function _mapaeFactory(Deployed memory d, IDojang dojang) internal returns (MapaeFactory) {
        // v2 Deploy.s.sol guide (L1/L2 bands; L0 bypasses the guide and only faces MIN_RAISE).
        MapaeFactory.Guide memory guide = MapaeFactory.Guide({
            minPrice: 1000e18,
            maxPrice: 100_000e18,
            minRaise: 5_000_000e18,
            maxRaise: 500_000_000e18,
            minWalletLimitBps: 10,
            maxWalletLimitBps: 3000
        });
        return new MapaeFactory(
            dojang,
            IERC20(address(d.krw)),
            d.deployer,
            d.poolFactory,
            d.feeRouter,
            d.buybackVault,
            MIN_RAISE,
            MapaeFactory.FeeRecipients({platform: d.treasury}),
            guide,
            MapaeFactory.ProceedsBand({
                maxUpfrontBps: 3000, minLockDuration: 1 hours, maxLockDuration: 1095 days, maxLockCliff: 180 days
            }),
            new ProceedsLockDeployer(),
            address(0) // decision 62: no settler
        );
    }

    function _registerQuotes(MapaeFactory f, Deployed memory d) internal {
        f.allowQuote(IERC20(address(d.krw)), d.krwsVirtualQuote);
        f.allowQuote(IERC20(GiwaSepolia.WETH), d.wethVirtualQuote);
    }

    /// @notice Address of the MembershipTokenDeployer library linked into this build: scan
    ///         CurveSale's creation code for a PUSH20 target whose runtime begins with
    ///         PUSH20 <itself> (the solc library call guard).
    function linkedMembershipTokenDeployer() public view returns (address) {
        bytes memory code = type(CurveSale).creationCode;
        for (uint256 i; i + 21 <= code.length; ++i) {
            if (code[i] != 0x73) continue;
            address cand;
            assembly {
                cand := shr(96, mload(add(add(code, 0x21), i)))
            }
            bytes memory rt = cand.code;
            if (rt.length < 21 || rt[0] != 0x73) continue;
            address self;
            assembly {
                self := shr(96, mload(add(rt, 0x21)))
            }
            if (self == cand) return cand;
        }
        revert("DeployV3: linked MembershipTokenDeployer not found");
    }

    function _writeJson(Deployed memory d, uint256 deployBlock) internal {
        string memory j = "v3_1";
        vm.serializeString(j, "version", "v3.1");
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeUint(j, "deployBlock", deployBlock);
        vm.serializeAddress(j, "deployer", d.deployer);
        vm.serializeAddress(j, "treasury", d.treasury);
        vm.serializeAddress(j, "mockKRW", address(d.krw));
        vm.serializeAddress(j, "mockDojang", address(d.mockDojang));
        vm.serializeAddress(j, "poolFactory", address(d.poolFactory));
        vm.serializeAddress(j, "feeRouter", address(d.feeRouter));
        vm.serializeAddress(j, "buybackVault", address(d.buybackVault));
        vm.serializeAddress(j, "buybackExecutor", address(d.buybackExecutor));
        vm.serializeAddress(j, "dojangEASAdapter", address(d.adapter));
        vm.serializeAddress(j, "factoryMock", address(d.factoryMock));
        vm.serializeAddress(j, "factoryDojang", address(d.factoryDojang));
        vm.serializeAddress(j, "curveFactoryMock", address(d.curveFactoryMock));
        vm.serializeAddress(j, "curveFactoryDojang", address(d.curveFactoryDojang));
        vm.serializeAddress(j, "weth", GiwaSepolia.WETH);
        vm.serializeAddress(j, "membershipTokenDeployer", d.membershipTokenDeployer);
        vm.serializeBool(j, "reusedMockKRW", d.reusedMockKRW);
        vm.serializeBool(j, "reusedMockDojang", d.reusedMockDojang);
        vm.serializeUint(j, "priorityWindow", d.curveFactoryMock.priorityWindow());
        vm.serializeUint(j, "krwsVirtualQuote", d.krwsVirtualQuote);
        string memory out = vm.serializeUint(j, "wethVirtualQuote", d.wethVirtualQuote);
        vm.writeJson(out, OUT);
    }

    function _log(Deployed memory d) internal pure {
        console.log("Treasury:                ", d.treasury);
        console.log("MockKRW:                 ", address(d.krw), d.reusedMockKRW ? "(reused)" : "(new)");
        console.log("MockDojang:              ", address(d.mockDojang), d.reusedMockDojang ? "(reused)" : "(new)");
        console.log("PoolFactory:             ", address(d.poolFactory));
        console.log("FeeRouter:               ", address(d.feeRouter));
        console.log("BuybackVault:            ", address(d.buybackVault));
        console.log("BuybackExecutor:         ", address(d.buybackExecutor));
        console.log("DojangEASAdapter:        ", address(d.adapter));
        console.log("MapaeFactory(mock):      ", address(d.factoryMock));
        console.log("MapaeFactory(EAS):       ", address(d.factoryDojang));
        console.log("CurveFactory(mock):      ", address(d.curveFactoryMock));
        console.log("CurveFactory(EAS):       ", address(d.curveFactoryDojang));
        console.log("MembershipTokenDeployer: ", d.membershipTokenDeployer);
    }
}
