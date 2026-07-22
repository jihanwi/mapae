// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Demo Stage 3 — run after Stage 2 (offering A settled → pool listed at par).
//
//   forge script script/DemoStage3.s.sol --account deployer --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast
//
// Puts the "유통 + 소비" markets on the explorer:
//   1. fan buys on the AMM (KRWs → token, 1% royalty + 0.5% burn buffer + 0.5% LP)
//   2. fan sells on the AMM (token → KRWs, 0.5% of input burns immediately)
//   3. fan sponsors in KRWs (10% bought & burned, 90% to creator, message in event)
//   4. anyone converts the accrued burn buffer → buyback & burn (mini BuybackVault)

import {Script, console} from "forge-std/Script.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {Offering} from "../src/Offering.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {Sponsorship} from "../src/Sponsorship.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";

contract DemoStage3 is Script {
    // Same TEST-ONLY mnemonic as DemoStage1/2.
    string internal constant DEMO_MNEMONIC =
        "wreck mixed deposit recall beach frozen tragic describe pony impulse orbit agree";

    function run() external {
        string memory dep = vm.readFile("deployments/giwa-sepolia.json");
        string memory state = vm.readFile("deployments/demo-state.json");
        MapaeFactory factory = MapaeFactory(vm.parseJsonAddress(dep, "$.factoryMock"));
        MockKRW krw = MockKRW(vm.parseJsonAddress(dep, "$.mockKRW"));
        Offering offA = Offering(vm.parseJsonAddress(state, "$.offeringA"));

        MapaePool pool = offA.pool();
        require(address(pool) != address(0), "offering A not settled/listed yet");
        MembershipToken token = offA.token();
        Sponsorship sponsorship = Sponsorship(factory.sponsorshipOf(address(offA)));

        uint256 buyerKey = vm.deriveKey(DEMO_MNEMONIC, 2); // fan wallet
        uint256 sellerKey = vm.deriveKey(DEMO_MNEMONIC, 3);
        address buyer = vm.addr(buyerKey);
        address seller = vm.addr(sellerKey);

        console.log("pool:", address(pool), "spot before:", pool.spotPrice());

        // 1) buy: 20,000 KRWs -> tokens
        vm.startBroadcast(buyerKey);
        krw.faucet(30_000e18);
        krw.approve(address(pool), 20_000e18);
        uint256 bought = pool.swapKrwForToken(20_000e18, 0, buyer);
        vm.stopBroadcast();
        console.log("bought:", bought);

        // 2) sell: 1 token -> KRWs (0.5% burns on-chain)
        vm.startBroadcast(sellerKey);
        token.approve(address(pool), 1e18);
        uint256 sold = pool.swapTokenForKrw(1e18, 0, seller);
        vm.stopBroadcast();
        console.log("sold for:", sold);

        // 3) sponsorship: 10,000 KRWs, 10% burn share, message for the overlay
        vm.startBroadcast(buyerKey);
        krw.approve(address(sponsorship), 10_000e18);
        uint256 burned = sponsorship.sponsorKRWs(10_000e18, unicode"머패 팔로우! 첫 온체인 후원");
        vm.stopBroadcast();
        console.log("sponsorship burned:", burned);

        // 4) mini buyback: spend the accrued burn buffer (anyone may call)
        vm.startBroadcast();
        uint256 buybackBurn = pool.convertAndBurn(0);
        vm.stopBroadcast();
        console.log("buyback burned:", buybackBurn);

        console.log("spot after:", pool.spotPrice());
        console.log("token supply:", token.totalSupply());
    }
}
