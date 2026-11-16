// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// MAPAE v3.2-L1 deploy (GIWA Sepolia, decision 56). Keystore account only, never a raw key; the
// deployer is the --sender. See docs/DEPLOY_V3_2_L1.md.
//
//   forge script script/DeployV3_2_L1.s.sol --account <keystore account> --sender <deployer-addr> \
//     --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast \
//     --libraries src/MembershipTokenDeployer.sol:MembershipTokenDeployer:<v3.2 membershipTokenDeployer>
//
// New: ProceedsLockDeployer and one MapaeFactory (its constructor creates OfferingDeployer and
// StackDeployer). The new factory checks real names with DojangAnyOf (official Dojang OR
// MockDojang), deploys a Sponsorship only when the issuer asks, and locks the issuer's L1/L2
// proceeds within the immutable ProceedsBand below.
// Reused (read from deployments/giwa-sepolia-v3_2.json and checked against the expected
// addresses): MockKRW, PoolFactory, FeeRouter, DojangAnyOf, the MembershipTokenDeployer library,
// and the BuybackVault the existing factory uses. minRaise, Guide and FeeRecipients are copied from
// the existing factory (0xC0E2…45A9, which keeps serving L0 as the quote registry and is not
// touched) and compared after deployment. Output: deployments/giwa-sepolia-v3_2_l1.json.
// No permission registration is needed on the reused contracts: PoolFactory only checks that the
// caller is the token's offering, FeeRouter has owner-only setters and public views, and the
// BuybackVault is registered as a burner by the new factory's own constructor.

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

