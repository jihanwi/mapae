// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Deploy + verify on GIWA Sepolia (keystore account, never a raw key in .env):
//
//   forge script script/Deploy.s.sol --account deployer --rpc-url $GIWA_SEPOLIA_RPC_URL \
//     --broadcast --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL
//
// M3 dual-stack deployment:
//   1) Main demo stack — MockKRW + MockDojang + MapaeFactory(MockDojang).
//      All demo transactions run here (we control verification flags).
//   2) GIWA-native showcase — DojangEASAdapter (live EAS predeploy + live
//      DojangScroll) + MapaeFactory(adapter). Real Verified Address wallets
//      can create offerings here without any code change.
// Addresses are recorded in deployments/giwa-sepolia.json for the demo
// scripts and verify-children.js.

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IEAS, IDojangScroll} from "../src/interfaces/IEAS.sol";
import {GiwaSepolia} from "../src/Constants.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {DojangEASAdapter} from "../src/DojangEASAdapter.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        MockKRW krw = new MockKRW();
        MockDojang mockDojang = new MockDojang();
        PoolFactory poolFactory = new PoolFactory();

        // Platform guide. L max is 30% of R for the demo (only ~6 fan wallets
        // must be able to oversubscribe R); production 가안 is 0.1~5%.
        MapaeFactory.Guide memory guide = MapaeFactory.Guide({
            minPrice: 1000e18,
            maxPrice: 100_000e18,
            minRaise: 5_000_000e18,
            maxRaise: 500_000_000e18,
            minWalletLimitBps: 10,
            maxWalletLimitBps: 3000
        });
        MapaeFactory.FeeRecipients memory recipients =
            MapaeFactory.FeeRecipients({platform: deployer, reserve: deployer});

        // Stack 1: main demo (mock verification, fully controllable)
        MapaeFactory factoryMock = new MapaeFactory(
            IDojang(address(mockDojang)), IERC20(address(krw)), deployer, poolFactory, recipients, guide
        );

        // Stack 2: GIWA-native showcase (live Dojang attestation stack)
        DojangEASAdapter adapter = new DojangEASAdapter(
            IEAS(GiwaSepolia.EAS), IDojangScroll(GiwaSepolia.DOJANG_SCROLL), GiwaSepolia.VERIFIED_ADDRESS_SCHEMA_UID
        );
        MapaeFactory factoryDojang =
            new MapaeFactory(IDojang(address(adapter)), IERC20(address(krw)), deployer, poolFactory, recipients, guide);

        vm.stopBroadcast();

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "deployer", deployer);
        vm.serializeAddress(json, "mockKRW", address(krw));
        vm.serializeAddress(json, "poolFactory", address(poolFactory));
        vm.serializeAddress(json, "mockDojang", address(mockDojang));
        vm.serializeAddress(json, "factoryMock", address(factoryMock));
        vm.serializeAddress(json, "dojangEASAdapter", address(adapter));
        string memory out = vm.serializeAddress(json, "factoryDojang", address(factoryDojang));
        vm.writeJson(out, "deployments/giwa-sepolia.json");

        console.log("MockKRW:          ", address(krw));
        console.log("PoolFactory:      ", address(poolFactory));
        console.log("MockDojang:       ", address(mockDojang));
        console.log("MapaeFactory(mock):", address(factoryMock));
        console.log("DojangEASAdapter: ", address(adapter));
        console.log("MapaeFactory(EAS): ", address(factoryDojang));
    }
}
