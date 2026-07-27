// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Demo Offering — a LIVE offering judges can actually commit to (older ones are
// settled). Rolling: re-run each cycle after the previous 48h window expires.
//
//   forge script script/DemoOfferingC.s.sol --account deployer --password-file ~/.foundry/deployer.pw \
//     --sender <deployer-addr> --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --slow
//
// ★ ONE-LIVE RULE (MapaeFactory.sol:169-175): a settled creator holds its slot
//   forever, so every cycle MUST use a fresh derivation index + fresh symbol, or
//   createOffering reverts ActiveOfferingExists. Override per cycle via env
//   (defaults below are cycle 1 = "D"):
//     CREATOR_IDX  derivation index of the creator wallet   (default 9)
//     SYMBOL       token symbol; web maps it to a persona    (default MAPD → 다온 DAON)
//     TOKEN_NAME   ERC-20 name                               (default "MAPAE Demo D")
//   Next cycle: CREATOR_IDX=10 SYMBOL=MAPE ... (index 10 = 0xBAb4…0836, slot free)
//
// What it does:
//   1. (owner) lowers the factory guide minRaise so a small-target demo works
//   2. creator wallet (CREATOR_IDX) selfVerifies and creates the offering —
//      48h window, mode B (Partial), R = 1M KRWs
//   3. two fan wallets commit 200k + 100k (gauge at 30%)

import {Script, console} from "forge-std/Script.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {Offering} from "../src/Offering.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

contract DemoOfferingC is Script {
    string internal constant DEFAULT_DEMO_MNEMONIC =
        "what attitude accuse zero typical indoor toddler riot topple reward media robot";

    function run() external {
        string memory dep = vm.readFile("deployments/giwa-sepolia.json");
        MapaeFactory factory = MapaeFactory(vm.parseJsonAddress(dep, "$.factoryMock"));
        MockKRW krw = MockKRW(vm.parseJsonAddress(dep, "$.mockKRW"));
        MockDojang dojang = MockDojang(vm.parseJsonAddress(dep, "$.mockDojang"));

        // fresh creator each cycle (one-live rule) — default index 9 for "D"
        uint256 creatorKey = vm.deriveKey(_mnemonic(), uint32(vm.envOr("CREATOR_IDX", uint256(9))));
        address creator = vm.addr(creatorKey);
        uint256 fan1Key = vm.deriveKey(_mnemonic(), 2);
        uint256 fan2Key = vm.deriveKey(_mnemonic(), 3);

        // ---- deployer: demo guide (small target) + gas for the creator ----
        vm.startBroadcast();
        MapaeFactory.Guide memory g = MapaeFactory.Guide({
            minPrice: 1000e18,
            maxPrice: 100_000e18,
            minRaise: 1_000_000e18, // demo: 1M KRWs targets allowed
            maxRaise: 500_000_000e18,
            minWalletLimitBps: 10,
            maxWalletLimitBps: 3000
        });
        factory.setGuide(g);
        (bool ok,) = creator.call{value: 0.0005 ether}("");
        require(ok, "gas funding failed");
        vm.stopBroadcast();

        // ---- creator: one-click verification + createOffering ----
        vm.startBroadcast(creatorKey);
        dojang.selfVerify();
        MapaeFactory.CreateParams memory cp;
        cp.tokenName = vm.envOr("TOKEN_NAME", string("MAPAE Demo D"));
        cp.tokenSymbol = vm.envOr("SYMBOL", string("MAPD")); // web maps symbol → persona (creators.ts)
        cp.price = 10_000e18;
        cp.raiseTarget = 1_000_000e18;
        cp.deadline = block.timestamp + 48 hours; // max window (broadcast lag keeps it in band)
        cp.walletLimit = 300_000e18; // 30% of R
        cp.minCommit = 10_000e18;
        cp.fBps = 6000;
        cp.cBps = 1500;
        cp.creatorTokenBps = 2500;
        cp.refundMode = IOffering.RefundMode.Partial;
        cp.transferLockDuration = 0;
        cp.holdingCapBps = 0;
        cp.swapRoyaltyBps = 100;
        cp.swapBurnBps = 50;
        cp.sponsorBurnBps = 1000;
        cp.vestingDuration = 1080 days;
        cp.vestingCliff = 180 days;
        (address offC, address tokenC,) = factory.createOffering(cp);
        vm.stopBroadcast();

        // ---- two fans commit so the gauge isn't at 0% ----
        vm.startBroadcast(fan1Key);
        krw.faucet(200_000e18);
        krw.approve(offC, 200_000e18);
        Offering(offC).commit(200_000e18);
        vm.stopBroadcast();
        vm.startBroadcast(fan2Key);
        krw.faucet(100_000e18);
        krw.approve(offC, 100_000e18);
        Offering(offC).commit(100_000e18);
        vm.stopBroadcast();

        console.log("Offering C:", offC);
        console.log("Token C:   ", tokenC);
        console.log("deadline:  ", Offering(offC).deadline());
        console.log("committed: ", Offering(offC).totalCommitted());
    }

    function _mnemonic() internal view returns (string memory) {
        return vm.envOr("DEMO_MNEMONIC", string(DEFAULT_DEMO_MNEMONIC));
    }
}
