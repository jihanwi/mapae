import {describe, expect, it} from "vitest";
import {
    autoSlippageBps,
    avgPriceWad,
    curveBuyAvg,
    curveSellAvg,
    decodePref,
    guardReducer,
    MAX_BPS,
    MIN_BPS,
    minOut,
    parseCustomSlippage,
    customSlippageBlocks,
    pctOneDecimal,
    pctTwoDecimals,
    poolImpactBps,
    priceImpactBps,
    requoteDecision,
} from "./slippage";

const E18 = 10n ** 18n;
const NOW = 10_000;
const p = (ts: number, price: bigint) => ({ts, priceWad: price});

describe("autoSlippageBps", () => {
    it("is 1% with no trades or a single trade", () => {
        expect(autoSlippageBps([], NOW)).toBe(MIN_BPS);
        expect(autoSlippageBps([p(NOW - 10, E18)], NOW)).toBe(MIN_BPS);
    });
    it("doubles the largest step between consecutive trades, rounded up", () => {
        // steps: +2% then +1.2% -> M = 200 bps -> 400
        expect(autoSlippageBps([p(NOW - 300, 100n * E18), p(NOW - 200, 102n * E18), p(NOW - 100, 10322n * E18 / 100n)], NOW)).toBe(400);
        // 1/3% step rounds up: ceil(33.33) = 34 -> 68 -> clamped to 100
        expect(autoSlippageBps([p(NOW - 20, 300n), p(NOW - 10, 301n)], NOW)).toBe(100);
        // a step of 0.75% -> 150 bps (not clamped)
        expect(autoSlippageBps([p(NOW - 20, 400n), p(NOW - 10, 403n)], NOW)).toBe(150);
    });
    it("clamps to 15%", () => {
        expect(autoSlippageBps([p(NOW - 20, E18), p(NOW - 10, 2n * E18)], NOW)).toBe(MAX_BPS);
    });
    it("uses only the last trade before the window as the first reference", () => {
        const trades = [p(NOW - 2000, E18), p(NOW - 700, 2n * E18), p(NOW - 100, 2n * E18 + 2n * E18 / 100n)];
        // pairs: (NOW-700 -> NOW-100) = +1% -> 200; the jump from NOW-2000 is outside and ignored
        expect(autoSlippageBps(trades, NOW)).toBe(200);
        // nothing inside the window -> no pair
        expect(autoSlippageBps([p(NOW - 2000, E18), p(NOW - 700, 2n * E18)], NOW)).toBe(MIN_BPS);
    });
    it("counts falling prices (sells) the same way", () => {
        expect(autoSlippageBps([p(NOW - 20, 100n), p(NOW - 10, 97n)], NOW)).toBe(600);
    });
});

describe("custom slippage input and saved preference", () => {
    it("accepts 0.1 to 50 with one decimal", () => {
        expect(parseCustomSlippage("0.1")).toEqual({ok: true, bps: 10});
        expect(parseCustomSlippage("50")).toEqual({ok: true, bps: 5000});
        expect(parseCustomSlippage("2.4")).toEqual({ok: true, bps: 240});
        expect(parseCustomSlippage("0.05")).toEqual({ok: false, reason: "format"});
        expect(parseCustomSlippage("50.1")).toEqual({ok: false, reason: "range"});
        expect(parseCustomSlippage("0")).toEqual({ok: false, reason: "range"});
        expect(parseCustomSlippage("abc")).toEqual({ok: false, reason: "format"});
        expect(parseCustomSlippage("")).toEqual({ok: false, reason: "empty"});
    });
    it("restores valid saved values and falls back to auto otherwise", () => {
        expect(decodePref('{"mode":"preset","bps":300}')).toEqual({mode: "preset", bps: 300});
        expect(decodePref('{"mode":"custom","bps":240}')).toEqual({mode: "custom", bps: 240});
        expect(decodePref('{"mode":"custom","bps":9999}')).toEqual({mode: "auto"});
        expect(decodePref('{"mode":"preset","bps":200}')).toEqual({mode: "auto"});
        expect(decodePref("{broken")).toEqual({mode: "auto"});
        expect(decodePref(null)).toEqual({mode: "auto"});
    });
    it("formats percents", () => {
        expect(pctOneDecimal(240)).toBe("2.4");
        expect(pctOneDecimal(100)).toBe("1");
        expect(pctOneDecimal(241)).toBe("2.5");
        expect(pctTwoDecimals(1234n)).toBe("12.34");
        expect(pctTwoDecimals(5n)).toBe("0.05");
    });
});

