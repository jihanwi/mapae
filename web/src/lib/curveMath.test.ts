import {describe, expect, it} from "vitest";
import {
    CURVE_SUPPLY,
    PRESET,
    TOTAL_SUPPLY,
    VIRTUAL_TOKEN_RESERVE,
    buyExactQuoteIn,
    costToSellOut,
    graduationThreshold,
    grossForNet,
    marketCapQuote,
    progressBps,
    sellExactTokenIn,
    spotPrice,
} from "./curveMath";

const E18 = 10n ** 18n;
const abs = (x: bigint) => (x < 0n ? -x : x);
const near = (a: bigint, b: bigint, tol: bigint) => expect(abs(a - b) <= tol, `${a} vs ${b} (tol ${tol})`).toBe(true);
const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n);

describe("CurvePresets constants", () => {
    it("matches src/CurvePresets.sol", () => {
        expect(TOTAL_SUPPLY).toBe(10n ** 27n);
        expect(CURVE_SUPPLY).toBe(8n * 10n ** 26n);
        expect(VIRTUAL_TOKEN_RESERVE).toBe(1_066_666_666_666_666_666_666_666_667n);
    });
});

describe("KRWs preset (vq = 2,000,000e18)", () => {
    const vq = 2_000_000n * E18;

    it("start price is 0.001875", () => {
        near(spotPrice(vq, 0n, 0n), 1_875n * 10n ** 12n, 1n);
    });

    it("costToSellOut from genesis is 6,000,000e18 (within 1 wei)", () => {
        near(costToSellOut(vq, 0n, 0n), 6_000_000n * E18, 1n);
        expect(graduationThreshold(vq)).toBe(6_000_000n * E18);
    });

    it("at sell-out the spot is 0.03 and the market cap 30,000,000", () => {
        const r = costToSellOut(vq, 0n, 0n);
        near(spotPrice(vq, r, CURVE_SUPPLY), 3n * 10n ** 16n, 1n);
        near(marketCapQuote(vq, r, CURVE_SUPPLY), 30_000_000n * E18, 10n ** 3n);
        expect(costToSellOut(vq, r, CURVE_SUPPLY)).toBe(0n);
    });

    it("progressBps(r = 3e24) is 5000 and caps at 10000", () => {
        expect(progressBps(vq, 3n * 10n ** 24n)).toBe(5000n);
        expect(progressBps(vq, 0n)).toBe(0n);
        expect(progressBps(vq, 7_000_000n * E18)).toBe(10_000n);
    });

    it("grossForNet rounds the fee-inclusive amount up", () => {
        const net = costToSellOut(vq, 0n, 0n);
        const gross = grossForNet(net, 100n);
        expect(gross).toBe(ceilDiv(net * 10_000n, 9_900n));
        expect(gross - (gross * 100n) / 10_000n >= net).toBe(true);
        expect(grossForNet(0n, 100n)).toBe(0n);
    });
});

describe("ETH testnet registry (vq = 0.002e18)", () => {
    it("costToSellOut from genesis is 0.006e18", () => {
        near(costToSellOut(2n * 10n ** 15n, 0n, 0n), 6n * 10n ** 15n, 1n);
    });
});

