// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Deploy + verify on GIWA Sepolia (keystore account, never a raw key in .env):
//
//   forge script script/Deploy.s.sol --account deployer --rpc-url $GIWA_SEPOLIA_RPC_URL \
//     --broadcast --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL
//
// M0 scope: mocks only. Factory/Token/Offering/RedeemManager deployments are added in M1+.

import {Script, console} from "forge-std/Script.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();

        MockKRW krw = new MockKRW();
        MockDojang dojang = new MockDojang();

        vm.stopBroadcast();

        console.log("MockKRW:    ", address(krw));
        console.log("MockDojang: ", address(dojang));
    }
}
