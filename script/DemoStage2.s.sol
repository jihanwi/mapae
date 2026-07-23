// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Demo Stage 2 — run after both deadlines (deadlineA/B in demo-state.json) pass.
// Prerequisites (README "데모 Stage 2 실행 절차"):
//   1. node script/allocation/snapshot.js  → deployments/snapshot-{a,b}.json
//   2. node script/allocation/allocate.js  → deployments/alloc-{a,b}.json (--foundry-out)
//   3. forge script script/DemoStage2.s.sol --account deployer \
//        --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast
//
// Executes: settle A → all claims → redeemable + redeem (burn) → settle B
// (UnsoldBurned on-explorer) → claims B.

import {Script, console} from "forge-std/Script.sol";
import {Offering} from "../src/Offering.sol";
import {RedeemManager} from "../src/RedeemManager.sol";
import {MembershipToken} from "../src/MembershipToken.sol";

contract DemoStage2 is Script {
    // Same TEST-ONLY mnemonic as DemoStage1.
    string internal constant DEFAULT_DEMO_MNEMONIC =
        "what attitude accuse zero typical indoor toddler riot topple reward media robot";

    uint256[8] internal keys;
    address[8] internal wallets;

    function run() external {
        for (uint32 i = 0; i < 8; i++) {
            keys[i] = vm.deriveKey(_mnemonic(), i);
            wallets[i] = vm.addr(keys[i]);
        }
        string memory state = vm.readFile("deployments/demo-state.json");
        Offering offA = Offering(vm.parseJsonAddress(state, "$.offeringA"));
        Offering offB = Offering(vm.parseJsonAddress(state, "$.offeringB"));
        RedeemManager rmA = RedeemManager(vm.parseJsonAddress(state, "$.redeemManagerA"));

        // ---- Offering A: settle + claims + redeem ----
        _settle(offA, "deployments/alloc-a.json");
        _claimAll(offA, "deployments/alloc-a.json");

        vm.startBroadcast(keys[0]); // creator A posts a perk: burn 10 tokens, 100 uses
        rmA.createRedeemable(1, 10e18, 100, 0);
        vm.stopBroadcast();

        // Two fans redeem — Redeemed + Transfer→0x0 land on the explorer.
        MembershipToken tokenA = offA.token();
        uint256 redeemed;
        for (uint256 i = 2; i <= 7 && redeemed < 2; i++) {
            if (tokenA.balanceOf(wallets[i]) < 10e18) continue;
            vm.startBroadcast(keys[i]);
            tokenA.approve(address(rmA), 10e18);
            rmA.redeem(1);
            vm.stopBroadcast();
            redeemed++;
        }

        // ---- Offering B: settle (burns 40% unsold) + claims ----
        _settle(offB, "deployments/alloc-b.json");
        _claimAll(offB, "deployments/alloc-b.json");

        console.log("Stage 2 complete.");
        console.log("A settled: totalSold", offA.totalSold(), "supply", offA.token().totalSupply());
        console.log("B settled: totalSold", offB.totalSold(), "supply", offB.token().totalSupply());
    }

    function _settle(Offering offering, string memory allocPath) internal {
        string memory json = vm.readFile(allocPath);
        vm.startBroadcast(); // deployer = platformOwner
        offering.settle(
            vm.parseJsonBytes32(json, "$.root"),
            vm.parseJsonUint(json, "$.totalSold"),
            vm.parseJsonUint(json, "$.totalRaised"),
            vm.parseJsonBytes32(json, "$.seed")
        );
        vm.stopBroadcast();
    }

    function _claimAll(Offering offering, string memory allocPath) internal {
        string memory json = vm.readFile(allocPath);
        address[] memory participants = vm.parseJsonAddressArray(json, "$.participants");
        uint256[] memory allocations = vm.parseJsonUintArray(json, "$.allocations");
        uint256[] memory refunds = vm.parseJsonUintArray(json, "$.refunds");
        for (uint256 i = 0; i < participants.length; i++) {
            uint256 key = _keyFor(participants[i]);
            bytes32[] memory proof = vm.parseJsonBytes32Array(json, string.concat("$.proofs_", vm.toString(i)));
            vm.startBroadcast(key);
            offering.claim(allocations[i], refunds[i], proof);
            vm.stopBroadcast();
        }
    }

    function _keyFor(address wallet) internal view returns (uint256) {
        for (uint256 i = 0; i < 8; i++) {
            if (wallets[i] == wallet) return keys[i];
        }
        revert("unknown demo wallet");
    }

    /// @dev M5 clean-demo support: override with DEMO_MNEMONIC env to derive a
    ///      fresh wallet set (never reuse the M3 demo wallets on a redeploy).
    function _mnemonic() internal view returns (string memory) {
        return vm.envOr("DEMO_MNEMONIC", string(DEFAULT_DEMO_MNEMONIC));
    }
}