// Vectors ported from test/CurveMath.t.sol
describe("test/CurveMath.t.sol vectors", () => {
    it("test_I6_ticketReferenceVector: Vq 2,000,000 (6-dec) / Vt 1,073M / S 800M → 5,860,805.860806", () => {
        const g = {vToken: 1_073_000_000n * E18, saleSupply: 800_000_000n * E18};
        const c = costToSellOut(2_000_000n * 10n ** 6n, 0n, 0n, g);
        expect(c).toBe(5_860_805_860_806n);
        expect(ceilDiv(c, 10n ** 6n)).toBe(5_860_806n);
    });

    it("test_I9_freeTailClosesSale: last token-wei is free and a zero-quote buy closes the sale", () => {
        const vq = 2_000_000n * 10n ** 6n;
        const s = CURVE_SUPPLY - 1n;
        const r = ceilDiv(vq * VIRTUAL_TOKEN_RESERVE, VIRTUAL_TOKEN_RESERVE - s) - vq;
        expect(costToSellOut(vq, r, s)).toBe(0n);
        expect(buyExactQuoteIn(vq, r, s, 0n)).toEqual({tokensOut: 1n, quoteUsed: 0n});
        // a non-closing dust buy at genesis gets nothing
        expect(buyExactQuoteIn(vq, 0n, 0n, 0n)).toEqual({tokensOut: 0n, quoteUsed: 0n});
    });

    it("testFuzz_I6_closedForm: genesis cost == ceil(Vq × S / (Vt − S)) and buying it sells out", () => {
        for (const vq of [2_000_000n * E18, 2_000_000n * 10n ** 6n, 6n * 10n ** 17n, 2n * 10n ** 15n]) {
            const expected = ceilDiv(vq * CURVE_SUPPLY, VIRTUAL_TOKEN_RESERVE - CURVE_SUPPLY);
            expect(costToSellOut(vq, 0n, 0n)).toBe(expected);
            expect(buyExactQuoteIn(vq, 0n, 0n, expected)).toEqual({tokensOut: CURVE_SUPPLY, quoteUsed: expected});
        }
    });

    it("I5 solvency + I8 canonical reserve: full exit returns exactly r", () => {
        const vq = 2_000_000n * E18;
        let r = 0n;
        let s = 0n;
        for (const q of [123_456n * E18, 7n * E18, 999_999n * E18]) {
            const {tokensOut, quoteUsed} = buyExactQuoteIn(vq, r, s, q);
            r += quoteUsed;
            s += tokensOut;
            expect(vq + r).toBe(ceilDiv(vq * PRESET.vToken, PRESET.vToken - s));
        }
        expect(sellExactTokenIn(vq, r, s, s)).toBe(r);
    });

    it("I2 round trip: selling what x bought never returns more than x", () => {
        const vq = 2n * 10n ** 15n;
        const x = 10n ** 15n;
        const {tokensOut, quoteUsed} = buyExactQuoteIn(vq, 0n, 0n, x);
        const back = sellExactTokenIn(vq, quoteUsed, tokensOut, tokensOut);
        expect(back <= quoteUsed).toBe(true);
        expect(quoteUsed <= x).toBe(true);
    });
});

describe("quoteBuyWithFees (CurveSale._quoteBuy port, used for the dev first buy preview)", () => {
    it("charges at most quoteIn and splits fee = spent − used", async () => {
        const {quoteBuyWithFees} = await import("./curveMath");
        const vq = 2_000_000n * E18;
        const q = quoteBuyWithFees(vq, 0n, 0n, 100_000n * E18, 100n);
        const direct = buyExactQuoteIn(vq, 0n, 0n, 100_000n * E18 - (100_000n * E18 * 100n) / 10_000n);
        expect(q.tokensOut).toBe(direct.tokensOut);
        expect(q.quoteUsed).toBe(direct.quoteUsed);
        expect(q.quoteSpent <= 100_000n * E18).toBe(true);
        expect(q.quoteSpent).toBe(ceilDiv(q.quoteUsed * 10_000n, 9_900n));
    });
    it("an oversized first buy sells out and charges only the fee-inclusive sell-out cost", async () => {
        const {quoteBuyWithFees} = await import("./curveMath");
        const vq = 2n * 10n ** 15n; // testnet WETH registry
        const q = quoteBuyWithFees(vq, 0n, 0n, 10n ** 18n, 100n);
        expect(q.tokensOut).toBe(CURVE_SUPPLY);
        expect(q.quoteSpent).toBe(grossForNet(costToSellOut(vq, 0n, 0n), 100n));
    });
});
