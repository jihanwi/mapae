// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// MAPAE v3 on-chain curve demo (mock stack from deployments/giwa-sepolia-v3.json). No time
// conditions (no vm.warp), so it broadcasts as-is on a live chain:
//
//   forge script script/DemoCurve.s.sol --account deployer --sender <deployer-addr> --rpc-url $GIWA_SEPOLIA_RPC_URL --broadcast --slow
//
// Scenario A (KRWs curve): dev opens a MockKRW curve with a dev first buy → 12 distinct real-name
//   wallets split the rest and graduate it → one swapQuoteForToken + one swapTokenForQuote on the
//   graduated pool → dev claimDevFees → sweepPlatformFees.
// Scenario B (ETH curve): one wallet opens a WETH curve with createCurveWithETH and self-graduates
//   it with buyWithETH (≈ 0.006 ETH + 1% fee at the testnet 0.002 ETH virtual quote).
// Every step is self-checked with require (graduated, pool totalFeeBps == 100, pool price ≥ curve
// close within 0.2%, treasury holds no issued token, dev fees > 0, 12 counted buyers in A).
//
// Demo wallets: derived from the publicly known TEST-ONLY demo mnemonic, exactly like
// DemoStage2aL0 / DemoStage2bL1 (env DEMO_MNEMONIC overrides; nothing is printed). Wallet indices
// start at DEMO_CURVE_BASE_IDX (default 20; A dev = base, A buyers = base+1..base+12, B wallet =
// base+13). The deployer (broadcast sender) tops up demo wallets with gas ETH (DEMO_GAS_TOPUP,
// default 0.0003 ether) and wallet B with its curve budget. Wallets self-verify on MockDojang and
// pull MockKRW from its faucet. Result: deployments/demo-curve-state.json.

import {Script, console} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CurveFactory} from "../src/CurveFactory.sol";
import {CurveSale} from "../src/CurveSale.sol";
import {CurvePresets} from "../src/CurvePresets.sol";
import {CurveMath} from "../src/lib/CurveMath.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {MapaePool} from "../src/MapaePool.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {MockDojang} from "../src/mocks/MockDojang.sol";

