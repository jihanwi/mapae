import {describe, expect, it} from "vitest";
import {devFirstBuyCap, exceedsDevFirstBuyCap} from "./devFirstBuy";
import {ADDR_V3} from "../contracts/addressesV3";
import {ko} from "../copy/ko";
import {en} from "../copy/en";
import {CURVE_SUPPLY, quoteBuyWithFees, VIRTUAL_TOKEN_RESERVE} from "./curveMath";

const E18 = 10n ** 18n;
const MAX = devFirstBuyCap(200); // v3.5 factory: priorityMaxHoldingBps 200

describe("exceedsDevFirstBuyCap (v3.5, the 2% holding cap)", () => {
    it("the cap comes from the factory bps and matches the deployment record", () => {
        expect(MAX).toBe(20_000_000n * E18);
        expect(ADDR_V3.priorityMaxHoldingTokens).toBe(MAX);
        expect(devFirstBuyCap(50)).toBe(5_000_000n * E18);
        expect(devFirstBuyCap(500)).toBe(50_000_000n * E18);
    });
    it("the cap itself is allowed, 1 wei more is not", () => {
        expect(exceedsDevFirstBuyCap(MAX, MAX)).toBe(false);
        expect(exceedsDevFirstBuyCap(MAX + 1n, MAX)).toBe(true);
        expect(exceedsDevFirstBuyCap(0n, MAX)).toBe(false);
        expect(exceedsDevFirstBuyCap(CURVE_SUPPLY, MAX)).toBe(true);
    });
    it("the boundary amounts match the contract tests (KRWs about 38,602.586, testnet ETH about 0.0000386)", () => {
        const fee = 100n; // 1.00%
        // KRWs 2M virtual quote: 38,602.586373287010229684 is the largest that passes (CurveFactory.t.sol)
        const vqK = 2_000_000n * E18;
        expect(exceedsDevFirstBuyCap(quoteBuyWithFees(vqK, 0n, 0n, 38_602_586_373_287_010_229_684n, fee).tokensOut, MAX)).toBe(false);
        expect(exceedsDevFirstBuyCap(quoteBuyWithFees(vqK, 0n, 0n, 38_602_586_373_287_010_229_685n, fee).tokensOut, MAX)).toBe(true);
        // testnet ETH 0.002: 0.0000386 passes, the old default 0.00005 does not
        const vqE = 2n * 10n ** 15n;
        expect(exceedsDevFirstBuyCap(quoteBuyWithFees(vqE, 0n, 0n, 386n * 10n ** 11n, fee).tokensOut, MAX)).toBe(false);
        expect(exceedsDevFirstBuyCap(quoteBuyWithFees(vqE, 0n, 0n, 5n * 10n ** 13n, fee).tokensOut, MAX)).toBe(true);
        expect(VIRTUAL_TOKEN_RESERVE).toBeGreaterThan(MAX);
    });
    it("the revert reason maps to the same sentence as the on-screen notice (2%, 20M)", () => {
        expect(ko.errors.DevFirstBuyTooLarge).toBe(ko.create.devBuyCap(MAX));
        expect(en.errors.DevFirstBuyTooLarge).toBe(en.create.devBuyCap(MAX));
        expect(ko.create.devBuyCap(MAX)).toBe("발행과 함께 살 수 있는 양은 총공급의 2%(2,000만 개)까지예요. 첫 10분 동안은 누구나 같은 한도예요");
        expect(en.create.devBuyCap(MAX)).toBe("You can buy up to 2% of supply (20M tokens) with the launch. Everyone has the same limit for the first 10 minutes.");
        expect(ko.create.devBuyNote(MAX)).toBe("발행과 동시에 매수하는 물량이에요. 총공급의 2%까지 살 수 있고, 미리 배정받는 물량은 없어요");
        expect(en.create.devBuyNote(MAX)).toBe("Bought in the same transaction as the launch. Up to 2% of supply, and nothing is allocated in advance.");
    });
});
