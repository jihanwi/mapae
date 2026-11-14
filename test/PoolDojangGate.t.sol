// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IBurnerRegistry} from "../src/interfaces/IBurnerRegistry.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

/// @dev Dojang whose lookup always reverts (outage / misconfiguration).
contract RevertingDojang is IDojang {
    function isVerified(address) external pure returns (bool) {
        revert("dojang down");
    }
}

/// @notice v3 decision B: Dojang gate on MapaePool swaps (MAPAE v3 / Phase 1 / T5), G1..G6.
///         The test contract plays the offering (minter/registrar/seeder) and the burner registry.
contract PoolDojangGateTest is Test, IBurnerRegistry {
    MockKRW internal krw;
    MockDojang internal dojang;
    MembershipToken internal token;
    PoolFactory internal poolFactory;
    FeeRouter internal feeRouter;
    MapaePool internal pool;

    address internal creator = makeAddr("creator");
    address internal treasury = makeAddr("treasury");
    address internal fan = makeAddr("fan");
    address internal stranger = makeAddr("stranger");
    address internal burner = makeAddr("burner");

    IFeeRouter.UtilityTier internal constant TIER = IFeeRouter.UtilityTier.L1;

    function isBurner(address account) external view returns (bool) {
        return account == burner;
    }

    function setUp() public {
        vm.warp(1_750_000_000);
        krw = new MockKRW();
        dojang = new MockDojang();
        dojang.setVerified(fan, true);
        poolFactory = new PoolFactory();
        feeRouter = new FeeRouter(address(this), treasury);
        (token, pool) = _deploy(IDojang(address(dojang)));

        deal(address(krw), fan, 1_000_000e18);
        deal(address(krw), stranger, 1_000_000e18);
        deal(address(krw), burner, 1_000_000e18);
        vm.prank(fan);
        krw.approve(address(pool), type(uint256).max);
        vm.prank(stranger);
        krw.approve(address(pool), type(uint256).max);
        vm.prank(burner);
        krw.approve(address(pool), type(uint256).max);
    }

    function _deploy(IDojang d) internal returns (MembershipToken t, MapaePool p) {
        t = new MembershipToken("Creator Membership", "CRTM", address(this), 0, 0, new address[](0));
        address[] memory to = new address[](3);
        uint256[] memory amounts = new uint256[](3);
        (to[0], amounts[0]) = (address(this), 900e18);
        (to[1], amounts[1]) = (fan, 50e18);
        (to[2], amounts[2]) = (stranger, 50e18);
        t.mintAllocations(to, amounts);
        p = poolFactory.createPool(t, IERC20(address(krw)), creator, feeRouter, TIER, address(this), 60, 30, d);
        t.registerPool(address(p));
        t.transfer(address(p), 100e18);
        deal(address(krw), address(this), krw.balanceOf(address(this)) + 1_000_000e18);
        krw.transfer(address(p), 1_000_000e18);
        p.mint(p.DEAD());
    }

    // G1 unverified msg.sender cannot swap either way
    function testFuzz_G1_UnverifiedSenderReverts(address who, uint256 amount) public {
        vm.assume(!dojang.isVerified(who));
        amount = bound(amount, 1, 1e24);
        vm.startPrank(who);
        vm.expectRevert(abi.encodeWithSelector(MapaePool.NotVerified.selector, who));
        pool.swapQuoteForToken(amount, 0, who);
        vm.expectRevert(abi.encodeWithSelector(MapaePool.NotVerified.selector, who));
        pool.swapTokenForQuote(amount, 0, who);
        vm.stopPrank();
    }

    // G2 verified sender, unverified recipient
    function test_G2_UnverifiedRecipientReverts() public {
        vm.startPrank(fan);
        vm.expectRevert(abi.encodeWithSelector(MapaePool.NotVerified.selector, stranger));
        pool.swapQuoteForToken(10_000e18, 0, stranger);
        vm.expectRevert(abi.encodeWithSelector(MapaePool.NotVerified.selector, stranger));
        pool.swapTokenForQuote(1e18, 0, stranger);
        vm.stopPrank();
    }

    // G3 reverting Dojang lookup reverts the swap (fail-closed)
    function test_G3_DojangRevertFailsClosed() public {
        RevertingDojang bad = new RevertingDojang();
        poolFactory = new PoolFactory();
        (, MapaePool badPool) = _deploy(IDojang(address(bad)));
        vm.startPrank(fan);
        krw.approve(address(badPool), type(uint256).max);
        vm.expectRevert(bytes("dojang down"));
        badPool.swapQuoteForToken(10_000e18, 0, fan);
        vm.expectRevert(bytes("dojang down"));
        badPool.swapTokenForQuote(1e18, 0, fan);
        vm.stopPrank();
    }

    // G4 burn paths are ungated
    function test_G4_BurnPathsUngated() public {
        assertFalse(dojang.isVerified(burner));
        uint256 supplyBefore = token.totalSupply();
        vm.prank(burner);
        uint256 burned = pool.swapForBurn(10_000e18, 0);
        assertGt(burned, 0);
        assertEq(token.totalSupply(), supplyBefore - burned);

        // accrue a burn buffer through a verified swap, then convert it as an unverified caller
        vm.prank(fan);
        pool.swapQuoteForToken(100_000e18, 0, fan);
        assertGt(pool.burnBuffer(), 0);
        vm.prank(stranger);
        assertGt(pool.convertAndBurn(0), 0);
        assertEq(pool.burnBuffer(), 0);
    }

    // G5 verified wallet swaps both ways and receives exactly the pre-gate quote
    function test_G5_VerifiedSwapsMatchQuotes() public {
        vm.startPrank(fan);
        uint256 expectedOut = pool.getTokenOut(10_000e18);
        uint256 out = pool.swapQuoteForToken(10_000e18, 0, fan);
        assertEq(out, expectedOut);
        token.approve(address(pool), type(uint256).max);
        uint256 expectedQuote = pool.getQuoteOut(1e18);
        uint256 got = pool.swapTokenForQuote(1e18, 0, fan);
        assertEq(got, expectedQuote);
        vm.stopPrank();
    }

    // G6 no ungated pool can exist
    function test_G6_ZeroDojangReverts() public {
        vm.expectRevert(MapaePool.ZeroAddress.selector);
        new MapaePool(token, IERC20(address(krw)), creator, feeRouter, TIER, address(this), 60, 30, IDojang(address(0)));

        MembershipToken t2 = new MembershipToken("T2", "T2", address(this), 0, 0, new address[](0));
        vm.expectRevert(PoolFactory.ZeroDojang.selector);
        poolFactory.createPool(
            t2, IERC20(address(krw)), creator, feeRouter, TIER, address(this), 60, 30, IDojang(address(0))
        );
    }
}
