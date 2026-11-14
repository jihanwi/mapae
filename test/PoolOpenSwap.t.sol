// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {IBurnerRegistry} from "../src/interfaces/IBurnerRegistry.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";

/// @notice v3.1: MapaePool swaps are open to any wallet (no Dojang gate, all tiers), O1..O4.
///         The test contract plays the offering (minter/registrar/seeder) and the burner registry.
contract PoolOpenSwapTest is Test, IBurnerRegistry {
    MockKRW internal krw;
    MembershipToken internal token;
    PoolFactory internal poolFactory;
    FeeRouter internal feeRouter;
    MapaePool internal pool;

    address internal creator = makeAddr("creator");
    address internal treasury = makeAddr("treasury");
    address internal anyone = makeAddr("anyone");
    address internal recipient = makeAddr("recipient");
    address internal burner = makeAddr("burner");

    IFeeRouter.UtilityTier internal constant TIER = IFeeRouter.UtilityTier.L1;

    function isBurner(address account) external view returns (bool) {
        return account == burner;
    }

    function setUp() public {
        vm.warp(1_750_000_000);
        krw = new MockKRW();
        poolFactory = new PoolFactory();
        feeRouter = new FeeRouter(address(this), treasury);
        token = new MembershipToken("Creator Membership", "CRTM", address(this), 0, 0, new address[](0));
        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        (to[0], amounts[0]) = (address(this), 900e18);
        (to[1], amounts[1]) = (anyone, 100e18);
        token.mintAllocations(to, amounts);
        pool = poolFactory.createPool(token, IERC20(address(krw)), creator, feeRouter, TIER, address(this), 60, 30);
        token.registerPool(address(pool));
        token.transfer(address(pool), 100e18);
        deal(address(krw), address(this), 1_000_000e18);
        krw.transfer(address(pool), 1_000_000e18);
        pool.mint(pool.DEAD());

        deal(address(krw), anyone, 1_000_000e18);
        deal(address(krw), burner, 1_000_000e18);
        vm.startPrank(anyone);
        krw.approve(address(pool), type(uint256).max);
        token.approve(address(pool), type(uint256).max);
        vm.stopPrank();
        vm.prank(burner);
        krw.approve(address(pool), type(uint256).max);
    }

    // O1 any wallet swaps both ways and receives exactly the quoted amounts
    function testFuzz_O1_AnyWalletSwapsBothWays(uint256 quoteIn, uint256 tokenIn) public {
        quoteIn = bound(quoteIn, 1e18, 100_000e18);
        tokenIn = bound(tokenIn, 1e15, 10e18);
        vm.startPrank(anyone);
        uint256 expectedOut = pool.getTokenOut(quoteIn);
        assertEq(pool.swapQuoteForToken(quoteIn, 0, anyone), expectedOut);
        uint256 expectedQuote = pool.getQuoteOut(tokenIn);
        assertEq(pool.swapTokenForQuote(tokenIn, 0, anyone), expectedQuote);
        vm.stopPrank();
    }

    // O2 a different recipient is allowed in both directions
    function test_O2_OtherRecipient() public {
        vm.startPrank(anyone);
        uint256 out = pool.swapQuoteForToken(10_000e18, 0, recipient);
        uint256 got = pool.swapTokenForQuote(1e18, 0, recipient);
        vm.stopPrank();
        assertEq(token.balanceOf(recipient), out);
        assertEq(krw.balanceOf(recipient), got);
    }

    // O3 burn paths keep their own rules (swapForBurn: registered burners only)
    function test_O3_BurnPathsUnchanged() public {
        vm.prank(anyone);
        vm.expectRevert(abi.encodeWithSelector(MapaePool.NotBurner.selector, anyone));
        pool.swapForBurn(10_000e18, 0);

        uint256 supplyBefore = token.totalSupply();
        vm.prank(burner);
        uint256 burned = pool.swapForBurn(10_000e18, 0);
        assertGt(burned, 0);
        assertEq(token.totalSupply(), supplyBefore - burned);

        vm.prank(anyone);
        pool.swapQuoteForToken(100_000e18, 0, anyone);
        assertGt(pool.burnBuffer(), 0);
        vm.prank(recipient);
        assertGt(pool.convertAndBurn(0), 0);
        assertEq(pool.burnBuffer(), 0);
    }

    // O4 slippage protection still applies
    function test_O4_MinOutStillEnforced() public {
        uint256 expectedOut = pool.getTokenOut(10_000e18);
        vm.prank(anyone);
        vm.expectRevert(abi.encodeWithSelector(MapaePool.InsufficientOutput.selector, expectedOut, expectedOut + 1));
        pool.swapQuoteForToken(10_000e18, expectedOut + 1, anyone);
    }
}
