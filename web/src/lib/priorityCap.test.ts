import {describe, expect, it} from "vitest";
import {capLeft, exceedsCap, maxQuoteForCap} from "./priorityCap";
import {CURVE_SUPPLY, quoteBuyWithFees} from "./curveMath";
import {ko} from "../copy/ko";
import {en} from "../copy/en";
import {ContractFunctionRevertedError, encodeErrorResult} from "viem";
import {CurveSaleAbi} from "../contracts/abisV3";
import {humanError} from "./errors";

const E18 = 10n ** 18n;
const CAP = 20_000_000n * E18;
const FEE = 100n;
const VQ_K = 2_000_000n * E18; // KRWs preset
const VQ_E = 2n * 10n ** 15n; // testnet ETH preset

describe("priority holding cap (W-T54)", () => {
    it("capLeft and exceedsCap", () => {
        expect(capLeft(CAP, 0n)).toBe(CAP);
        expect(capLeft(CAP, CAP)).toBe(0n);
        expect(capLeft(CAP, CAP + 5n)).toBe(0n);
        expect(exceedsCap(CAP, CAP)).toBe(false);
        expect(exceedsCap(CAP + 1n, CAP)).toBe(true);
    });
    it("nothing left: 0", () => {
        expect(maxQuoteForCap(VQ_K, 0n, 0n, FEE, 0n)).toBe(0n);
    });
    it("rounds down: the amount fits, 1 wei more does not (fee included)", () => {
        for (const [vq, r, s, left] of [
            [VQ_K, 0n, 0n, CAP],
            [VQ_E, 0n, 0n, CAP],
            [VQ_K, 0n, 0n, 1234n * E18],
            [VQ_K, 150_000n * E18, 70_000_000n * E18, CAP - 7n],
        ] as [bigint, bigint, bigint, bigint][]) {
            const q = maxQuoteForCap(vq, r, s, FEE, left);
            expect(quoteBuyWithFees(vq, r, s, q, FEE).tokensOut).toBeLessThanOrEqual(left);
            expect(quoteBuyWithFees(vq, r, s, q + 1n, FEE).tokensOut).toBeGreaterThan(left);
        }
        // matches the contract test's 2% boundary on a fresh KRWs curve
        expect(maxQuoteForCap(VQ_K, 0n, 0n, FEE, CAP)).toBe(38_602_586_373_287_010_229_684n);
    });
    it("an exact fit: when left equals what some amount buys, that amount is kept", () => {
        const q0 = 1000n * E18;
        const exact = quoteBuyWithFees(VQ_K, 0n, 0n, q0, FEE).tokensOut;
        const q = maxQuoteForCap(VQ_K, 0n, 0n, FEE, exact);
        expect(quoteBuyWithFees(VQ_K, 0n, 0n, q, FEE).tokensOut).toBe(exact);
        expect(q).toBeGreaterThanOrEqual(q0);
    });
    it("the rest of the curve within the cap: an amount that buys the rest", () => {
        const s = CURVE_SUPPLY - 5n * E18;
        const q = maxQuoteForCap(VQ_K, 6_000_000n * E18, s, FEE, CAP);
        expect(quoteBuyWithFees(VQ_K, 6_000_000n * E18, s, q, FEE).tokensOut).toBe(5n * E18);
    });
    it("copy: the table's sentences with the chain values", () => {
        expect(ko.trade.priorityCapLeft("1,234.5")).toBe("첫 10분 한도: 1,234.5개 더 살 수 있어요");
        expect(en.trade.priorityCapLeft("1,234.5")).toBe("First 10 minutes: you can buy 1,234.5 more");
        expect(ko.trade.priorityCapFull(ko.trade.capTime(3, 5))).toBe("우선 구간 한도를 다 채웠어요. 3분 5초 뒤에는 한도 없이 살 수 있어요");
        expect(en.trade.priorityCapFull(en.trade.capTime(3, 5))).toBe("You've reached the limit for this window. No limit in 3m 5s.");
        expect(ko.trade.priorityCapOver(CAP)).toBe("첫 10분 동안은 지갑 하나가 총공급의 2%까지만 가질 수 있어요");
        expect(en.trade.priorityCapOver(CAP)).toBe("For the first 10 minutes a wallet can hold up to 2% of supply.");
        expect(ko.errors.PriorityHoldingExceeded).toBe(ko.trade.priorityCapOver(CAP));
        expect(en.errors.PriorityHoldingExceeded).toBe(en.trade.priorityCapOver(CAP));
        expect(ko.trade.priorityCapMax).toBe("한도까지");
        expect(en.trade.priorityCapMax).toBe("Up to limit");
        expect(ko.tokenPage.priorityCapNote(CAP)).toBe("첫 10분은 지갑당 총공급의 2%까지. 발행자도 같아요");
        expect(en.tokenPage.priorityCapNote(CAP)).toBe("First 10 minutes: up to 2% of supply per wallet, the dev included.");
        expect(ko.trade.priorityCapOver(5_000_000n * E18)).toContain("0.5%");
        for (const s of [ko.trade.priorityCapOver(CAP), ko.create.devBuyCap(CAP), ko.tokenPage.priorityCapNote(CAP)]) {
            expect(s).not.toMatch(/수익|투자|오른다|오르/);
        }
    });
});

describe("errors.ts maps the revert (W-T54)", () => {
    it("PriorityHoldingExceeded decodes to the cap sentence", () => {
        const data = encodeErrorResult({abi: CurveSaleAbi, errorName: "PriorityHoldingExceeded", args: [CAP + 1n, CAP]});
        const e = new ContractFunctionRevertedError({abi: CurveSaleAbi, data, functionName: "buy"});
        expect(humanError(e, ko, "v3")).toBe(ko.errors.PriorityHoldingExceeded);
        expect(humanError(e, en, "v3")).toBe(en.errors.PriorityHoldingExceeded);
    });
});
