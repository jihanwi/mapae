// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {PoolFactory} from "../src/PoolFactory.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {IFeeRouter} from "../src/interfaces/IFeeRouter.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";

/// @notice Pool unit tests. The test contract plays the offering: sole minter,
///         pool registrar, and liquidity seeder.
/// @dev v5.2: swap fee is a directional 4-way split (R1/R2). platform+lp come
///      from the FeeRouter (L1: 40/20); royalty+burn are per-pool (here 60/30).
///      Buy: all four off the KRWs input. Sell: burn+lp off the token input,
///      platform+royalty off the KRWs output (so royalty/treasury are KRWs).
contract MapaePoolTest is Test {
    MockKRW internal krw;
    MockDojang internal dojang;
    MembershipToken internal token;
    PoolFactory internal poolFactory;
    FeeRouter internal feeRouter;
    MapaePool internal pool;

    address internal creator = makeAddr("creator");
    address internal treasury = makeAddr("treasury");
    address internal fan = makeAddr("fan");
    address internal lp2 = makeAddr("lp2");

    IFeeRouter.UtilityTier internal constant TIER = IFeeRouter.UtilityTier.L1;
    uint16 internal constant PLATFORM_BPS = 40;
    uint16 internal constant ROYALTY_BPS = 60;
    uint16 internal constant BURN_BPS = 30;
    uint16 internal constant LP_BPS = 20;
    uint256 internal constant SEED_TOKEN = 100e18;
    uint256 internal constant SEED_KRW = 1_000_000e18; // spot = 10,000 KRWs/token

    function setUp() public {
        vm.warp(1_750_000_000);
        krw = new MockKRW();
        dojang = new MockDojang();
        dojang.setVerified(fan, true);
        dojang.setVerified(lp2, true);
        dojang.setVerified(address(this), true);
        poolFactory = new PoolFactory();
        feeRouter = new FeeRouter(address(this), treasury);
        token = new MembershipToken("Creator Membership", "CRTM", address(this), 0, 0, new address[](0));

        // Mint supply (test = offering): pool seed + fan + this
        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        to[0] = address(this);
        amounts[0] = 900e18;
        to[1] = fan;
        amounts[1] = 100e18;
        token.mintAllocations(to, amounts);

        // factory == address(0): swapForBurn is disabled here (covered by the
        // swapForBurn invariant suite); convertAndBurn stays permissionless.
        pool = poolFactory.createPool(
            token,
            IERC20(address(krw)),
            creator,
            feeRouter,
            TIER,
            address(0),
            ROYALTY_BPS,
            BURN_BPS,
            IDojang(address(dojang))
        );
        token.registerPool(address(pool));

        // Seed at par and lock LP at dEaD (as settle does)
        token.transfer(address(pool), SEED_TOKEN);
        krw.faucet(SEED_KRW);
        krw.transfer(address(pool), SEED_KRW);
        pool.mint(pool.DEAD());
    }

    function _k() internal view returns (uint256) {
        return pool.reserveToken() * pool.reserveQuote();
    }

    // ------------------------------------------------------------------
    // Factory + seeding
    // ------------------------------------------------------------------

    function test_Seeding() public view {
        assertEq(pool.reserveToken(), SEED_TOKEN);
        assertEq(pool.reserveQuote(), SEED_KRW);
        assertEq(pool.spotPrice(), 10_000e18);
        // LP permanently at dEaD (불변식 7)
        assertEq(pool.balanceOf(pool.DEAD()), pool.totalSupply());
        assertGt(pool.totalSupply(), 0);
        assertEq(pool.totalFeeBps(), PLATFORM_BPS + ROYALTY_BPS + BURN_BPS + LP_BPS);
    }

    function test_Factory_OnePoolPerToken() public {
        vm.expectRevert(abi.encodeWithSelector(PoolFactory.PoolExists.selector, address(token), address(pool)));
        poolFactory.createPool(
            token,
            IERC20(address(krw)),
            creator,
            feeRouter,
            TIER,
            address(0),
            ROYALTY_BPS,
            BURN_BPS,
            IDojang(address(dojang))
        );
    }

    function test_Factory_OnlyTokenOffering() public {
        MembershipToken other = new MembershipToken("Other", "OTH", makeAddr("otherOffering"), 0, 0, new address[](0));
        vm.expectRevert(
            abi.encodeWithSelector(PoolFactory.NotTokenOffering.selector, address(this), makeAddr("otherOffering"))
        );
        poolFactory.createPool(
            other,
            IERC20(address(krw)),
            creator,
            feeRouter,
            TIER,
            address(0),
            ROYALTY_BPS,
            BURN_BPS,
            IDojang(address(dojang))
        );
    }

    function test_RegisterPool_OnlyOfferingAndOnce() public {
        vm.prank(fan);
        vm.expectRevert(MembershipToken.NotOffering.selector);
        token.registerPool(fan);
        vm.expectRevert(MembershipToken.PoolAlreadyRegistered.selector);
        token.registerPool(address(pool));
    }

    // ------------------------------------------------------------------
    // Swaps + tiered split fee
    // ------------------------------------------------------------------

    function test_SwapKrwForToken_FeeSplit() public {
        uint256 amountIn = 10_000e18;
        uint256 kBefore = _k();
        uint256 creatorBefore = krw.balanceOf(creator);

        vm.startPrank(fan);
        krw.faucet(amountIn);
        krw.approve(address(pool), amountIn);
        uint256 out = pool.swapQuoteForToken(amountIn, 0, fan);
        vm.stopPrank();

        // royalty in KRWs straight to creator
        assertEq(krw.balanceOf(creator) - creatorBefore, amountIn * ROYALTY_BPS / 10_000);
        // platform cut in KRWs straight to treasury (NEW)
        assertEq(krw.balanceOf(treasury), amountIn * PLATFORM_BPS / 10_000);
        // burn share accrues in the buffer (KRWs input side)
        assertEq(pool.burnBuffer(), amountIn * BURN_BPS / 10_000);
        // LP fee retained → k grows
        assertGt(_k(), kBefore);
        assertGt(out, 0.9e18);
        assertEq(token.balanceOf(fan), 100e18 + out);
        // solvency: pool balances match reserves (+buffer)
        assertEq(krw.balanceOf(address(pool)), pool.reserveQuote() + pool.burnBuffer());
        assertEq(token.balanceOf(address(pool)), pool.reserveToken());
    }

    function test_SwapTokenForKrw_FeeSplitAndImmediateBurn() public {
        uint256 amountIn = 10e18;
        uint256 kBefore = _k();
        uint256 supplyBefore = token.totalSupply();
        uint256 reserveQuoteBefore = pool.reserveQuote();
        uint256 bufBefore = pool.burnBuffer();

        vm.startPrank(fan);
        token.approve(address(pool), amountIn);
        uint256 out = pool.swapTokenForQuote(amountIn, 0, fan);
        vm.stopPrank();

        uint256 platformKrw = krw.balanceOf(treasury);
        uint256 royaltyKrw = krw.balanceOf(creator);
        // R1: platform + royalty paid in KRWs from the OUTPUT — no tokens leak to
        // treasury/creator (invariant 17). gross KRWs out = user out + both cuts.
        uint256 grossOut = reserveQuoteBefore - pool.reserveQuote();
        assertEq(platformKrw, grossOut * PLATFORM_BPS / 10_000);
        assertEq(royaltyKrw, grossOut * ROYALTY_BPS / 10_000);
        assertEq(out, grossOut - platformKrw - royaltyKrw);
        assertEq(token.balanceOf(creator), 0);
        assertEq(token.balanceOf(treasury), 0);
        // burn share burned immediately from the token INPUT (only this cuts supply)
        assertEq(supplyBefore - token.totalSupply(), amountIn * BURN_BPS / 10_000);
        assertGt(_k(), kBefore); // lp fee retained → k grows
        assertGt(out, 0);
        assertEq(krw.balanceOf(fan), out);
        assertEq(pool.burnBuffer(), bufBefore); // sell doesn't touch the KRWs buffer
        assertEq(krw.balanceOf(address(pool)), pool.reserveQuote() + pool.burnBuffer());
        assertEq(token.balanceOf(address(pool)), pool.reserveToken());
    }

    function test_Swap_SlippageGuard() public {
        vm.startPrank(fan);
        krw.faucet(10_000e18);
        krw.approve(address(pool), 10_000e18);
        uint256 quote = pool.getTokenOut(10_000e18);
        vm.expectRevert(abi.encodeWithSelector(MapaePool.InsufficientOutput.selector, quote, quote + 1));
        pool.swapQuoteForToken(10_000e18, quote + 1, fan);
        vm.stopPrank();
    }

    /// D9: during the transfer lock, fans can BUY (pool is lock-exempt sender)
    /// but cannot SELL (fan is a locked sender).
    function test_LockedToken_BuyAllowedSellBlocked() public {
        MembershipToken locked = new MembershipToken("Locked", "LCK", address(this), 30 days, 0, new address[](0));
        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        to[0] = address(this);
        amounts[0] = 900e18;
        to[1] = fan;
        amounts[1] = 100e18;
        locked.mintAllocations(to, amounts);
        MapaePool lockedPool = poolFactory.createPool(
            locked,
            IERC20(address(krw)),
            creator,
            feeRouter,
            TIER,
            address(0),
            ROYALTY_BPS,
            BURN_BPS,
            IDojang(address(dojang))
        );
        locked.registerPool(address(lockedPool));
        locked.transfer(address(lockedPool), SEED_TOKEN); // this == offering: lock-exempt
        krw.faucet(SEED_KRW);
        krw.transfer(address(lockedPool), SEED_KRW);
        lockedPool.mint(lockedPool.DEAD());

        vm.startPrank(fan);
        krw.faucet(10_000e18);
        krw.approve(address(lockedPool), 10_000e18);
        uint256 out = lockedPool.swapQuoteForToken(10_000e18, 0, fan); // buy works during lock
        assertGt(out, 0);

        locked.approve(address(lockedPool), 1e18);
        vm.expectRevert(abi.encodeWithSelector(MembershipToken.TransferLocked.selector, block.timestamp + 30 days));
        lockedPool.swapTokenForQuote(1e18, 0, fan); // sell blocked during lock
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // convertAndBurn (mini buyback)
    // ------------------------------------------------------------------

    function test_ConvertAndBurn() public {
        // accrue a buffer via a KRWs-in swap
        vm.startPrank(fan);
        krw.faucet(100_000e18);
        krw.approve(address(pool), 100_000e18);
        pool.swapQuoteForToken(100_000e18, 0, fan);
        vm.stopPrank();
        uint256 buffer = pool.burnBuffer();
        assertEq(buffer, uint256(100_000e18) * BURN_BPS / 10_000); // burn share of 100k

        uint256 supplyBefore = token.totalSupply();
        uint256 kBefore = _k();
        uint256 burned = pool.convertAndBurn(0); // anyone may call
        assertGt(burned, 0);
        assertEq(pool.burnBuffer(), 0);
        assertEq(supplyBefore - token.totalSupply(), burned);
        assertGt(_k(), kBefore); // buyback adds KRWs to reserves → k grows
        assertEq(krw.balanceOf(address(pool)), pool.reserveQuote()); // buffer fully absorbed

        vm.expectRevert(MapaePool.EmptyBurnBuffer.selector);
        pool.convertAndBurn(0);
    }

    // ------------------------------------------------------------------
    // Secondary liquidity
    // ------------------------------------------------------------------

    function test_SecondaryLp_AddAndRemove() public {
        uint256 addToken = pool.reserveToken() / 10;
        uint256 addKrw = pool.reserveQuote() / 10;
        token.transfer(lp2, addToken);
        vm.startPrank(lp2);
        krw.faucet(addKrw);
        token.transfer(address(pool), addToken);
        krw.transfer(address(pool), addKrw);
        uint256 liquidity = pool.mint(lp2);
        assertGt(liquidity, 0);

        pool.transfer(address(pool), liquidity);
        (uint256 outToken, uint256 outKrw) = pool.burn(lp2);
        vm.stopPrank();
        assertApproxEqRel(outToken, addToken, 1e12);
        assertApproxEqRel(outKrw, addKrw, 1e12);
    }

    // ------------------------------------------------------------------
    // Fuzz: k never decreases across arbitrary swap sequences
    // ------------------------------------------------------------------

    function testFuzz_KMonotoneUnderSwaps(uint256 a1, uint256 a2, uint256 a3, bool startKrw) public {
        a1 = bound(a1, 1e18, 500_000e18);
        a2 = bound(a2, 0.01e18, 50e18);
        a3 = bound(a3, 1e18, 500_000e18);

        uint256 kBefore = _k();
        vm.startPrank(fan);
        krw.faucet(a1 + a3);
        krw.approve(address(pool), type(uint256).max);
        token.approve(address(pool), type(uint256).max);

        if (startKrw) pool.swapQuoteForToken(a1, 0, fan);
        else pool.swapTokenForQuote(a2, 0, fan);
        assertGe(_k(), kBefore);

        kBefore = _k();
        uint256 sellable = token.balanceOf(fan);
        pool.swapTokenForQuote(bound(a2, 0.01e18, sellable), 0, fan);
        assertGe(_k(), kBefore);

        kBefore = _k();
        pool.swapQuoteForToken(a3, 0, fan);
        assertGe(_k(), kBefore);
        vm.stopPrank();

        if (pool.burnBuffer() > 0) {
            kBefore = _k();
            pool.convertAndBurn(0);
            assertGe(_k(), kBefore);
        }
        // solvency after everything
        assertEq(krw.balanceOf(address(pool)), pool.reserveQuote() + pool.burnBuffer());
        assertEq(token.balanceOf(address(pool)), pool.reserveToken());
    }
}
