// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// v5.2 on-chain demo — Stage 2b: L1 settle + list + claim + swap + sponsorship
// (swapForBurn) + redeem + paid drop + buyback. Run once the L1 deadline (≈12h)
// has passed. Idempotent on settle: if the offering was already settled (e.g. by
// a standalone `cast send ... settle`), that step is skipped.
//
//   forge script script/DemoStage2bL1.s.sol --account deployer \
//     --sender 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C \
//     --rpc-url giwa_sepolia --broadcast

import {Script, console} from "forge-std/Script.sol";
import {Offering} from "../src/Offering.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {RedeemManager} from "../src/RedeemManager.sol";
import {Sponsorship} from "../src/Sponsorship.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {BuybackVault} from "../src/BuybackVault.sol";
import {BuybackExecutor} from "../src/BuybackExecutor.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";

contract DemoStage2bL1 is Script {
    string internal constant DEFAULT_DEMO_MNEMONIC =
        "what attitude accuse zero typical indoor toddler riot topple reward media robot";

    function run() external {
        string memory dep = vm.readFile("deployments/giwa-sepolia.json");
        string memory st = vm.readFile("deployments/demo-v2-state.json");
        Offering off = Offering(vm.parseJsonAddress(st, "$.offeringL1"));
        MembershipToken token = MembershipToken(vm.parseJsonAddress(st, "$.tokenL1"));
        RedeemManager rm = RedeemManager(vm.parseJsonAddress(st, "$.redeemManagerL1"));
        require(block.timestamp >= off.deadline(), "L1 deadline not reached");

        MockKRW krw = MockKRW(vm.parseJsonAddress(dep, "$.mockKRW"));
        BuybackVault vault = BuybackVault(vm.parseJsonAddress(dep, "$.buybackVault"));
        // DEMO_BUNDLE runs one signer-contiguous bundle (0 = all, in order):
        //   1 fanL1: settle-if-needed + claim + swap + sponsorship (swapForBurn)
        //   2 creatorL1: redeemable + paid drop + reroute rate
        //   3 fanL1: redeem + paid-drop purchase
        //   4 deployer: buyback executor params + run
        uint256 bundle = vm.envOr("DEMO_BUNDLE", uint256(0));
        if (bundle == 0 || bundle == 1) {
            _settleAndClaim(off, token);
            _swapAndSponsor(
                off,
                krw,
                Sponsorship(MapaeFactory(vm.parseJsonAddress(dep, "$.factoryMock")).sponsorshipOf(address(off)))
            );
        }
        if (bundle == 0 || bundle == 2) _creatorSetup(rm, vault);
        if (bundle == 0 || bundle == 3) _fanRedeemAndBuy(rm, token, krw, vault);
        if (bundle == 0 || bundle == 4) {
            _buyback(BuybackExecutor(vm.parseJsonAddress(dep, "$.buybackExecutor")), vault, address(token));
        }
    }

    /// @dev settle L1 (mode B — 350 of qSale burned) + fanL1 claim.
    function _settleAndClaim(Offering off, MembershipToken token) internal {
        uint256 fanKey = vm.deriveKey(_mnemonic(), 2);
        uint256 totalSold = 150e18; // 1.5M / P
        bytes32 root = keccak256(bytes.concat(keccak256(abi.encode(vm.addr(fanKey), totalSold, uint256(0)))));
        if (!off.settled()) {
            vm.startBroadcast(); // deployer == platformOwner
            off.settle(root, totalSold, 1_500_000e18, bytes32(uint256(0x51)));
            vm.stopBroadcast();
        }
        console.log("L1 settled; pool:", address(off.pool()), "spot:", off.pool().spotPrice());
        vm.startBroadcast(fanKey);
        off.claim(totalSold, 0, new bytes32[](0));
        vm.stopBroadcast();
        token; // reserved for future assertions
    }

    /// @dev fanL1: one fee-paying pool buy, then a sponsorship whose burn share
    ///      goes through the 0%-fee MapaePool.swapForBurn path.
    function _swapAndSponsor(Offering off, MockKRW krw, Sponsorship sp) internal {
        uint256 fanKey = vm.deriveKey(_mnemonic(), 2);
        MapaePool pool = off.pool();
        vm.startBroadcast(fanKey);
        krw.approve(address(pool), 20_000e18);
        uint256 out = pool.swapQuoteForToken(20_000e18, 0, vm.addr(fanKey));
        krw.approve(address(sp), 10_000e18);
        sp.sponsorKRWs(10_000e18, unicode"마패 데모 후원");
        vm.stopBroadcast();
        console.log("fanL1 swap out:", out, "spot after:", pool.spotPrice());
    }

    /// @dev creatorL1: a burn-to-redeem item + a KRWs paid drop, and route 20%
    ///      of creator drop proceeds to the buyback vault.
    function _creatorSetup(RedeemManager rm, BuybackVault vault) internal {
        uint256 creatorKey = vm.deriveKey(_mnemonic(), 0);
        vm.startBroadcast(creatorKey);
        rm.createRedeemable(1, 5e18, 0, 0);
        rm.createPaidDrop(1, 100_000e18, 100, block.timestamp + 30 days);
        vault.setRerouteRate(2000); // 20% of creator proceeds → buyback
        vm.stopBroadcast();
    }

    /// @dev fanL1: burn-to-redeem + buy the paid drop (merch → treasury, reroute → vault).
    function _fanRedeemAndBuy(RedeemManager rm, MembershipToken token, MockKRW krw, BuybackVault vault) internal {
        uint256 fanKey = vm.deriveKey(_mnemonic(), 2);
        vm.startBroadcast(fanKey);
        token.approve(address(rm), 5e18);
        rm.redeem(1);
        krw.faucet(100_000e18);
        krw.approve(address(rm), 100_000e18);
        rm.purchaseDrop(1);
        vm.stopBroadcast();
        console.log("redeem + paid drop done; vault KRWs earmarked:", vault.krwBalance(address(token)));
    }

    /// @dev executor buys-and-burns the earmarked KRWs from the vault.
    function _buyback(BuybackExecutor executor, BuybackVault vault, address token) internal {
        vm.startBroadcast(); // deployer owns the executor
        executor.setParams(24 hours, 100, 1000); // 1% depth cap, 10% slippage
        uint256 burned = executor.run(token);
        vm.stopBroadcast();
        console.log("buyback burned:", burned, "cumulative:", vault.totalBurned(token));
    }

    function _mnemonic() internal view returns (string memory) {
        return vm.envOr("DEMO_MNEMONIC", string(DEFAULT_DEMO_MNEMONIC));
    }
}
