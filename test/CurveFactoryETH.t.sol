// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IDojang} from "../src/interfaces/IDojang.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {CurveFactory} from "../src/CurveFactory.sol";
import {CurveSale} from "../src/CurveSale.sol";
import {CurvePresets as P} from "../src/CurvePresets.sol";
import {CurveMath} from "../src/lib/CurveMath.sol";
import {MembershipToken} from "../src/MembershipToken.sol";
import {MapaeFactoryTestBase} from "./MapaeFactory.t.sol";

/// @dev WETH9-style wrapper for tests (deposit / withdraw / ERC20, 18 decimals).
contract TestWETH9 is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "WETH: ETH transfer failed");
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}

/// @dev Contract buyer that re-enters the factory when it receives the ETH refund.
contract ReentrantBuyer {
    CurveFactory internal immutable cf;
    CurveSale internal curve;
    uint8 public mode; // 1 = re-enter buyWithETH, 2 = re-enter createCurveWithETH

    constructor(CurveFactory cf_) {
        cf = cf_;
    }

    function attack(CurveSale c, uint8 m) external payable {
        curve = c;
        mode = m;
        cf.buyWithETH{value: msg.value}(c, 0);
    }

    receive() external payable {
        if (mode == 1) cf.buyWithETH{value: msg.value}(curve, 0);
        else if (mode == 2) cf.createCurveWithETH{value: msg.value}("R", "R", 0);
    }
}

/// @dev Contract buyer that refuses ETH refunds.
contract RefundRejecter {
    function buy(CurveFactory cf, CurveSale c) external payable {
        cf.buyWithETH{value: msg.value}(c, 0);
    }

    receive() external payable {
        revert("no ETH");
    }
}

