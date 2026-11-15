import {describe, expect, it} from "vitest";
import {GAS_RESERVE_WEI} from "./maxInput";
import {quickAmounts, SELL_STEP} from "./quickAmount";

const E18 = 10n ** 18n;

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
    it("sell: 25 / 50 / 75 % of the balance, floored to 4 decimals", () => {
        // 7818872.04722149068602754 tokens: 50% would be 3909436.02361074534301377
        const bal = 7_818_872_047_221_490_686_027_540n;
        const q = quickAmounts("sell", false, bal, false);
        expect(q.map((x) => x.label)).toEqual(["p25", "p50", "p75", "max"]);
        expect(q[1].value).toBe(3_909_436_023_600_000_000_000_000n); // 3909436.0236
        expect(q[0].value).toBe(1_954_718_011_800_000_000_000_000n); // 1954718.0118
        expect(q[2].value).toBe(5_864_154_035_400_000_000_000_000n); // 5864154.0354
        for (const x of q.slice(0, 3)) expect((x.value as bigint) % SELL_STEP).toBe(0n);
        expect(q.every((x) => !x.disabled)).toBe(true);
        // max stays the full balance (resolved by the panel)
        expect(q[3].value).toBe("max");
    });
    it("sell: a tiny balance whose share floors to 0 disables that button", () => {
        const q = quickAmounts("sell", false, 3n * SELL_STEP, false); // 0.0003
        expect(q.slice(0, 3).map((x) => x.value)).toEqual([0n, SELL_STEP, 2n * SELL_STEP]);
        expect(q.slice(0, 3).map((x) => x.disabled)).toEqual([true, false, false]);
        const dust = quickAmounts("sell", false, 7n, false);
        expect(dust.slice(0, 3).every((x) => x.disabled)).toBe(true);
        expect(dust[3].disabled).toBe(false);
    });
    it("sell with a zero or unknown balance disables every button", () => {
        for (const b of [0n, undefined]) {
            const q = quickAmounts("sell", false, b, false);
            expect(q.every((x) => x.disabled)).toBe(true);
            expect(q[0].value).toBe(0n);
        }
    });
});
