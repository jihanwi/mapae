import {describe, expect, it} from "vitest";
import {GAS_RESERVE_WEI} from "./maxInput";
import {quickAmounts, sharePctOneDecimal} from "./quickAmount";

const E18 = 10n ** 18n;
const TOTAL = 1_000_000_000n * E18;

describe("quickAmounts", () => {
    it("buy with KRWs: 10K / 50K / 100K, then max", () => {
        const q = quickAmounts("buy", false, 30_000n * E18, false);
        expect(q.map((x) => x.label)).toEqual(["k10", "k50", "k100", "max"]);
        expect(q.slice(0, 3).map((x) => x.value)).toEqual([10_000n * E18, 50_000n * E18, 100_000n * E18]);
        // above the balance is still offered (the CTA reports the shortfall)
        expect(q.every((x) => !x.disabled)).toBe(true);
    });
    it("buy with ETH (or pool WETH): 0.01 / 0.05 / 0.1, then max", () => {
        const q = quickAmounts("buy", true, E18, true);
        expect(q.map((x) => x.label)).toEqual(["e001", "e005", "e01", "max"]);
        expect(q.slice(0, 3).map((x) => x.value)).toEqual([10n ** 16n, 5n * 10n ** 16n, 10n ** 17n]);
        expect(q[3]).toEqual({label: "max", value: "max", disabled: false});
    });
    it("buy max is disabled with no balance, an unknown one, or only the gas reserve", () => {
        expect(quickAmounts("buy", false, 0n, false)[3].disabled).toBe(true);
        expect(quickAmounts("buy", false, undefined, false)[3].disabled).toBe(true);
        expect(quickAmounts("buy", true, GAS_RESERVE_WEI, true)[3].disabled).toBe(true);
        // fixed amounts stay available without a wallet
        expect(quickAmounts("buy", false, undefined, false).slice(0, 3).every((x) => !x.disabled)).toBe(true);
    });
    it("sell: 25 / 50 / 75 % of the balance, floored", () => {
        const q = quickAmounts("sell", false, 7n, false);
        expect(q.map((x) => x.label)).toEqual(["p25", "p50", "p75", "max"]);
        expect(q.slice(0, 3).map((x) => x.value)).toEqual([1n, 3n, 5n]);
        const big = quickAmounts("sell", false, 1000n * E18 + 3n, false);
        expect(big[1].value).toBe(500n * E18 + 1n);
        expect(big.every((x) => !x.disabled)).toBe(true);
    });
    it("sell with a zero or unknown balance disables every button", () => {
        for (const b of [0n, undefined]) {
            const q = quickAmounts("sell", false, b, false);
            expect(q.every((x) => x.disabled)).toBe(true);
            expect(q[0].value).toBe(0n);
        }
    });
});

describe("sharePctOneDecimal", () => {
    it("floors to one decimal, 0 for nothing", () => {
        expect(sharePctOneDecimal(0n, TOTAL)).toBe("0");
        expect(sharePctOneDecimal(123_456_789n * E18, TOTAL)).toBe("12.3");
        expect(sharePctOneDecimal(TOTAL, TOTAL)).toBe("100.0");
        expect(sharePctOneDecimal(1n, TOTAL)).toBe("0.0");
    });
});
