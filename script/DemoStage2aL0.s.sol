// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// v5.2 on-chain demo — Stage 2a: L0 settle + list + claim + swap.
// Run once the L0 deadline (≈1h) has passed:
//
//   forge script script/DemoStage2aL0.s.sol --account deployer \
//     --sender 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C \
//     --rpc-url giwa_sepolia --broadcast

import {Script, console} from "forge-std/Script.sol";
import {Offering} from "../src/Offering.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";

contract DemoStage2aL0 is Script {
    string internal constant DEFAULT_DEMO_MNEMONIC =
        "what attitude accuse zero typical indoor toddler riot topple reward media robot";

    function run() external {
        string memory dep = vm.readFile("deployments/giwa-sepolia.json");
        MockKRW krw = MockKRW(vm.parseJsonAddress(dep, "$.mockKRW"));
        string memory st = vm.readFile("deployments/demo-v2-state.json");
        Offering off = Offering(vm.parseJsonAddress(st, "$.offeringL0"));
        MembershipToken token = MembershipToken(vm.parseJsonAddress(st, "$.tokenL0"));

        uint256 fanKey = vm.deriveKey(_mnemonic(), 3);
        address fanL0 = vm.addr(fanKey);
        require(block.timestamp >= off.deadline(), "L0 deadline not reached");

        // ---- deployer (platformOwner): settle L0 (single-leaf allocation) ----
        uint256 totalSold = 50e18; // 500k / P — all of qSale, no unsold
        bytes32 root = keccak256(bytes.concat(keccak256(abi.encode(fanL0, totalSold, uint256(0)))));
        vm.startBroadcast();
        off.settle(root, totalSold, 500_000e18, bytes32(uint256(0x50)));
        vm.stopBroadcast();
        MapaePool pool = off.pool();
        console.log("L0 settled; pool:", address(pool), "spot:", pool.spotPrice());

        // ---- fanL0: claim, then a buy swap (platform 60bps → treasury) ----
        vm.startBroadcast(fanKey);
        off.claim(totalSold, 0, new bytes32[](0));
        krw.faucet(50_000e18);
        krw.approve(address(pool), 50_000e18);
        uint256 out = pool.swapQuoteForToken(50_000e18, 0, fanL0);
        vm.stopBroadcast();
        console.log("fanL0 claimed + bought:", out, "spot after:", pool.spotPrice());
    }

    function _mnemonic() internal view returns (string memory) {
        return vm.envOr("DEMO_MNEMONIC", string(DEFAULT_DEMO_MNEMONIC));
    }
}
