// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Deploy + verify on GIWA Sepolia (keystore account, never a raw key in .env):
//
//   forge script script/Deploy.s.sol --account deployer --rpc-url $GIWA_SEPOLIA_RPC_URL \
//     --broadcast --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL
//
// M1 scope: mocks + one sample Offering (which deploys its MembershipToken).
// Factory/RedeemManager deployments are added in M2. Allocation recipients are
// the deployer EOA for now (D4: wired by the Factory in M2, real Vesting/LP in M4).

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IOffering} from "../src/interfaces/IOffering.sol";
import {Offering} from "../src/Offering.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        MockKRW krw = new MockKRW();
        MockDojang dojang = new MockDojang();

        IOffering.OfferingParams memory p;
        p.paymentToken = IERC20(address(krw));
        p.dojang = IDojang(address(dojang));
        p.creator = deployer;
        p.tokenName = "MAPAE Sample Membership";
        p.tokenSymbol = "MAPAE1";
        p.price = 10_000e18; // 10,000 KRWs per token
        p.raiseTarget = 1_000_000e18; // 1,000,000 KRWs
        p.deadline = block.timestamp + 24 hours;
        p.walletLimit = 300_000e18;
        p.minCommit = 10_000e18;
        p.fBps = 6000;
        p.refundMode = IOffering.RefundMode.Partial;
        p.transferLockDuration = 0;
        p.holdingCapBps = 0;
        p.recipients = IOffering.AllocationRecipients({
            creatorVesting: deployer, lpEscrow: deployer, platform: deployer, reserve: deployer
        });
        Offering offering = new Offering(p);

        vm.stopBroadcast();

        console.log("MockKRW:         ", address(krw));
        console.log("MockDojang:      ", address(dojang));
        console.log("Offering:        ", address(offering));
        console.log("MembershipToken: ", address(offering.token()));
    }
}
