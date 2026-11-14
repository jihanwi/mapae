import {describe, expect, it} from "vitest";
import {GAS_RESERVE_WEI, maxInput} from "./maxInput";

describe("maxInput", () => {
    it("uses the full ERC20 balance", () => {
        expect(maxInput(123n, false)).toBe(123n);
    });
    it("leaves 0.0001 ETH for gas on native balances", () => {
        expect(GAS_RESERVE_WEI).toBe(10n ** 14n);
        expect(maxInput(10n ** 18n, true)).toBe(10n ** 18n - 10n ** 14n);
    });
    it("never goes below zero", () => {
        expect(maxInput(10n ** 14n, true)).toBe(0n);
        expect(maxInput(5n, true)).toBe(0n);
    });
});
