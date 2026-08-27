// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// v5.2 on-chain demo — Stage 1 (create + commit). Run right after Deploy.s.sol:
//
//   forge script script/DemoStage1On.s.sol --account deployer \
//     --sender 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C \
//     --rpc-url giwa_sepolia --broadcast
//
// Opens two live offerings on the mock-verification factory:
//   • L0 mini (T≈1h): raise 500k (== minRaise floor, guide bypassed), f70/c25/
//     issuer5, royalty20/burn30-band, vesting 4mo/cliff0. fanL0 commits 500k.
//   • L1 (T≈12h):     raise 5M, f60/c15/creator25, royalty60/burn30. fanL1
//     commits 1.5M (mode B — settle sells the committed portion).
// Stage 2a (settle L0 + swap) runs after the 1h deadline; Stage 2b (settle L1 +
// redeem + paid drop + buyback) after the 12h deadline. Deadlines/addresses are
// recorded in deployments/demo-v2-state.json.

import {Script, console} from "forge-std/Script.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {Offering} from "../src/Offering.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

contract DemoStage1On is Script {
    // TEST-ONLY mnemonic (throwaway testnet wallets, tiny gas only).
    string internal constant DEFAULT_DEMO_MNEMONIC =
        "what attitude accuse zero typical indoor toddler riot topple reward media robot";
    uint256 internal constant P = 10_000e18;
    uint256 internal constant DEFAULT_GAS_STIPEND = 0.0005 ether;

    function run() external {
        string memory dep = vm.readFile("deployments/giwa-sepolia.json");
        MapaeFactory factory = MapaeFactory(vm.parseJsonAddress(dep, "$.factoryMock"));
        MockKRW krw = MockKRW(vm.parseJsonAddress(dep, "$.mockKRW"));
        MockDojang dojang = MockDojang(vm.parseJsonAddress(dep, "$.mockDojang"));

        // [0] creatorL1, [1] creatorL0, [2] fanL1, [3] fanL0
        uint256[4] memory keys;
        address[] memory wallets = new address[](4);
        for (uint32 i = 0; i < 4; i++) {
            keys[i] = vm.deriveKey(_mnemonic(), i);
            wallets[i] = vm.addr(keys[i]);
        }
        uint256 stipend = vm.envOr("DEMO_GAS_STIPEND", DEFAULT_GAS_STIPEND);

        // ---- deployer: verify demo wallets + fund gas ----
        vm.startBroadcast();
        dojang.setVerifiedBatch(wallets);
        for (uint256 i = 0; i < 4; i++) {
            (bool ok,) = wallets[i].call{value: stipend}("");
            require(ok, "gas funding failed");
        }
        vm.stopBroadcast();

        // ---- creatorL0: L0 mini offering (T ≈ 1h) ----
        vm.startBroadcast(keys[1]);
        (address offL0, address tokenL0,) = factory.createOffering(_l0Params());
        vm.stopBroadcast();

        // ---- creatorL1: L1 offering (T ≈ 12h) ----
        vm.startBroadcast(keys[0]);
        (address offL1, address tokenL1, address rmL1) = factory.createOffering(_l1Params());
        vm.stopBroadcast();

        // ---- fanL0: commit 500k to L0 ----
        vm.startBroadcast(keys[3]);
        krw.faucet(500_000e18);
        krw.approve(offL0, 500_000e18);
        Offering(offL0).commit(500_000e18);
        vm.stopBroadcast();

        // ---- fanL1: commit 1.5M to L1 (+ extra KRWs for later swaps/drops) ----
        vm.startBroadcast(keys[2]);
        krw.faucet(2_000_000e18);
        krw.approve(offL1, 1_500_000e18);
        Offering(offL1).commit(1_500_000e18);
        vm.stopBroadcast();

        // ---- record state for stage 2 ----
        string memory json = "demoV2";
        vm.serializeAddress(json, "offeringL0", offL0);
        vm.serializeAddress(json, "tokenL0", tokenL0);
        vm.serializeAddress(json, "offeringL1", offL1);
        vm.serializeAddress(json, "tokenL1", tokenL1);
        vm.serializeAddress(json, "redeemManagerL1", rmL1);
        vm.serializeAddress(json, "fanL0", wallets[3]);
        vm.serializeAddress(json, "fanL1", wallets[2]);
        vm.serializeAddress(json, "creatorL1", wallets[0]);
        vm.serializeUint(json, "deadlineL0", Offering(offL0).deadline());
        string memory out = vm.serializeUint(json, "deadlineL1", Offering(offL1).deadline());
        vm.writeJson(out, "deployments/demo-v2-state.json");

        console.log("L0 offering:", offL0, "deadline:", Offering(offL0).deadline());
        console.log("L1 offering:", offL1, "deadline:", Offering(offL1).deadline());
        console.log("tokenL0:", tokenL0);
        console.log("tokenL1:", tokenL1);
    }

    function _l0Params() internal view returns (MapaeFactory.CreateParams memory cp) {
        cp.tokenName = "MAPAE L0 Mini";
        cp.tokenSymbol = "MAPL0";
        cp.price = P;
        cp.raiseTarget = 500_000e18;
        cp.deadline = block.timestamp + 1 hours + 10 minutes; // L0 min 1h + buffer
        cp.walletLimit = 500_000e18;
        cp.minCommit = 10_000e18;
        cp.fBps = 7000;
        cp.cBps = 2500;
        cp.creatorTokenBps = 500;
        cp.swapRoyaltyBps = 20; // L0 royalty band [0,30]
        cp.swapBurnBps = 30;
        cp.tier = IFeeRouter.UtilityTier.L0;
        cp.refundMode = IOffering.RefundMode.Partial;
        cp.transferLockDuration = 0;
        cp.holdingCapBps = 0;
        cp.sponsorBurnBps = 0;
        cp.vestingDuration = 120 days; // L0 3–6mo
        cp.vestingCliff = 0; // L0 cliff 0 allowed
    }

    function _l1Params() internal view returns (MapaeFactory.CreateParams memory cp) {
        cp.tokenName = "MAPAE L1 Demo";
        cp.tokenSymbol = "MAPL1";
        cp.price = P;
        cp.raiseTarget = 5_000_000e18;
        cp.deadline = block.timestamp + 12 hours + 30 minutes; // L1 min 12h + buffer
        cp.walletLimit = 1_500_000e18; // 30% of R (guide max)
        cp.minCommit = 10_000e18;
        cp.fBps = 6000;
        cp.cBps = 1500;
        cp.creatorTokenBps = 2500;
        cp.swapRoyaltyBps = 60;
        cp.swapBurnBps = 30;
        cp.tier = IFeeRouter.UtilityTier.L1;
        cp.refundMode = IOffering.RefundMode.Partial;
        cp.transferLockDuration = 0;
        cp.holdingCapBps = 0;
        cp.sponsorBurnBps = 1000;
        cp.vestingDuration = 1080 days;
        cp.vestingCliff = 180 days;
    }

    function _mnemonic() internal view returns (string memory) {
        return vm.envOr("DEMO_MNEMONIC", string(DEFAULT_DEMO_MNEMONIC));
    }
}
