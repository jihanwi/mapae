// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// MAPAE v3.4-L1 deploy (GIWA Sepolia, decisions 62 and 63). Keystore account only, never a raw
// key; the deployer is the --sender. See docs/DEPLOY_V3_4_L1.md.
//
//   PLATFORM_OWNER=<addr> SETTLER=<addr or 0x0> forge script script/DeployV3_4_L1.s.sol \
//     --account <keystore account> --sender <deployer-addr> --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast \
//     --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:<v3.2 membershipTokenDeployer>
//
// New (1 transaction):
//   - MapaeFactory: the Offering bytecode changed (settle authority read from the factory's
//     settler, zero-commit refunds) and the factory gained the settler and the Open/Frozen live
//     cap; its constructor creates a new OfferingDeployer and StackDeployer.
// Reused (read from deployments/giwa-sepolia-v3_3_l1.json, checked against the expected
// addresses): the v3.3-L1 FeeRouter (decision 59 band, unchanged), DojangAnyOf, MockKRW,
// PoolFactory, BuybackVault, ProceedsLockDeployer and the MembershipTokenDeployer library.
// Factory settings (Guide, ProceedsBand, minRaise, FeeRecipients) are read from the v3.3-L1
// factory (0x3b1D…767f) and must match. owner / platformOwner come from env PLATFORM_OWNER, the
// settle-only address from env SETTLER (0x0 allowed: only the owner settles). Neither the v3.3-L1
// factory nor its offerings change. Output: deployments/giwa-sepolia-v3_4_l1.json.
// No permission registration is needed: PoolFactory only checks that the caller is the token's
// offering, and the new factory registers the BuybackVault as a burner in its own constructor.

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {GiwaSepolia} from "../src/Constants.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {ProceedsLockDeployer} from "../src/ProceedsLockDeployer.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {BuybackVault} from "../src/BuybackVault.sol";
import {DeployV3} from "./DeployV3.s.sol";