contract DemoCurve is Script {
    string internal constant DEFAULT_DEMO_MNEMONIC =
        "what attitude accuse zero typical indoor toddler riot topple reward media robot";
    uint256 internal constant BUYERS = 12;
    uint16 internal constant BPS = 10_000;

    struct Ctx {
        address operator; // broadcast sender: funds demo wallets with gas
        MockKRW krw;
        MockDojang dojang;
        CurveFactory curveFactory;
        FeeRouter feeRouter;
        uint32 baseIdx;
        uint256 gasTopUp;
    }

    struct Result {
        address curve;
        address token;
        address pool;
        uint256 graduationBlock;
        uint256 devFeesClaimed;
        uint256 platformFeesSwept;
        uint32 verifiedBuyers;
    }

    function run() external {
        string memory dep = vm.readFile("deployments/giwa-sepolia-v3.json");
        (, address operator,) = vm.readCallers();
        Ctx memory c = Ctx({
            operator: operator,
            krw: MockKRW(vm.parseJsonAddress(dep, "$.mockKRW")),
            dojang: MockDojang(vm.parseJsonAddress(dep, "$.mockDojang")),
            curveFactory: CurveFactory(payable(vm.parseJsonAddress(dep, "$.curveFactoryMock"))),
            feeRouter: FeeRouter(vm.parseJsonAddress(dep, "$.feeRouter")),
            baseIdx: uint32(vm.envOr("DEMO_CURVE_BASE_IDX", uint256(20))),
            gasTopUp: vm.envOr("DEMO_GAS_TOPUP", uint256(0.0003 ether))
        });
        Result memory a = scenarioA(c);
        Result memory b = scenarioB(c);
        _writeState(a, b);
    }

    // ---------------------------------------------------------------------
    // Scenario A — KRWs curve, 12 real-name buyers
    // ---------------------------------------------------------------------

    function scenarioA(Ctx memory c) public returns (Result memory res) {
        uint256 devKey = _key(c.baseIdx);
        uint256 vq = c.curveFactory.mapaeFactory().quoteConfig(address(c.krw)).curveVirtualQuote;
        CurveSale curve = _openKrwCurve(c, devKey, vq);
        _twelveBuyers(c, curve, vq);
        res = _checkGraduated(c, curve, vq);
        require(curve.verifiedBuyerCount() == BUYERS, "A: 12 VerifiedBuyerCounted");
        _poolSwaps(c, curve);
        (res.devFeesClaimed, res.platformFeesSwept) = _collectFees(c, curve, devKey);
        _checkNoTreasuryTokens(c, curve.token());
        res.verifiedBuyers = curve.verifiedBuyerCount();
        console.log("A curve / token / pool:", res.curve, res.token, res.pool);
    }

    /// @dev dev: self-verify, faucet, open with a dev first buy (≈ 1/13 of the sell-out budget).
    function _openKrwCurve(Ctx memory c, uint256 devKey, uint256 vq) internal returns (CurveSale curve) {
        address dev = vm.addr(devKey);
        _topUp(c, dev, 0);
        uint256 devBuy = _budget(vq, 0, 0, _curveFeeBps()) / 13;
        vm.startBroadcast(devKey);
        c.dojang.selfVerify();
        c.krw.faucet(devBuy);
        c.krw.approve(address(c.curveFactory), devBuy);
        (address ca,) = c.curveFactory.createCurve(IERC20(address(c.krw)), "MAPAE Demo Curve KRW", "DCK", devBuy, 1);
        vm.stopBroadcast();
        curve = CurveSale(ca);
        require(curve.token().balanceOf(dev) > 0 && curve.verifiedBuyerCount() == 0, "A: dev first buy");
    }

    /// @dev 12 distinct real-name buyers split the remaining budget; the last one closes the curve.
    function _twelveBuyers(Ctx memory c, CurveSale curve, uint256 vq) internal {
        for (uint256 i = 1; i <= BUYERS; ++i) {
            uint256 key = _key(c.baseIdx + uint32(i));
            _topUp(c, vm.addr(key), 0);
            uint256 remaining = _budget(vq, curve.r(), curve.s(), curve.totalFeeBps());
            uint256 amount = i == BUYERS ? remaining : remaining / (BUYERS + 1 - i);
            vm.startBroadcast(key);
            c.dojang.selfVerify();
            c.krw.faucet(amount);
            c.krw.approve(address(curve), amount);
            curve.buy(amount, 1);
            vm.stopBroadcast();
        }
    }

    /// @dev Graduated pool: one buy + one sell by buyer #1.
    function _poolSwaps(Ctx memory c, CurveSale curve) internal {
        MapaePool pool = curve.pool();
        uint256 key = _key(c.baseIdx + 1);
        address swapper = vm.addr(key);
        uint256 swapIn = pool.reserveQuote() / 200;
        vm.startBroadcast(key);
        c.krw.faucet(swapIn);
        c.krw.approve(address(pool), swapIn);
        uint256 bought = pool.swapQuoteForToken(swapIn, 0, swapper);
        curve.token().approve(address(pool), bought);
        uint256 sold = pool.swapTokenForQuote(bought / 2, 0, swapper);
        vm.stopBroadcast();
        require(bought > 0 && sold > 0, "A: pool swaps");
    }

    function _curveFeeBps() internal pure returns (uint256) {
        return uint256(CurvePresets.CURVE_FEE_PLATFORM_BPS) + CurvePresets.CURVE_FEE_DEV_BPS
            + CurvePresets.CURVE_FEE_LP_SEED_BPS;
    }

    // ---------------------------------------------------------------------
    // Scenario B — ETH curve, single-wallet self-graduation
    // ---------------------------------------------------------------------

    function scenarioB(Ctx memory c) public returns (Result memory res) {
        uint256 key = _key(c.baseIdx + uint32(BUYERS) + 1);
        address wallet = vm.addr(key);
        address weth = address(c.curveFactory.weth());
        uint256 vq = c.curveFactory.mapaeFactory().quoteConfig(weth).curveVirtualQuote;
        uint256 budget = _budget(vq, 0, 0, _curveFeeBps());
        _topUp(c, wallet, budget);

        vm.startBroadcast(key);
        c.dojang.selfVerify();
        (address ca, address ta) = c.curveFactory.createCurveWithETH("MAPAE Demo Curve ETH", "DCE", 0);
        CurveSale curve = CurveSale(ca);
        c.curveFactory.buyWithETH{value: budget}(curve, 1);
        vm.stopBroadcast();

        res = _checkGraduated(c, curve, vq);
        require(MembershipToken(ta).balanceOf(wallet) == CurvePresets.CURVE_SUPPLY, "B: self-graduation");
        (res.devFeesClaimed, res.platformFeesSwept) = _collectFees(c, curve, key);
        _checkNoTreasuryTokens(c, MembershipToken(ta));
        res.verifiedBuyers = curve.verifiedBuyerCount();
        console.log("B curve / token / pool:", ca, ta, res.pool);
    }

    // ---------------------------------------------------------------------
    // Shared steps / self-checks
    // ---------------------------------------------------------------------

    function _checkGraduated(Ctx memory, CurveSale curve, uint256 vq) internal view returns (Result memory res) {
        require(curve.graduated(), "graduated");
        MapaePool pool = curve.pool();
        require(pool.totalFeeBps() == 100, "pool totalFeeBps == 100");
        // pool spot (reserves) vs curve close (Vq + r)/(Vt − S): pool ≥ close, premium ≤ 0.2%
        uint256 closeNum = vq + curve.graduationReserve();
        uint256 closeDen = CurvePresets.VIRTUAL_TOKEN_RESERVE - CurvePresets.CURVE_SUPPLY;
        uint256 lhs = pool.reserveQuote() * closeDen;
        uint256 rhs = closeNum * pool.reserveToken();
        require(lhs >= rhs, "pool price >= curve close");
        require((lhs - rhs) * 1000 <= rhs * 2, "pool premium <= 0.2%");
        res.curve = address(curve);
        res.token = address(curve.token());
        res.pool = address(pool);
        res.graduationBlock = block.number; // simulation-time block, not the mined block
    }

    function _collectFees(Ctx memory c, CurveSale curve, uint256 devKey)
        internal
        returns (uint256 devFees, uint256 swept)
    {
        IERC20 q = curve.quote();
        address dev = vm.addr(devKey);
        address treasury = c.feeRouter.platformTreasury();
        uint256 devBefore = q.balanceOf(dev);
        uint256 treBefore = q.balanceOf(treasury);
        vm.startBroadcast(devKey);
        curve.claimDevFees();
        curve.sweepPlatformFees();
        vm.stopBroadcast();
        devFees = q.balanceOf(dev) - devBefore;
        swept = q.balanceOf(treasury) - treBefore;
        require(devFees > 0, "dev fees claimed > 0");
        require(swept > 0, "platform fees swept > 0");
    }

    function _checkNoTreasuryTokens(Ctx memory c, MembershipToken token) internal view {
        require(token.balanceOf(c.feeRouter.platformTreasury()) == 0, "treasury holds no issued token");
    }

    /// @dev Gross quote that sells out the curve from (r, s), fee-inclusive.
    function _budget(uint256 vq, uint256 r, uint256 s, uint256 feeBps) internal pure returns (uint256) {
        CurveMath.Params memory p = CurveMath.Params({
            vQuote: vq, vToken: CurvePresets.VIRTUAL_TOKEN_RESERVE, saleSupply: CurvePresets.CURVE_SUPPLY
        });
        uint256 cost = CurveMath.costToSellOut(p, r, s);
        return Math.mulDiv(cost, BPS, BPS - feeBps, Math.Rounding.Ceil) + 1;
    }

    /// @dev Operator sends gas (+ `extra`) to a demo wallet when it is short.
    function _topUp(Ctx memory c, address wallet, uint256 extra) internal {
        uint256 want = c.gasTopUp + extra;
        if (wallet.balance >= want) return;
        vm.startBroadcast(c.operator);
        (bool ok,) = payable(wallet).call{value: want - wallet.balance}("");
        require(ok, "gas top-up failed");
        vm.stopBroadcast();
    }

    function _key(uint32 idx) internal view returns (uint256) {
        return vm.deriveKey(vm.envOr("DEMO_MNEMONIC", string(DEFAULT_DEMO_MNEMONIC)), idx);
    }

    function _writeState(Result memory a, Result memory b) internal {
        string memory j = "demoCurve";
        vm.serializeAddress(j, "curveA", a.curve);
        vm.serializeAddress(j, "tokenA", a.token);
        vm.serializeAddress(j, "poolA", a.pool);
        vm.serializeUint(j, "graduationBlockA", a.graduationBlock);
        vm.serializeUint(j, "verifiedBuyersA", a.verifiedBuyers);
        vm.serializeAddress(j, "curveB", b.curve);
        vm.serializeAddress(j, "tokenB", b.token);
        vm.serializeAddress(j, "poolB", b.pool);
        string memory out = vm.serializeUint(j, "graduationBlockB", b.graduationBlock);
        vm.writeJson(out, "deployments/demo-curve-state.json");
    }
}