contract DeployV3_2_L1 is Script {
    string internal constant IN = "deployments/giwa-sepolia-v3_2.json";
    string internal constant OUT = "deployments/giwa-sepolia-v3_2_l1.json";

    // Expected GIWA Sepolia addresses (C-T2 ticket); run() stops on any mismatch.
    address internal constant EXPECTED_POOL_FACTORY = 0xf4E7Bf1ACe429400AC23E271E4409D212677e44F;
    address internal constant EXPECTED_FEE_ROUTER = 0xAB665B7867080cd62Aa316717400f3Cc094E7bd6;
    address internal constant EXPECTED_BUYBACK_VAULT = 0x3Ed11f7Bcc36B3603d51736652884800daa2f54c;
    address internal constant EXPECTED_MOCK_KRW = 0x74eC9141afAd51F346BA5B841Ba93D573e8786fD;
    address internal constant EXPECTED_LIBRARY = 0x9F011858B85b93a73330B56319Dc76a6f3255279;
    address internal constant EXPECTED_DOJANG_ANY_OF = 0x87326FbbF76e724bA2bA954dAc04c3B939999f84;
    address internal constant EXPECTED_OLD_FACTORY = 0xC0E22127A44266cCC56B2503504373777d0645A9;
    /// @notice Platform ops wallet: owner of the new factory and settle authority of its offerings.
    address public constant PLATFORM_OWNER = 0x67a29AE83f3320C5E9b81D8a1531dE8FcCBED00C;

    struct Reused {
        address oldFactory; // existing MapaeFactory: source of minRaise / Guide / FeeRecipients
        address dojangAnyOf;
        address mockKRW;
        address poolFactory;
        address feeRouter;
        address buybackVault;
        address membershipTokenDeployer;
    }

    struct Deployed {
        address deployer;
        Reused reused;
        ProceedsLockDeployer proceedsLockDeployer;
        MapaeFactory factory;
    }

    /// @notice Testnet band (decision 56). Mainnet values are an owner decision and not here.
    function testnetBand() public pure returns (MapaeFactory.ProceedsBand memory) {
        return MapaeFactory.ProceedsBand({
            maxUpfrontBps: 3000, minLockDuration: 1 hours, maxLockDuration: 1095 days, maxLockCliff: 180 days
        });
    }

    /// @notice The Guide the PM read on the existing factory; deploy() stops if the chain differs.
    function expectedGuide() public pure returns (MapaeFactory.Guide memory) {
        return MapaeFactory.Guide({
            minPrice: 1000e18,
            maxPrice: 100_000e18,
            minRaise: 5_000_000e18,
            maxRaise: 500_000_000e18,
            minWalletLimitBps: 10,
            maxWalletLimitBps: 3000
        });
    }

    function run() external {
        require(block.chainid == GiwaSepolia.CHAIN_ID, "DeployV3_2_L1: not GIWA Sepolia");
        (, address deployer,) = vm.readCallers();
        string memory j = vm.readFile(IN);
        Reused memory r = Reused({
            oldFactory: vm.parseJsonAddress(j, ".factoryMock"),
            dojangAnyOf: vm.parseJsonAddress(j, ".dojangAnyOf"),
            mockKRW: vm.parseJsonAddress(j, ".mockKRW"),
            poolFactory: vm.parseJsonAddress(j, ".poolFactory"),
            feeRouter: vm.parseJsonAddress(j, ".feeRouter"),
            buybackVault: address(MapaeFactory(vm.parseJsonAddress(j, ".factoryMock")).buybackVault()),
            membershipTokenDeployer: vm.parseJsonAddress(j, ".membershipTokenDeployer")
        });
        require(r.oldFactory == EXPECTED_OLD_FACTORY, "DeployV3_2_L1: old factory");
        require(r.dojangAnyOf == EXPECTED_DOJANG_ANY_OF, "DeployV3_2_L1: DojangAnyOf");
        require(r.mockKRW == EXPECTED_MOCK_KRW, "DeployV3_2_L1: MockKRW");
        require(r.poolFactory == EXPECTED_POOL_FACTORY, "DeployV3_2_L1: PoolFactory");
        require(r.feeRouter == EXPECTED_FEE_ROUTER, "DeployV3_2_L1: FeeRouter");
        require(r.buybackVault == EXPECTED_BUYBACK_VAULT, "DeployV3_2_L1: BuybackVault");
        require(r.membershipTokenDeployer == EXPECTED_LIBRARY, "DeployV3_2_L1: library");
        uint256 deployBlock = block.number;
        Deployed memory d = deploy(deployer, r);
        _writeJson(d, deployBlock);
        _log(d);
    }

    /// @notice Deploys ProceedsLockDeployer + MapaeFactory and checks the result. Callable from tests.
    function deploy(address deployer, Reused memory r) public returns (Deployed memory d) {
        MapaeFactory old = MapaeFactory(r.oldFactory);
        require(r.dojangAnyOf.code.length > 0, "DeployV3_2_L1: DojangAnyOf has no code");
        require(r.poolFactory.code.length > 0 && r.feeRouter.code.length > 0, "DeployV3_2_L1: infra has no code");
        require(address(old.paymentToken()) == r.mockKRW, "DeployV3_2_L1: old factory payment token");
        require(address(old.poolFactory()) == r.poolFactory, "DeployV3_2_L1: old factory PoolFactory");
        require(address(old.feeRouter()) == r.feeRouter, "DeployV3_2_L1: old factory FeeRouter");
        require(address(old.buybackVault()) == r.buybackVault, "DeployV3_2_L1: old factory BuybackVault");
        // the Offering code in this build must call the reused library, not a fresh one
        require(
            new DeployV3().linkedMembershipTokenDeployer() == r.membershipTokenDeployer,
            "DeployV3_2_L1: pass --libraries with the v3.2 MembershipTokenDeployer"
        );
        MapaeFactory.Guide memory g = _guideOf(old);
        _requireGuide(g, expectedGuide());
        uint256 minRaise = old.minRaise();
        address platform = old.feeRecipients();

        d.deployer = deployer;
        d.reused = r;
        vm.startBroadcast(deployer);
        d.proceedsLockDeployer = new ProceedsLockDeployer();
        d.factory = new MapaeFactory(
            IDojang(r.dojangAnyOf),
            IERC20(r.mockKRW),
            PLATFORM_OWNER,
            PoolFactory(r.poolFactory),
            IFeeRouter(r.feeRouter),
            BuybackVault(r.buybackVault),
            minRaise,
            MapaeFactory.FeeRecipients({platform: platform}),
            g,
            testnetBand(),
            d.proceedsLockDeployer
        );
        vm.stopBroadcast();
        _check(d, old);
    }

    /// @dev Post-deploy checks: real-name source, owner, empty registry, band, copied settings.
    function _check(Deployed memory d, MapaeFactory old) internal view {
        MapaeFactory f = d.factory;
        require(address(f.dojang()) == d.reused.dojangAnyOf, "check: dojang");
        require(f.owner() == PLATFORM_OWNER && f.platformOwner() == PLATFORM_OWNER, "check: owner");
        require(f.allOfferings().length == 0, "check: offerings");
        require(address(f.proceedsLockDeployer()) == address(d.proceedsLockDeployer), "check: lock deployer");
        MapaeFactory.ProceedsBand memory b = f.proceedsBand();
        MapaeFactory.ProceedsBand memory want = testnetBand();
        require(
            b.maxUpfrontBps == want.maxUpfrontBps && b.minLockDuration == want.minLockDuration
                && b.maxLockDuration == want.maxLockDuration && b.maxLockCliff == want.maxLockCliff,
            "check: proceeds band"
        );
        require(f.minRaise() == old.minRaise(), "check: minRaise");
        require(f.feeRecipients() == old.feeRecipients(), "check: fee recipients");
        _requireGuide(_guideOf(f), _guideOf(old));
    }

    function _guideOf(MapaeFactory f) internal view returns (MapaeFactory.Guide memory g) {
        (g.minPrice, g.maxPrice, g.minRaise, g.maxRaise, g.minWalletLimitBps, g.maxWalletLimitBps) = f.guide();
    }

    function _requireGuide(MapaeFactory.Guide memory a, MapaeFactory.Guide memory b) internal pure {
        require(
            a.minPrice == b.minPrice && a.maxPrice == b.maxPrice && a.minRaise == b.minRaise && a.maxRaise == b.maxRaise
                && a.minWalletLimitBps == b.minWalletLimitBps && a.maxWalletLimitBps == b.maxWalletLimitBps,
            "DeployV3_2_L1: guide differs"
        );
    }

    function _writeJson(Deployed memory d, uint256 deployBlock) internal {
        string memory band = "band";
        MapaeFactory.ProceedsBand memory b = d.factory.proceedsBand();
        vm.serializeUint(band, "maxUpfrontBps", b.maxUpfrontBps);
        vm.serializeUint(band, "minLockDuration", b.minLockDuration);
        vm.serializeUint(band, "maxLockDuration", b.maxLockDuration);
        string memory bandJson = vm.serializeUint(band, "maxLockCliff", b.maxLockCliff);

        string memory j = "v3_2_l1";
        vm.serializeString(j, "version", "v3.2-L1");
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeUint(j, "deployBlock", deployBlock);
        vm.serializeAddress(j, "deployer", d.deployer);
        vm.serializeAddress(j, "platformOwner", PLATFORM_OWNER);
        vm.serializeAddress(j, "mapaeFactory", address(d.factory));
        vm.serializeAddress(j, "offeringDeployer", address(d.factory.offeringDeployer()));
        vm.serializeAddress(j, "stackDeployer", address(d.factory.stackDeployer()));
        vm.serializeAddress(j, "proceedsLockDeployer", address(d.proceedsLockDeployer));
        vm.serializeString(j, "proceedsBand", bandJson);
        vm.serializeAddress(j, "dojangAnyOf", d.reused.dojangAnyOf);
        vm.serializeAddress(j, "mockKRW", d.reused.mockKRW);
        vm.serializeAddress(j, "poolFactory", d.reused.poolFactory);
        vm.serializeAddress(j, "feeRouter", d.reused.feeRouter);
        vm.serializeAddress(j, "buybackVault", d.reused.buybackVault);
        vm.serializeAddress(j, "membershipTokenDeployer", d.reused.membershipTokenDeployer);
        string memory out = vm.serializeAddress(j, "previousMapaeFactory", d.reused.oldFactory);
        vm.writeJson(out, OUT);
    }

    function _log(Deployed memory d) internal view {
        console.log("ProceedsLockDeployer:", address(d.proceedsLockDeployer));
        console.log("MapaeFactory (v3.2-L1):", address(d.factory));
        console.log("OfferingDeployer:", address(d.factory.offeringDeployer()));
        console.log("StackDeployer:", address(d.factory.stackDeployer()));
        console.log("dojang:", address(d.factory.dojang()));
        console.log("owner:", d.factory.owner());
        MapaeFactory.ProceedsBand memory b = d.factory.proceedsBand();
        console.log("band maxUpfrontBps:", b.maxUpfrontBps);
        console.log("band lock duration min/max:", b.minLockDuration, b.maxLockDuration);
        console.log("band maxLockCliff:", b.maxLockCliff);
    }
}
