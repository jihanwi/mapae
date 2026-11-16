// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// MAPAE v3.3-L1 deploy (GIWA Sepolia, decision 59: L1/L2 offering fee band [0, 500], preset 0).
// Keystore account only, never a raw key; the deployer is the --sender. See docs/DEPLOY_V3_3_L1.md.
//
//   forge script script/DeployV3_3_L1.s.sol --account <keystore account> --sender <deployer-addr> \
//     --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast \
//     --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:<v3.2 membershipTokenDeployer>
//
// New (2 transactions):
//   - FeeRouter: the band is a constant, so the change needs a new router. owner and
//     platformTreasury are copied from the current router (0xAB66…7bd6) and compared.
//   - MapaeFactory: FeeRouter is immutable in it; its constructor creates a new OfferingDeployer
//     and StackDeployer (bound to the factory, cannot be reused).
// Reused (read from deployments/giwa-sepolia-v3_2.json and giwa-sepolia-v3_2_l1.json, checked
// against the expected addresses): DojangAnyOf, MockKRW, PoolFactory, BuybackVault, the
// MembershipTokenDeployer library, and ProceedsLockDeployer (permissionless and stateless: deploy()
// takes every argument from the caller and is bound to no factory).
// Factory settings (Guide, ProceedsBand, minRaise, FeeRecipients, owner / platformOwner) are read
// from the current L1 factory (0xa9CA…bc71) and must match. The L0 CurveFactory keeps the current
// FeeRouter; neither is touched. Output: deployments/giwa-sepolia-v3_3_l1.json.
// No permission registration is needed: PoolFactory only checks that the caller is the token's
// offering, and the new factory registers the BuybackVault as a burner in its own constructor.

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {GiwaSepolia} from "../src/Constants.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {MapaeFactory} from "../src/MapaeFactory.sol";
import {ProceedsLockDeployer} from "../src/ProceedsLockDeployer.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {BuybackVault} from "../src/BuybackVault.sol";
import {DeployV3} from "./DeployV3.s.sol";

