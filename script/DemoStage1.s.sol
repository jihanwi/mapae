// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Demo Stage 1 — run right after Deploy.s.sol:
//
//   forge script script/DemoStage1.s.sol --account deployer --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast
//
// Sets up two live offerings on the mock-verification factory:
//   Offering A (mode A, 12h): oversubscribed — 5 fans × 1M + 1 fan 500k (then a
//     400k partial cancel for event diversity) = 5.1M committed vs R = 5M.
//   Offering B (mode B, 12h): undersubscribed — 3 fans × 1M = 3M vs R = 5M,
//     so settlement burns 40% unsold (the UnsoldBurned narrative).
// Stage 2 (settle → claim → redeem) runs after the 12h deadlines pass — see
// README "데모 Stage 2 실행 절차".

import {Script, console} from "forge-std/Script.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {Offering} from "../src/Offering.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

contract DemoStage1 is Script {
    // TEST-ONLY mnemonic, committed to a public repo ON PURPOSE for demo
    // reproducibility. Never hold real value on these wallets.
    string internal constant DEMO_MNEMONIC =
        "wreck mixed deposit recall beach frozen tragic describe pony impulse orbit agree";

    uint256 internal constant R = 5_000_000e18; // raise target (KRWs)
    uint256 internal constant P = 10_000e18; // price per token
    uint256 internal constant L = 1_500_000e18; // wallet limit (30% of R, demo guide max)
    uint256 internal constant MIN_COMMIT = 10_000e18;
    // Per-wallet gas funding. GIWA Sepolia measured gas price is ~0.001 gwei,
    // so 0.0005 ETH is ~50x margin for a fan's ~5 txs (8 wallets = 0.004 ETH
    // total, fits a 0.01 ETH deployer balance). Local anvil rehearsal needs
    // more (1+ gwei base fee) — override with DEMO_GAS_STIPEND (wei).
    uint256 internal constant DEFAULT_GAS_STIPEND = 0.0005 ether;

    function run() external {
        string memory dep = vm.readFile("deployments/giwa-sepolia.json");
        MapaeFactory factory = MapaeFactory(vm.parseJsonAddress(dep, "$.factoryMock"));
        MockKRW krw = MockKRW(vm.parseJsonAddress(dep, "$.mockKRW"));
        MockDojang dojang = MockDojang(vm.parseJsonAddress(dep, "$.mockDojang"));

        uint256[8] memory keys;
        address[] memory wallets = new address[](8);
        for (uint32 i = 0; i < 8; i++) {
            keys[i] = vm.deriveKey(DEMO_MNEMONIC, i);
            wallets[i] = vm.addr(keys[i]);
        }
        // Roles: [0] creator A, [1] creator B, [2..7] fans.

        uint256 stipend = vm.envOr("DEMO_GAS_STIPEND", DEFAULT_GAS_STIPEND);

        // ---- deployer: verify demo wallets + fund gas ----
        vm.startBroadcast();
        dojang.setVerifiedBatch(wallets);
        for (uint256 i = 0; i < 8; i++) {
            (bool ok,) = wallets[i].call{value: stipend}("");
            require(ok, "gas funding failed");
        }
        vm.stopBroadcast();

        // ---- creator A: Offering A (mode A, oversubscription scenario) ----
        vm.startBroadcast(keys[0]);
        (address offA, address tokenA, address rmA) =
            factory.createOffering(_params("MAPAE Demo A", "MAPA", IOffering.RefundMode.AllOrNothing));
        vm.stopBroadcast();

        // ---- creator B: Offering B (mode B, undersell → burn narrative) ----
        vm.startBroadcast(keys[1]);
        (address offB, address tokenB, address rmB) =
            factory.createOffering(_params("MAPAE Demo B", "MAPB", IOffering.RefundMode.Partial));
        vm.stopBroadcast();

        // ---- fans 2..6: commit 1M each to A; fans 2..4 also 1M to B ----
        for (uint256 i = 2; i <= 6; i++) {
            vm.startBroadcast(keys[i]);
            krw.faucet(2_000_000e18);
            krw.approve(offA, 1_000_000e18);
            Offering(offA).commit(1_000_000e18);
            if (i <= 4) {
                krw.approve(offB, 1_000_000e18);
                Offering(offB).commit(1_000_000e18);
            }
            vm.stopBroadcast();
        }

        // ---- fan 7: 500k commit then 400k partial cancel (event diversity) ----
        vm.startBroadcast(keys[7]);
        krw.faucet(500_000e18);
        krw.approve(offA, 500_000e18);
        Offering(offA).commit(500_000e18);
        Offering(offA).cancel(400_000e18); // residual 100k ≥ minCommit ✓
        vm.stopBroadcast();

        // ---- record state for stage 2 ----
        string memory json = "demo";
        vm.serializeAddress(json, "offeringA", offA);
        vm.serializeAddress(json, "tokenA", tokenA);
        vm.serializeAddress(json, "redeemManagerA", rmA);
        vm.serializeAddress(json, "offeringB", offB);
        vm.serializeAddress(json, "tokenB", tokenB);
        vm.serializeAddress(json, "redeemManagerB", rmB);
        vm.serializeUint(json, "deadlineA", Offering(offA).deadline());
        vm.serializeUint(json, "deadlineB", Offering(offB).deadline());
        vm.serializeUint(json, "committedA", Offering(offA).totalCommitted());
        string memory out = vm.serializeUint(json, "committedB", Offering(offB).totalCommitted());
        vm.writeJson(out, "deployments/demo-state.json");

        console.log("Offering A (mode A):", offA, "deadline:", Offering(offA).deadline());
        console.log("Offering B (mode B):", offB, "deadline:", Offering(offB).deadline());
        console.log("committed A:", Offering(offA).totalCommitted());
        console.log("committed B:", Offering(offB).totalCommitted());
    }

    function _params(string memory name, string memory symbol, IOffering.RefundMode mode)
        internal
        view
        returns (MapaeFactory.CreateParams memory cp)
    {
        cp.tokenName = name;
        cp.tokenSymbol = symbol;
        cp.price = P;
        cp.raiseTarget = R;
        // 12h minimum + 30min buffer: the deadline is computed at simulation
        // time, and by broadcast time the duration would dip below the strict
        // 12h on-chain minimum without the buffer (InvalidDuration).
        cp.deadline = block.timestamp + 12 hours + 30 minutes;
        cp.walletLimit = L;
        cp.minCommit = MIN_COMMIT;
        cp.fBps = 6000;
        cp.cBps = 1500;
        cp.creatorTokenBps = 2500;
        cp.refundMode = mode;
        cp.transferLockDuration = 0;
        cp.holdingCapBps = 0;
    }
}
