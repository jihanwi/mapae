// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Deploy + verify on GIWA Sepolia (keystore account, never a raw key in .env):
//
//   forge script script/Deploy.s.sol --account deployer --rpc-url $GIWA_SEPOLIA_RPC_URL \
//     --broadcast --verify --verifier blockscout --verifier-url $BLOCKSCOUT_API_URL
//
// v5.2 stack (Milestone A):
//   1) Shared infra — MockKRW + MockDojang + PoolFactory + FeeRouter (tiered
//      fee model, treasury = deployer) + BuybackVault + BuybackExecutor.
//   2) Main demo stack — MapaeFactory(MockDojang) (fully controllable verify).
//   3) GIWA-native showcase — DojangEASAdapter + MapaeFactory(adapter).
// Both factories share one FeeRouter + BuybackVault (the vault is a global
// singleton and is registered as a burner inside each factory's constructor).
// Addresses land in deployments/giwa-sepolia.json.

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IEAS, IDojangScroll} from "../src/interfaces/IEAS.sol";
import {GiwaSepolia} from "../src/Constants.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {BuybackVault} from "../src/BuybackVault.sol";
import {BuybackExecutor} from "../src/BuybackExecutor.sol";
import {DojangEASAdapter} from "../src/DojangEASAdapter.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

contract Deploy is Script {
    /// @notice Hard raise floor forwarded to every offering (testnet value).
    uint256 internal constant MIN_RAISE = 500_000e18;

    function run() external {
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        MockKRW krw = new MockKRW();
        MockDojang mockDojang = new MockDojang();
        PoolFactory poolFactory = new PoolFactory();

        // Tiered fee model. Treasury = deployer for the demo.
        FeeRouter feeRouter = new FeeRouter(deployer, deployer);
        // Global buyback vault + v1 executor strategy.
        BuybackVault buybackVault = new BuybackVault(IERC20(address(krw)), deployer);
        BuybackExecutor buybackExecutor = new BuybackExecutor(buybackVault, deployer);
        buybackVault.setExecutor(address(buybackExecutor));

        // Platform guide (L1/L2 bands). L max is 30% of R for the demo; L0
        // offerings bypass the guide and only face the MIN_RAISE floor.
        MapaeFactory.Guide memory guide = MapaeFactory.Guide({
            minPrice: 1000e18,
            maxPrice: 100_000e18,
            minRaise: 5_000_000e18,
            maxRaise: 500_000_000e18,
            minWalletLimitBps: 10,
            maxWalletLimitBps: 3000
        });
        MapaeFactory.FeeRecipients memory recipients = MapaeFactory.FeeRecipients({platform: deployer});

        // Stack 2: main demo (mock verification, fully controllable)
        MapaeFactory factoryMock = new MapaeFactory(
            IDojang(address(mockDojang)),
            IERC20(address(krw)),
            deployer,
            poolFactory,
            feeRouter,
            buybackVault,
            MIN_RAISE,
            recipients,
            guide
        );

        // Stack 3: GIWA-native showcase (live Dojang attestation stack)
        DojangEASAdapter adapter = new DojangEASAdapter(
            IEAS(GiwaSepolia.EAS), IDojangScroll(GiwaSepolia.DOJANG_SCROLL), GiwaSepolia.VERIFIED_ADDRESS_SCHEMA_UID
        );
        MapaeFactory factoryDojang = new MapaeFactory(
            IDojang(address(adapter)),
            IERC20(address(krw)),
            deployer,
            poolFactory,
            feeRouter,
            buybackVault,
            MIN_RAISE,
            recipients,
            guide
        );

        vm.stopBroadcast();

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "deployer", deployer);
        vm.serializeAddress(json, "mockKRW", address(krw));
        vm.serializeAddress(json, "poolFactory", address(poolFactory));
        vm.serializeAddress(json, "feeRouter", address(feeRouter));
        vm.serializeAddress(json, "buybackVault", address(buybackVault));
        vm.serializeAddress(json, "buybackExecutor", address(buybackExecutor));
        vm.serializeAddress(json, "mockDojang", address(mockDojang));
        vm.serializeAddress(json, "factoryMock", address(factoryMock));
        vm.serializeAddress(json, "dojangEASAdapter", address(adapter));
        string memory out = vm.serializeAddress(json, "factoryDojang", address(factoryDojang));
        vm.writeJson(out, "deployments/giwa-sepolia.json");

        console.log("MockKRW:           ", address(krw));
        console.log("PoolFactory:       ", address(poolFactory));
        console.log("FeeRouter:         ", address(feeRouter));
        console.log("BuybackVault:      ", address(buybackVault));
        console.log("BuybackExecutor:   ", address(buybackExecutor));
        console.log("MockDojang:        ", address(mockDojang));
        console.log("MapaeFactory(mock):", address(factoryMock));
        console.log("DojangEASAdapter:  ", address(adapter));
        console.log("MapaeFactory(EAS): ", address(factoryDojang));
    }
}