contract DeployV3_3_L1 is Script {
    string internal constant IN_V32 = "deployments/giwa-sepolia-v3_2.json";
    string internal constant IN_L1 = "deployments/giwa-sepolia-v3_2_l1.json";
    string internal constant OUT = "deployments/giwa-sepolia-v3_3_l1.json";

    // Expected GIWA Sepolia addresses (C-T3 ticket); run() stops on any mismatch.
    address internal constant EXPECTED_OLD_L1_FACTORY = 0xa9CA0C10Cd6B6398679B578DCE192cb4cAA5bc71;
    address internal constant EXPECTED_OLD_FEE_ROUTER = 0xAB665B7867080cd62Aa316717400f3Cc094E7bd6;
    address internal constant EXPECTED_PROCEEDS_LOCK_DEPLOYER = 0x755568f5BB314DD67c0ffB91Db491d1f63AA97C9;
    address internal constant EXPECTED_POOL_FACTORY = 0xf4E7Bf1ACe429400AC23E271E4409D212677e44F;
    address internal constant EXPECTED_BUYBACK_VAULT = 0x3Ed11f7Bcc36B3603d51736652884800daa2f54c;
    address internal constant EXPECTED_MOCK_KRW = 0x74eC9141afAd51F346BA5B841Ba93D573e8786fD;
    address internal constant EXPECTED_LIBRARY = 0x9F011858B85b93a73330B56319Dc76a6f3255279;
    address internal constant EXPECTED_DOJANG_ANY_OF = 0x87326FbbF76e724bA2bA954dAc04c3B939999f84;
    /// @notice Owner of the new factory (set in its constructor) and settle authority.
    address public constant PLATFORM_OWNER = 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C;

    struct Reused {
        address oldFactory; // current L1 MapaeFactory: source of every factory setting
        address oldFeeRouter; // current FeeRouter: source of owner and platformTreasury
        address dojangAnyOf;
        address mockKRW;
        address poolFactory;
        address buybackVault;
        address proceedsLockDeployer;
        address membershipTokenDeployer;
    }

    struct Deployed {
        address deployer;
        Reused reused;
        FeeRouter feeRouter;
        MapaeFactory factory;
    }

    function run() external {
        require(block.chainid == GiwaSepolia.CHAIN_ID, "DeployV3_3_L1: not GIWA Sepolia");
        (, address deployer,) = vm.readCallers();
        string memory v32 = vm.readFile(IN_V32);
        string memory l1 = vm.readFile(IN_L1);
        Reused memory r = Reused({
            oldFactory: vm.parseJsonAddress(l1, ".mapaeFactory"),
            oldFeeRouter: vm.parseJsonAddress(l1, ".feeRouter"),
            dojangAnyOf: vm.parseJsonAddress(v32, ".dojangAnyOf"),
            mockKRW: vm.parseJsonAddress(v32, ".mockKRW"),
            poolFactory: vm.parseJsonAddress(v32, ".poolFactory"),
            buybackVault: vm.parseJsonAddress(l1, ".buybackVault"),
            proceedsLockDeployer: vm.parseJsonAddress(l1, ".proceedsLockDeployer"),
            membershipTokenDeployer: vm.parseJsonAddress(v32, ".membershipTokenDeployer")
        });
        require(r.oldFactory == EXPECTED_OLD_L1_FACTORY, "DeployV3_3_L1: old L1 factory");
        require(r.oldFeeRouter == EXPECTED_OLD_FEE_ROUTER, "DeployV3_3_L1: old FeeRouter");
        require(r.dojangAnyOf == EXPECTED_DOJANG_ANY_OF, "DeployV3_3_L1: DojangAnyOf");
        require(r.mockKRW == EXPECTED_MOCK_KRW, "DeployV3_3_L1: MockKRW");
        require(r.poolFactory == EXPECTED_POOL_FACTORY, "DeployV3_3_L1: PoolFactory");
        require(r.buybackVault == EXPECTED_BUYBACK_VAULT, "DeployV3_3_L1: BuybackVault");
        require(r.proceedsLockDeployer == EXPECTED_PROCEEDS_LOCK_DEPLOYER, "DeployV3_3_L1: ProceedsLockDeployer");
        require(r.membershipTokenDeployer == EXPECTED_LIBRARY, "DeployV3_3_L1: library");
        // the two JSON records agree with each other
        require(vm.parseJsonAddress(l1, ".dojangAnyOf") == r.dojangAnyOf, "DeployV3_3_L1: json dojangAnyOf");
        require(vm.parseJsonAddress(l1, ".mockKRW") == r.mockKRW, "DeployV3_3_L1: json mockKRW");
        require(vm.parseJsonAddress(l1, ".poolFactory") == r.poolFactory, "DeployV3_3_L1: json poolFactory");
        require(
            vm.parseJsonAddress(l1, ".membershipTokenDeployer") == r.membershipTokenDeployer,
            "DeployV3_3_L1: json library"
        );
        uint256 deployBlock = block.number;
        Deployed memory d = deploy(deployer, r);
        _writeJson(d, deployBlock);
        _log(d);
    }

    /// @notice Deploys FeeRouter + MapaeFactory and checks the result. Callable from tests.
    function deploy(address deployer, Reused memory r) public returns (Deployed memory d) {
        MapaeFactory old = MapaeFactory(r.oldFactory);
        FeeRouter oldRouter = FeeRouter(r.oldFeeRouter);
        require(r.dojangAnyOf.code.length > 0, "DeployV3_3_L1: DojangAnyOf has no code");
        require(
            r.poolFactory.code.length > 0 && r.proceedsLockDeployer.code.length > 0, "DeployV3_3_L1: infra has no code"
        );
        // the reused contracts are the ones the current L1 factory uses
        require(address(old.dojang()) == r.dojangAnyOf, "DeployV3_3_L1: old factory dojang");
        require(address(old.paymentToken()) == r.mockKRW, "DeployV3_3_L1: old factory payment token");
        require(address(old.poolFactory()) == r.poolFactory, "DeployV3_3_L1: old factory PoolFactory");
        require(address(old.feeRouter()) == r.oldFeeRouter, "DeployV3_3_L1: old factory FeeRouter");
        require(address(old.buybackVault()) == r.buybackVault, "DeployV3_3_L1: old factory BuybackVault");
        require(
            address(old.proceedsLockDeployer()) == r.proceedsLockDeployer, "DeployV3_3_L1: old factory lock deployer"
        );
        require(
            old.owner() == PLATFORM_OWNER && old.platformOwner() == PLATFORM_OWNER, "DeployV3_3_L1: old factory owner"
        );
        require(
            new DeployV3().linkedMembershipTokenDeployer() == r.membershipTokenDeployer,
            "DeployV3_3_L1: pass --libraries with the v3.2 MembershipTokenDeployer"
        );
        address routerOwner = oldRouter.owner();
        address treasury = oldRouter.platformTreasury();

        d.deployer = deployer;
        d.reused = r;
        vm.startBroadcast(deployer);
        d.feeRouter = new FeeRouter(routerOwner, treasury);
        d.factory = new MapaeFactory(
            IDojang(r.dojangAnyOf),
            IERC20(r.mockKRW),
            PLATFORM_OWNER,
            PoolFactory(r.poolFactory),
            IFeeRouter(address(d.feeRouter)),
            BuybackVault(r.buybackVault),
            old.minRaise(),
            MapaeFactory.FeeRecipients({platform: old.feeRecipients()}),
            _guideOf(old),
            old.proceedsBand(),
            ProceedsLockDeployer(r.proceedsLockDeployer)
        );
        vm.stopBroadcast();
        _check(d, old, oldRouter);
    }

    /// @dev Post-deploy checks against the current L1 factory and FeeRouter.
    function _check(Deployed memory d, MapaeFactory old, FeeRouter oldRouter) internal view {
        FeeRouter fr = d.feeRouter;
        require(fr.owner() == oldRouter.owner(), "check: router owner");
        require(fr.platformTreasury() == oldRouter.platformTreasury(), "check: router treasury");
        IFeeRouter.TierFees memory l1 = fr.getFees(IFeeRouter.UtilityTier.L1);
        require(
            l1.offeringFeeBps == 0 && l1.swapPlatformBps == 40 && l1.swapRoyaltyBps == 60 && l1.swapBurnBps == 30
                && l1.swapLpBps == 20 && l1.merchFeeBps == 400,
            "check: L1 fees"
        );
        require(fr.swapTotalBps(IFeeRouter.UtilityTier.L1) == 150, "check: L1 swap total");
        MapaeFactory f = d.factory;
        require(address(f.feeRouter()) == address(fr), "check: factory router");
        require(address(f.dojang()) == d.reused.dojangAnyOf, "check: dojang");
        require(address(f.paymentToken()) == d.reused.mockKRW, "check: payment token");
        require(address(f.poolFactory()) == d.reused.poolFactory, "check: pool factory");
        require(address(f.buybackVault()) == d.reused.buybackVault, "check: buyback vault");
        require(f.isBurner(d.reused.buybackVault), "check: vault burner");
        require(address(f.proceedsLockDeployer()) == d.reused.proceedsLockDeployer, "check: lock deployer");
        require(f.owner() == PLATFORM_OWNER && f.platformOwner() == PLATFORM_OWNER, "check: owner");
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
            "DeployV3_3_L1: guide differs"
        );
    }

    function _writeJson(Deployed memory d, uint256 deployBlock) internal {
        string memory band = "band";
        MapaeFactory.ProceedsBand memory b = d.factory.proceedsBand();
        vm.serializeUint(band, "maxUpfrontBps", b.maxUpfrontBps);
        vm.serializeUint(band, "minLockDuration", b.minLockDuration);
        vm.serializeUint(band, "maxLockDuration", b.maxLockDuration);
        string memory bandJson = vm.serializeUint(band, "maxLockCliff", b.maxLockCliff);

        string memory j = "v3_3_l1";
        vm.serializeString(j, "version", "v3.3-L1");
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeUint(j, "deployBlock", deployBlock);
        vm.serializeAddress(j, "deployer", d.deployer);
        vm.serializeAddress(j, "platformOwner", PLATFORM_OWNER);
        vm.serializeAddress(j, "feeRouter", address(d.feeRouter));
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
        vm.serializeAddress(j, "previousFeeRouter", d.reused.oldFeeRouter);
        string memory out = vm.serializeAddress(j, "previousMapaeFactory", d.reused.oldFactory);
        vm.writeJson(out, OUT);
    }

    function _log(Deployed memory d) internal view {
        console.log("FeeRouter (v3.3-L1):", address(d.feeRouter));
        console.log("MapaeFactory (v3.3-L1):", address(d.factory));
        console.log("OfferingDeployer:", address(d.factory.offeringDeployer()));
        console.log("StackDeployer:", address(d.factory.stackDeployer()));
        console.log("ProceedsLockDeployer (reused):", d.reused.proceedsLockDeployer);
        IFeeRouter.TierFees memory l1 = d.feeRouter.getFees(IFeeRouter.UtilityTier.L1);
        console.log("L1 offeringFeeBps:", l1.offeringFeeBps);
        console.log("router owner / treasury:", d.feeRouter.owner(), d.feeRouter.platformTreasury());
    }
}