/// @notice Native-ETH entry points on CurveFactory (MAPAE v3 / Phase 1 / T9), W1..W10.
contract CurveFactoryETHTest is MapaeFactoryTestBase {
    uint16 internal constant BPS = 10_000;
    bytes32 internal constant BUY_SIG =
        keccak256("Buy(address,bool,bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256)");

    TestWETH9 internal weth;
    CurveFactory internal cf;
    CurveSale internal curve; // WETH-quoted
    MembershipToken internal token;
    address internal dev = makeAddr("dev");
    address internal buyer = makeAddr("buyer");
    address internal stranger = makeAddr("stranger");

    function setUp() public override {
        super.setUp();
        weth = new TestWETH9();
        factory.allowQuote(IERC20(address(weth)), P.VIRTUAL_QUOTE_RESERVE_WETH);
        factory.allowQuote(IERC20(address(krw)), P.krwsVirtualQuote(krw.decimals()));
        cf = new CurveFactory(
            IDojang(address(dojang)), feeRouter, poolFactory, factory, IWETH(address(weth)), address(this)
        );
        dojang.setVerified(dev, true);
        dojang.setVerified(buyer, true);
        vm.prank(dev);
        (address ca, address ta) = cf.createCurveWithETH("Eth Curve", "ETHC", 0);
        curve = CurveSale(ca);
        token = MembershipToken(ta);
        vm.deal(buyer, 100 ether);
        vm.deal(dev, 100 ether);
    }

    function _sellOutBudget(CurveSale c) internal view returns (uint256) {
        CurveMath.Params memory p =
            CurveMath.Params({vQuote: c.virtualQuote(), vToken: P.VIRTUAL_TOKEN_RESERVE, saleSupply: P.CURVE_SUPPLY});
        uint256 cost = CurveMath.costToSellOut(p, c.r(), c.s());
        return Math.mulDiv(cost, BPS, BPS - c.totalFeeBps(), Math.Rounding.Ceil) + 1;
    }

    function _assertFactoryClean(address c) internal view {
        assertEq(address(cf).balance, 0, "factory ETH");
        assertEq(weth.balanceOf(address(cf)), 0, "factory WETH");
        assertEq(weth.allowance(address(cf), c), 0, "factory allowance");
    }

    // W1 regular buy
    function test_W1_BuyWithETH() public {
        uint256 before = buyer.balance;
        vm.recordLogs();
        vm.prank(buyer);
        uint256 g = gasleft();
        (uint256 out, uint256 spent) = cf.buyWithETH{value: 0.1 ether}(curve, 1);
        emit log_named_uint("gas buyWithETH (regular)", g - gasleft());
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(before - buyer.balance, spent, "ETH spent");
        assertLe(spent, 0.1 ether);
        assertGt(out, 0);
        assertEq(token.balanceOf(buyer), out);
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(curve) && logs[i].topics[0] == BUY_SIG) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), buyer, "Buy.trader");
                found = true;
            }
        }
        assertTrue(found);
        assertEq(curve.verifiedBuyerCount(), 1);
        _assertFactoryClean(address(curve));
    }

    // W2 closing buy refunds the excess in ETH and graduates in the same tx
    function test_W2_ClosingBuyRefundsAndGraduates() public {
        uint256 budget = _sellOutBudget(curve);
        uint256 sent = budget + 5 ether;
        uint256 before = buyer.balance;
        vm.prank(buyer);
        uint256 g = gasleft();
        (uint256 out, uint256 spent) = cf.buyWithETH{value: sent}(curve, 0);
        emit log_named_uint("gas buyWithETH (closing)", g - gasleft());
        assertTrue(curve.graduated());
        assertEq(out, P.CURVE_SUPPLY);
        assertLe(spent, budget);
        assertEq(before - buyer.balance, spent, "excess refunded in ETH");
        _assertFactoryClean(address(curve));
    }

    // W3 unverified buyer: whole tx reverts, ETH stays with the caller
    function test_W3_UnverifiedReverts() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CurveSale.NotVerified.selector, stranger));
        cf.buyWithETH{value: 1 ether}(curve, 0);
        assertEq(stranger.balance, 1 ether);
        _assertFactoryClean(address(curve));
    }

    // W4 non-WETH curve and unknown address revert
    function test_W4_WrongCurveReverts() public {
        vm.prank(dev);
        (address krwCurve,) = cf.createCurve(IERC20(address(krw)), "Krw Curve", "KC", 0, 0);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.NotWethCurve.selector, krwCurve));
        cf.buyWithETH{value: 1 ether}(CurveSale(krwCurve), 0);

        address fake = makeAddr("fake");
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.NotCurve.selector, fake));
        cf.buyWithETH{value: 1 ether}(CurveSale(fake), 0);
    }

    // W5 zero value
    function test_W5_ZeroValueReverts() public {
        vm.prank(buyer);
        vm.expectRevert(CurveFactory.ZeroValue.selector);
        cf.buyWithETH{value: 0}(curve, 0);
    }

    // W6 re-entry on refund reverts the whole tx
    function test_W6_ReentrancyOnRefundReverts() public {
        ReentrantBuyer rb = new ReentrantBuyer(cf);
        dojang.setVerified(address(rb), true);
        vm.deal(address(this), 10 ether);
        uint256 sent = _sellOutBudget(curve) + 1 ether; // closing buy → refund → receive re-enters

        vm.expectRevert(CurveFactory.EthRefundFailed.selector);
        rb.attack{value: sent}(curve, 1);
        vm.expectRevert(CurveFactory.EthRefundFailed.selector);
        rb.attack{value: sent}(curve, 2);
        assertFalse(curve.graduated());
        _assertFactoryClean(address(curve));
    }

    // W7 refund-refusing contract buyer reverts the whole tx
    function test_W7_RefundRejectedReverts() public {
        RefundRejecter rj = new RefundRejecter();
        dojang.setVerified(address(rj), true);
        vm.deal(address(this), 10 ether);
        uint256 sent = _sellOutBudget(curve) + 1 ether;
        vm.expectRevert(CurveFactory.EthRefundFailed.selector);
        rj.buy{value: sent}(cf, curve);
        assertEq(curve.s(), 0);
        _assertFactoryClean(address(curve));
    }

    // W8 createCurveWithETH
    function test_W8_CreateWithETH() public {
        // without first buy
        vm.prank(buyer);
        (address c0, address t0) = cf.createCurveWithETH("No Buy", "NB", 0);
        assertEq(address(CurveSale(c0).quote()), address(weth));
        assertEq(CurveSale(c0).s(), 0);
        assertEq(MembershipToken(t0).balanceOf(buyer), 0);

        // with first buy
        uint256 before = buyer.balance;
        vm.prank(buyer);
        (address c1, address t1) = cf.createCurveWithETH{value: 0.2 ether}("With Buy", "WB", 1);
        uint256 spent = before - buyer.balance;
        assertGt(MembershipToken(t1).balanceOf(buyer), 0);
        assertLe(spent, 0.2 ether);
        assertEq(CurveSale(c1).verifiedBuyerCount(), 0, "dev first buy not counted");
        assertFalse(CurveSale(c1).countedVerifiedBuyer(buyer), "dev never counted");
        _assertFactoryClean(c1);

        // sells out inside the create tx; excess refunded
        uint256 cost = Math.mulDiv(
            P.VIRTUAL_QUOTE_RESERVE_WETH, P.CURVE_SUPPLY, P.VIRTUAL_TOKEN_RESERVE - P.CURVE_SUPPLY, Math.Rounding.Ceil
        );
        before = dev.balance;
        vm.prank(dev);
        (address c2, address t2) = cf.createCurveWithETH{value: cost * 2}("Grad", "GR", 0);
        assertTrue(CurveSale(c2).graduated());
        assertEq(MembershipToken(t2).balanceOf(dev), P.CURVE_SUPPLY);
        assertLt(before - dev.balance, cost * 2, "excess refunded");
        _assertFactoryClean(c2);
    }

    function test_W8_RateLimitSharedWithCreateCurve() public {
        address d = makeAddr("rl");
        dojang.setVerified(d, true);
        uint256 t0 = block.timestamp;
        vm.startPrank(d);
        cf.createCurve(IERC20(address(weth)), "A", "A", 0, 0);
        cf.createCurveWithETH("B", "B", 0);
        cf.createCurve(IERC20(address(krw)), "C", "C", 0, 0);
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.CurveRateLimited.selector, t0 + 7 days));
        cf.createCurveWithETH("D", "D", 0);
        vm.expectRevert(abi.encodeWithSelector(CurveFactory.CurveRateLimited.selector, t0 + 7 days));
        cf.createCurve(IERC20(address(weth)), "D", "D", 0, 0);
        vm.stopPrank();
    }

    // W9 direct ETH transfers are rejected
    function test_W9_DirectEthRejected() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok, bytes memory ret) = address(cf).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(bytes4(ret), CurveFactory.DirectEthRejected.selector);
        assertEq(address(cf).balance, 0);
    }

    // W10 factory balances stay zero for any buy size
    function testFuzz_W10_FactoryAlwaysClean(uint256 amount) public {
        amount = bound(amount, 1, _sellOutBudget(curve) * 3);
        vm.deal(buyer, amount);
        uint256 before = buyer.balance;
        vm.prank(buyer);
        try cf.buyWithETH{value: amount}(curve, 0) returns (uint256, uint256 spent) {
            assertEq(before - buyer.balance, spent);
        } catch {
            assertEq(buyer.balance, before); // e.g. dust buy with zero tokens out
        }
        _assertFactoryClean(address(curve));
    }
}
