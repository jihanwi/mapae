// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Sponsorship} from "../src/Sponsorship.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";

/// @notice Sponsorship unit tests (D11). Test contract plays the offering.
contract SponsorshipTest is Test {
    MockKRW internal krw;
    MembershipToken internal token;
    PoolFactory internal poolFactory;
    MapaePool internal pool;
    Sponsorship internal sponsorship;

    address internal creator = makeAddr("creator");
    address internal fan = makeAddr("fan");

    uint16 internal constant BURN_SHARE_BPS = 1000; // X = 10%
    uint16 internal constant MAX_SLIPPAGE_BPS = 500;

    function setUp() public {
        vm.warp(1_750_000_000);
        krw = new MockKRW();
        poolFactory = new PoolFactory();
        token = new MembershipToken("Creator Membership", "CRTM", address(this), 0, 0, new address[](0));

        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        to[0] = address(this);
        amounts[0] = 900e18;
        to[1] = fan;
        amounts[1] = 100e18;
        token.mintAllocations(to, amounts);

        sponsorship = new Sponsorship(token, IERC20(address(krw)), creator, BURN_SHARE_BPS, MAX_SLIPPAGE_BPS);

        pool = poolFactory.createPool(token, IERC20(address(krw)), creator, 100, 50);
        token.registerPool(address(pool));
        token.transfer(address(pool), 100e18);
        krw.faucet(1_000_000e18);
        krw.transfer(address(pool), 1_000_000e18);
        pool.mint(pool.DEAD());
    }

    function test_Constructor_BandValidation() public {
        vm.expectRevert(Sponsorship.InvalidConfig.selector);
        new Sponsorship(token, IERC20(address(krw)), creator, 2001, MAX_SLIPPAGE_BPS); // X > 20%
        new Sponsorship(token, IERC20(address(krw)), creator, 2000, MAX_SLIPPAGE_BPS); // edge ok
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

        // 10% bought from the pool and burned (≈ 0.98 token/10k KRW minus impact)
        assertGt(burned, 0.9e18);
        assertEq(supplyBefore - token.totalSupply(), burned);
        // 90% + swap royalty (1% of the 10k burn buy) reached the creator
        uint256 creatorGain = krw.balanceOf(creator) - creatorKrwBefore;
        assertEq(creatorGain, amount * 9000 / 10_000 + (amount * 1000 / 10_000) * 100 / 10_000);
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
        Sponsorship noBurn = new Sponsorship(token, IERC20(address(krw)), creator, 0, MAX_SLIPPAGE_BPS);
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
        // burn side = 10% of 30M = 3M KRWs vs 1M reserve → massive price impact
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
        // token without a registered pool
        MembershipToken unlisted = new MembershipToken("Unlisted", "UNL", address(this), 0, 0, new address[](0));
        Sponsorship s = new Sponsorship(unlisted, IERC20(address(krw)), creator, BURN_SHARE_BPS, MAX_SLIPPAGE_BPS);
        vm.startPrank(fan);
        krw.faucet(1e18);
        krw.approve(address(s), 1e18);
        vm.expectRevert(Sponsorship.PoolNotListed.selector);
        s.sponsorKRWs(1e18, "too early");
        vm.stopPrank();
    }
}
