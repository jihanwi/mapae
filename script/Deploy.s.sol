// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Deploy + verify on GIWA Sepolia (keystore account, never a raw key in .env):
//
//   forge script script/Deploy.s.sol --account deployer --rpc-url $GIWA_SEPOLIA_RPC_URL \
//     --broadcast --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL
//
// M2 scope: full submission stack — mocks + MapaeFactory + one demo offering
// (deployed THROUGH the factory: Offering + MembershipToken + RedeemManager).
// Demo preset (owner-confirmed 2026-07-21): f=6000, c=1500, creatorToken=2500
// → proceeds 75/15/10, tokens 60/25/9/5/1. All platform-side recipients are the
// deployer EOA until Vesting/LP land (M4).

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        MockKRW krw = new MockKRW();
        MockDojang dojang = new MockDojang();

        // Platform guide (가안): P 1천~10만 원 상당, R 5백만~5억 원 상당, L 0.1~5% of R.
        MapaeFactory factory = new MapaeFactory(
            IDojang(address(dojang)),
            IERC20(address(krw)),
            deployer,
            MapaeFactory.FeeRecipients({platform: deployer, reserve: deployer, lpEscrow: deployer}),
            MapaeFactory.Guide({
                minPrice: 1000e18,
                maxPrice: 100_000e18,
                minRaise: 5_000_000e18,
                maxRaise: 500_000_000e18,
                minWalletLimitBps: 10, // 0.1% of R
                maxWalletLimitBps: 500 // 5% of R
            })
        );

        // Demo offering through the factory (deployer doubles as the creator,
        // so it must be Dojang-verified first).
        dojang.setVerified(deployer, true);
        MapaeFactory.CreateParams memory cp;
        cp.tokenName = "MAPAE Demo Membership";
        cp.tokenSymbol = "MAPAE1";
        cp.price = 10_000e18; // 10,000 KRWs per token
        cp.raiseTarget = 10_000_000e18; // 10,000,000 KRWs
        cp.deadline = block.timestamp + 24 hours;
        cp.walletLimit = 500_000e18; // 5% of R
        cp.minCommit = 10_000e18;
        cp.fBps = 6000;
        cp.cBps = 1500;
        cp.creatorTokenBps = 2500;
        cp.refundMode = IOffering.RefundMode.Partial;
        cp.transferLockDuration = 0;
        cp.holdingCapBps = 0;
        (address offering, address token, address redeemManager) = factory.createOffering(cp);

        vm.stopBroadcast();

        console.log("MockKRW:         ", address(krw));
        console.log("MockDojang:      ", address(dojang));
        console.log("MapaeFactory:    ", address(factory));
        console.log("Offering:        ", offering);
        console.log("MembershipToken: ", token);
        console.log("RedeemManager:   ", redeemManager);
    }
}
