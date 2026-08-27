// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Sponsorship} from "../src/Sponsorship.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {IBurnerRegistry} from "../src/interfaces/IBurnerRegistry.sol";
import {BuybackVault} from "../src/BuybackVault.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";

/// @notice Sponsorship unit tests (D11). The test contract plays BOTH the
///         offering (sole minter/registrar) AND the pool's burner registry, so
///         it can authorize the Sponsorship for the 0%-fee swapForBurn path.
/// @dev v5.2: the burn buy moved from swapKrwForToken (fee) to swapForBurn (0%),
///      so the creator no longer receives a swap royalty on the burn side.
contract SponsorshipTest is Test, IBurnerRegistry {
    MockKRW internal krw;
    MembershipToken internal token;
    PoolFactory internal poolFactory;
    FeeRouter internal feeRouter;
    BuybackVault internal buybackVault;
    MapaePool internal pool;
    Sponsorship internal sponsorship;

    address internal creator = makeAddr("creator");
    address internal treasury = makeAddr("treasury");
    address internal fan = makeAddr("fan");

    IFeeRouter.UtilityTier internal constant TIER = IFeeRouter.UtilityTier.L1;
    uint16 internal constant BURN_SHARE_BPS = 1000; // X = 10%
    uint16 internal constant MAX_SLIPPAGE_BPS = 500;

    mapping(address => bool) internal _burners;

    /// @inheritdoc IBurnerRegistry
    function isBurner(address account) external view returns (bool) {
        return _burners[account];
    }

    function setUp() public {
        vm.warp(1_750_000_000);
        krw = new MockKRW();
        poolFactory = new PoolFactory();
        feeRouter = new FeeRouter(address(this), treasury);
        buybackVault = new BuybackVault(IERC20(address(krw)), address(this));
        token = new MembershipToken("Creator Membership", "CRTM", address(this), 0, 0, new address[](0));

        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        to[0] = address(this);
        amounts[0] = 900e18;
        to[1] = fan;
        amounts[1] = 100e18;
        token.mintAllocations(to, amounts);

        sponsorship =
            new Sponsorship(token, IERC20(address(krw)), creator, BURN_SHARE_BPS, MAX_SLIPPAGE_BPS, TIER, buybackVault);
        _burners[address(sponsorship)] = true;

        // factory == address(this): this test contract is the burner registry.
        pool = poolFactory.createPool(token, IERC20(address(krw)), creator, feeRouter, TIER, address(this), 60, 30);
        token.registerPool(address(pool));
        token.transfer(address(pool), 100e18);
        krw.faucet(1_000_000e18);
        krw.transfer(address(pool), 1_000_000e18);
        pool.mint(pool.DEAD());
    }

    function _newSponsorship(uint16 burnBps) internal returns (Sponsorship s) {
        s = new Sponsorship(token, IERC20(address(krw)), creator, burnBps, MAX_SLIPPAGE_BPS, TIER, buybackVault);
        _burners[address(s)] = true;
    }

    function test_Constructor_BandValidation() public {
        vm.expectRevert(Sponsorship.InvalidConfig.selector);
        new Sponsorship(token, IERC20(address(krw)), creator, 2001, MAX_SLIPPAGE_BPS, TIER, buybackVault); // X > 20%
        new Sponsorship(token, IERC20(address(krw)), creator, 2000, MAX_SLIPPAGE_BPS, TIER, buybackVault); // edge ok
    }

    function test_SponsorKRWs_BurnsAndPaysCreator() public {
        uint256 amount = 100_000e18;
        uint256 supplyBefore = token.totalSupply();
        uint256 creatorKrwBefore = krw.balanceOf(creator);

        vm.startPrank(fan);
        krw.faucet(amount);
        krw.approve(address(sponsorship), amount);
        uint256 burned = sponsorship.sponsorKRWs(amount, unicode"오늘 방송 최고!");
        vm.stopPrank();

        // 10% bought from the pool (0%-fee) and burned
        assertGt(burned, 0.9e18);
        assertEq(supplyBefore - token.totalSupply(), burned);
        // 90% reached the creator; no swap royalty now (burn buy is 0-fee), and
        // no reroute (rate defaults to 0)
        uint256 creatorGain = krw.balanceOf(creator) - creatorKrwBefore;
        assertEq(creatorGain, amount * 9000 / 10_000);
        // sponsorship contract retains nothing
        assertEq(krw.balanceOf(address(sponsorship)), 0);
        assertEq(token.balanceOf(address(sponsorship)), 0);
    }

    function test_SponsorKRWs_EmitsMessageForOverlay() public {
        string memory message = unicode"1만원 후원!";
        vm.startPrank(fan);
        krw.faucet(10_000e18);
        krw.approve(address(sponsorship), 10_000e18);
        vm.expectEmit(true, false, false, false);
        emit Sponsorship.Sponsored(fan, true, 0, 0, 0, 0, keccak256(bytes(message)), message);
        sponsorship.sponsorKRWs(10_000e18, message);
        vm.stopPrank();
    }

    function test_SponsorKRWs_ZeroBurnShare() public {
        Sponsorship noBurn = _newSponsorship(0);
        vm.startPrank(fan);
        krw.faucet(10_000e18);
        krw.approve(address(noBurn), 10_000e18);
        uint256 burned = noBurn.sponsorKRWs(10_000e18, "no burn");
        vm.stopPrank();
        assertEq(burned, 0);
        assertEq(krw.balanceOf(creator), 10_000e18); // 100% straight through
    }

    /// §8-B ②: a huge sponsorship against a thin pool exceeds the slippage
    /// band and reverts instead of burning at a fake price.
    function test_SponsorKRWs_SlippageGuardOnThinPool() public {
        uint256 amount = 30_000_000e18;
        vm.startPrank(fan);
        krw.faucet(10_000_000e18);
        krw.faucet(10_000_000e18);
        krw.faucet(10_000_000e18);
        krw.approve(address(sponsorship), amount);
        vm.expectRevert(); // MapaePool.InsufficientOutput
        sponsorship.sponsorKRWs(amount, "whale");
        vm.stopPrank();
    }

    function test_SponsorToken_BurnsAndForwards() public {
        uint256 amount = 10e18;
        uint256 supplyBefore = token.totalSupply();
        vm.startPrank(fan);
        token.approve(address(sponsorship), amount);
        uint256 burned = sponsorship.sponsorToken(amount, unicode"토큰 후원");
        vm.stopPrank();

        assertEq(burned, amount * BURN_SHARE_BPS / 10_000); // 1 token
        assertEq(supplyBefore - token.totalSupply(), burned);
        assertEq(token.balanceOf(creator), amount - burned); // 9 tokens
        assertEq(token.balanceOf(address(sponsorship)), 0);
    }

    function test_RevertBeforeListing() public {
        MembershipToken unlisted = new MembershipToken("Unlisted", "UNL", address(this), 0, 0, new address[](0));
        Sponsorship s = new Sponsorship(
            unlisted, IERC20(address(krw)), creator, BURN_SHARE_BPS, MAX_SLIPPAGE_BPS, TIER, buybackVault
        );
        vm.startPrank(fan);
        krw.faucet(1e18);
        krw.approve(address(s), 1e18);
        vm.expectRevert(Sponsorship.PoolNotListed.selector);
        s.sponsorKRWs(1e18, "too early");
        vm.stopPrank();
    }
}