contract DeployV3_4_L1 is Script {
    string internal constant IN = "deployments/giwa-sepolia-v3_3_l1.json";
    string internal constant OUT = "deployments/giwa-sepolia-v3_4_l1.json";

    // Expected GIWA Sepolia addresses (v3.3-L1 record); run() stops on any mismatch.
    address internal constant EXPECTED_OLD_FACTORY = 0x3b1D679d6CFA5f2e92832aFfBf516319204D767f;
    address internal constant EXPECTED_FEE_ROUTER = 0xC8EF125aa945aF92144ECadc39CeE1a0b7415a70;
    address internal constant EXPECTED_PROCEEDS_LOCK_DEPLOYER = 0x755568f5BB314DD67c0ffB91Db491d1f63AA97C9;
    address internal constant EXPECTED_POOL_FACTORY = 0xf4E7Bf1ACe429400AC23E271E4409D212677e44F;
    address internal constant EXPECTED_BUYBACK_VAULT = 0x3Ed11f7Bcc36B3603d51736652884800daa2f54c;
    address internal constant EXPECTED_MOCK_KRW = 0x74eC9141afAd51F346BA5B841Ba93D573e8786fD;
    address internal constant EXPECTED_LIBRARY = 0x9F011858B85b93a73330B56319Dc76a6f3255279;
    address internal constant EXPECTED_DOJANG_ANY_OF = 0x87326FbbF76e724bA2bA954dAc04c3B939999f84;

    struct Reused {
        address oldFactory; // v3.3-L1 MapaeFactory: source of every factory setting
        address feeRouter; // v3.3-L1 FeeRouter, reused as is
        address dojangAnyOf;
        address mockKRW;
        address poolFactory;
        address buybackVault;
        address proceedsLockDeployer;
        address membershipTokenDeployer;
    }

    struct Deployed {
        address deployer;
        address platformOwner;
        address settler;
        Reused reused;
        MapaeFactory factory;
    }

    function run() external {
        require(block.chainid == GiwaSepolia.CHAIN_ID, "DeployV3_4_L1: not GIWA Sepolia");
        (, address deployer,) = vm.readCallers();
        address platformOwner = vm.envAddress("PLATFORM_OWNER");
        address settler = vm.envAddress("SETTLER");
        string memory j = vm.readFile(IN);
        Reused memory r = Reused({
            oldFactory: vm.parseJsonAddress(j, ".mapaeFactory"),
            feeRouter: vm.parseJsonAddress(j, ".feeRouter"),
            dojangAnyOf: vm.parseJsonAddress(j, ".dojangAnyOf"),
            mockKRW: vm.parseJsonAddress(j, ".mockKRW"),
            poolFactory: vm.parseJsonAddress(j, ".poolFactory"),
            buybackVault: vm.parseJsonAddress(j, ".buybackVault"),
            proceedsLockDeployer: vm.parseJsonAddress(j, ".proceedsLockDeployer"),
            membershipTokenDeployer: vm.parseJsonAddress(j, ".membershipTokenDeployer")
        });
        require(r.oldFactory == EXPECTED_OLD_FACTORY, "DeployV3_4_L1: old factory");
        require(r.feeRouter == EXPECTED_FEE_ROUTER, "DeployV3_4_L1: FeeRouter");
        require(r.dojangAnyOf == EXPECTED_DOJANG_ANY_OF, "DeployV3_4_L1: DojangAnyOf");
        require(r.mockKRW == EXPECTED_MOCK_KRW, "DeployV3_4_L1: MockKRW");
        require(r.poolFactory == EXPECTED_POOL_FACTORY, "DeployV3_4_L1: PoolFactory");
        require(r.buybackVault == EXPECTED_BUYBACK_VAULT, "DeployV3_4_L1: BuybackVault");
        require(r.proceedsLockDeployer == EXPECTED_PROCEEDS_LOCK_DEPLOYER, "DeployV3_4_L1: ProceedsLockDeployer");
        require(r.membershipTokenDeployer == EXPECTED_LIBRARY, "DeployV3_4_L1: library");
        uint256 deployBlock = block.number;
        Deployed memory d = deploy(deployer, r, platformOwner, settler);
        _writeJson(d, deployBlock);
        _log(d);
    }

    /// @notice Deploys the MapaeFactory and checks the result. Callable from tests.
    function deploy(address deployer, Reused memory r, address platformOwner, address settler)
        public
        returns (Deployed memory d)
    {
        require(platformOwner != address(0), "DeployV3_4_L1: PLATFORM_OWNER is zero");
        MapaeFactory old = MapaeFactory(r.oldFactory);
        require(r.dojangAnyOf.code.length > 0, "DeployV3_4_L1: DojangAnyOf has no code");
        require(
            r.poolFactory.code.length > 0 && r.proceedsLockDeployer.code.length > 0, "DeployV3_4_L1: infra has no code"
        );
        // the reused contracts are the ones the v3.3-L1 factory uses
        require(address(old.dojang()) == r.dojangAnyOf, "DeployV3_4_L1: old factory dojang");
        require(address(old.paymentToken()) == r.mockKRW, "DeployV3_4_L1: old factory payment token");
        require(address(old.poolFactory()) == r.poolFactory, "DeployV3_4_L1: old factory PoolFactory");
        require(address(old.feeRouter()) == r.feeRouter, "DeployV3_4_L1: old factory FeeRouter");
        require(address(old.buybackVault()) == r.buybackVault, "DeployV3_4_L1: old factory BuybackVault");
        require(
            address(old.proceedsLockDeployer()) == r.proceedsLockDeployer, "DeployV3_4_L1: old factory lock deployer"
        );
        require(
            new DeployV3().linkedMembershipTokenDeployer() == r.membershipTokenDeployer,
            "DeployV3_4_L1: pass --libraries with the v3.2 MembershipTokenDeployer"
        );

        d.deployer = deployer;
        d.platformOwner = platformOwner;
        d.settler = settler;
        d.reused = r;
        vm.startBroadcast(deployer);
        d.factory = new MapaeFactory(
            IDojang(r.dojangAnyOf),
            IERC20(r.mockKRW),
            platformOwner,
            PoolFactory(r.poolFactory),
            IFeeRouter(r.feeRouter),
            BuybackVault(r.buybackVault),
            old.minRaise(),
            MapaeFactory.FeeRecipients({platform: old.feeRecipients()}),
            _guideOf(old),
            old.proceedsBand(),
            ProceedsLockDeployer(r.proceedsLockDeployer),
            settler
        );
        vm.stopBroadcast();
        _check(d, old);
    }

    /// @dev Post-deploy checks against the v3.3-L1 factory.
    function _check(Deployed memory d, MapaeFactory old) internal view {
        MapaeFactory f = d.factory;
        require(address(f.feeRouter()) == d.reused.feeRouter, "check: factory router");
        require(address(f.dojang()) == d.reused.dojangAnyOf, "check: dojang");
        require(address(f.paymentToken()) == d.reused.mockKRW, "check: payment token");
        require(address(f.poolFactory()) == d.reused.poolFactory, "check: pool factory");
        require(address(f.buybackVault()) == d.reused.buybackVault, "check: buyback vault");
        require(f.isBurner(d.reused.buybackVault), "check: vault burner");
        require(address(f.proceedsLockDeployer()) == d.reused.proceedsLockDeployer, "check: lock deployer");
        require(f.owner() == d.platformOwner && f.platformOwner() == d.platformOwner, "check: owner");
        require(f.settler() == d.settler, "check: settler");
        require(f.allOfferings().length == 0, "check: offerings");
        require(f.minRaise() == old.minRaise(), "check: minRaise");
        require(f.feeRecipients() == old.feeRecipients(), "check: fee recipients");
        _requireGuide(_guideOf(f), _guideOf(old));
        MapaeFactory.ProceedsBand memory a = f.proceedsBand();
        MapaeFactory.ProceedsBand memory b = old.proceedsBand();
        require(
            a.maxUpfrontBps == b.maxUpfrontBps && a.minLockDuration == b.minLockDuration
                && a.maxLockDuration == b.maxLockDuration && a.maxLockCliff == b.maxLockCliff,
            "check: proceeds band"
        );
    }

    function _guideOf(MapaeFactory f) internal view returns (MapaeFactory.Guide memory g) {
        (g.minPrice, g.maxPrice, g.minRaise, g.maxRaise, g.minWalletLimitBps, g.maxWalletLimitBps) = f.guide();
    }

    function _requireGuide(MapaeFactory.Guide memory a, MapaeFactory.Guide memory b) internal pure {
        require(
            a.minPrice == b.minPrice && a.maxPrice == b.maxPrice && a.minRaise == b.minRaise && a.maxRaise == b.maxRaise
                && a.minWalletLimitBps == b.minWalletLimitBps && a.maxWalletLimitBps == b.maxWalletLimitBps,
            "DeployV3_4_L1: guide differs"
        );
    }

    function _writeJson(Deployed memory d, uint256 deployBlock) internal {
        string memory band = "band";
        MapaeFactory.ProceedsBand memory b = d.factory.proceedsBand();
        vm.serializeUint(band, "maxUpfrontBps", b.maxUpfrontBps);
        vm.serializeUint(band, "minLockDuration", b.minLockDuration);
        vm.serializeUint(band, "maxLockDuration", b.maxLockDuration);
        string memory bandJson = vm.serializeUint(band, "maxLockCliff", b.maxLockCliff);

        string memory j = "v3_4_l1";
        vm.serializeString(j, "version", "v3.4-L1");
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeUint(j, "deployBlock", deployBlock);
        vm.serializeAddress(j, "deployer", d.deployer);
        vm.serializeAddress(j, "platformOwner", d.platformOwner);
        vm.serializeAddress(j, "settler", d.settler);
        vm.serializeAddress(j, "feeRouter", d.reused.feeRouter);
        vm.serializeAddress(j, "mapaeFactory", address(d.factory));
        vm.serializeAddress(j, "offeringDeployer", address(d.factory.offeringDeployer()));
        vm.serializeAddress(j, "stackDeployer", address(d.factory.stackDeployer()));
        vm.serializeAddress(j, "proceedsLockDeployer", d.reused.proceedsLockDeployer);
        vm.serializeString(j, "proceedsBand", bandJson);
        vm.serializeAddress(j, "dojangAnyOf", d.reused.dojangAnyOf);
        vm.serializeAddress(j, "mockKRW", d.reused.mockKRW);
        vm.serializeAddress(j, "poolFactory", d.reused.poolFactory);
        vm.serializeAddress(j, "buybackVault", d.reused.buybackVault);
        vm.serializeAddress(j, "membershipTokenDeployer", d.reused.membershipTokenDeployer);
        string memory out = vm.serializeAddress(j, "previousMapaeFactory", d.reused.oldFactory);
        vm.writeJson(out, OUT);
    }

    function _log(Deployed memory d) internal view {
        console.log("MapaeFactory (v3.4-L1):", address(d.factory));
        console.log("OfferingDeployer:", address(d.factory.offeringDeployer()));
        console.log("StackDeployer:", address(d.factory.stackDeployer()));
        console.log("FeeRouter (reused):", d.reused.feeRouter);
        console.log("owner / platformOwner:", d.factory.owner(), d.factory.platformOwner());
        console.log("settler:", d.factory.settler());
    }
}