describe("price impact and minimum output", () => {
    it("buy: avg / spot - 1; sell: 1 - avg / spot; fees excluded", () => {
        expect(priceImpactBps("buy", E18, (E18 * 105n) / 100n)).toBe(500n);
        expect(priceImpactBps("sell", E18, (E18 * 97n) / 100n)).toBe(300n);
        expect(priceImpactBps("buy", E18, E18 / 2n)).toBe(0n);
        // 103 quote paid with 3 fees -> 100 net for 100 tokens = spot 1.0 -> 0% impact
        expect(priceImpactBps("buy", E18, curveBuyAvg(103n * E18, 3n * E18, 100n * E18))).toBe(0n);
        // sell: 97 out + 3 fees = 100 gross for 100 tokens at spot 1.0 -> 0%
        expect(priceImpactBps("sell", E18, curveSellAvg(97n * E18, 3n * E18, 100n * E18))).toBe(0n);
        expect(avgPriceWad(1n, 0n)).toBe(0n);
    });
    it("pool impact from reserves", () => {
        // buy 10 net into 1000 quote reserve -> 1%
        expect(poolImpactBps("buy", 10n * E18, 1000n * E18, 5000n * E18, 0n)).toBe(100n);
        expect(poolImpactBps("buy", 10n * E18, 1000n * E18, 5000n * E18, 100n)).toBe(99n);
        // sell 100 into 900 token reserve -> 100/1000 = 10%
        expect(poolImpactBps("sell", 100n * E18, 1000n * E18, 900n * E18, 0n)).toBe(1000n);
    });
    it("minOut rounds down", () => {
        expect(minOut(1000n, 100)).toBe(990n);
        expect(minOut(999n, 100)).toBe(989n);
    });
});

describe("re-quote guard", () => {
    it("proceeds within tolerance with a minimum from the fresh quote", () => {
        expect(requoteDecision(1000n, 995n, 100)).toEqual({kind: "proceed", min: 985n});
        expect(requoteDecision(1000n, 990n, 100)).toEqual({kind: "proceed", min: 980n});
    });
    it("asks the user when the fresh quote is worse than the tolerance", () => {
        expect(requoteDecision(1000n, 989n, 100)).toEqual({kind: "confirm"});
        expect(guardReducer({kind: "idle"}, {type: "requoted", seen: 1000n, fresh: 900n, bps: 100})).toEqual({kind: "moved", fresh: 900n});
        expect(guardReducer({kind: "idle"}, {type: "requoted", seen: 1000n, fresh: 999n, bps: 100})).toEqual({kind: "idle"});
    });
    it("simulation failures: InsufficientOutput shows the moved panel, others keep the state", () => {
        expect(guardReducer({kind: "idle"}, {type: "simulateFailed", reason: "InsufficientOutput", fresh: 5n})).toEqual({kind: "moved", fresh: 5n});
        expect(guardReducer({kind: "idle"}, {type: "simulateFailed", reason: "other", fresh: 5n})).toEqual({kind: "idle"});
    });
    it("a sent tx that failed on InsufficientOutput shows the gas-spent panel; reset clears", () => {
        const s = guardReducer({kind: "idle"}, {type: "sentFailed", reason: "InsufficientOutput"});
        expect(s).toEqual({kind: "sentFailed"});
        expect(guardReducer({kind: "idle"}, {type: "sentFailed", reason: "other"})).toEqual({kind: "idle"});
        expect(guardReducer(s, {type: "reset"})).toEqual({kind: "idle"});
    });
});

describe("customSlippageBlocks", () => {
    it("blocks while the open field holds an invalid non-empty value", () => {
        for (const bad of ["0", "51", "100", "abc", "0.05"]) expect(customSlippageBlocks(true, bad), bad).toBe(true);
    });
    it("does not block for a valid value, an empty field, or a closed field", () => {
        expect(customSlippageBlocks(true, "2.5")).toBe(false);
        expect(customSlippageBlocks(true, "")).toBe(false);
        expect(customSlippageBlocks(true, "   ")).toBe(false);
        expect(customSlippageBlocks(false, "100")).toBe(false); // auto or a preset was picked
    });
});
