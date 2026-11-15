import {describe, expect, it} from "vitest";
import {agoOf, fmt, fmtCeil, fmtRound, fmtSig, sanitizeAmountInput} from "./format";

const E12 = 10n ** 12n;
const E18 = 10n ** 18n;

describe("price formatting rounds half-up", () => {
    it("shows 0.001875 for a price 1 wei below 1875e12", () => {
        expect(fmtSig(1875n * E12 - 1n, 4)).toBe("0.001875");
    });
    it("rounds at the requested significant digits", () => {
        expect(fmtSig(18745n * 10n ** 11n, 4)).toBe("0.001875"); // 0.0018745 -> half-up
        expect(fmtSig(18744n * 10n ** 11n, 4)).toBe("0.001874");
        expect(fmtSig(562n * 10n ** 6n, 4)).toBe("0.000000000562");
    });
    it("carries into the integer part", () => {
        expect(fmtSig(E18 - 1n, 4)).toBe("1");
        expect(fmtRound(1234n * E18 + E18 / 2n, 0)).toBe("1,235");
    });
});

describe("amount formatting keeps floor", () => {
    it("truncates instead of rounding", () => {
        expect(fmt(1875n * E12 - 1n, 6)).toBe("0.001874");
        expect(fmt(2n * E18 - 1n, 4)).toBe("1.9999");
        expect(fmt(1234n * E18 + (E18 * 9n) / 10n, 0)).toBe("1,234");
    });
});

describe("pay-side formatting rounds up", () => {
    it("6,060,606.07 shows as 6,060,607 at 0 decimals", () => {
        expect(fmtCeil(606060607n * 10n ** 16n, 0)).toBe("6,060,607");
    });
    it("a value exact at the shown precision is unchanged", () => {
        expect(fmtCeil(6_000_000n * E18, 0)).toBe("6,000,000");
        expect(fmtCeil(6_000_000n * E18, 2)).toBe("6,000,000");
        expect(fmtCeil(125n * 10n ** 16n, 2)).toBe("1.25");
        expect(fmtCeil(0n, 2)).toBe("0");
    });
    it("the floor format is unchanged for the same values", () => {
        expect(fmt(606060607n * 10n ** 16n, 0)).toBe("6,060,606");
        expect(fmtCeil(1n, 2)).toBe("0.01");
        expect(fmt(1n, 2)).toBe("0");
    });
});

describe("agoOf", () => {
    it("buckets elapsed seconds", () => {
        expect(agoOf(1000, 990)).toEqual({unit: "now", n: 0});
        expect(agoOf(1000, 1010)).toEqual({unit: "now", n: 0});
        expect(agoOf(1000, 820)).toEqual({unit: "min", n: 3});
        expect(agoOf(10_000, 2_000)).toEqual({unit: "hour", n: 2});
        expect(agoOf(200_000, 0)).toEqual({unit: "day", n: 2});
    });
});

describe("sanitizeAmountInput", () => {
    it("normalizes full-width digits and dots (NFKC)", () => {
        expect(sanitizeAmountInput("１００")).toBe("100");
        expect(sanitizeAmountInput("１．５")).toBe("1.5");
    });
    it("drops commas, signs and other characters, keeps one dot", () => {
        expect(sanitizeAmountInput("1,000")).toBe("1000");
        expect(sanitizeAmountInput("-5")).toBe("5");
        expect(sanitizeAmountInput("1.2.3")).toBe("1.23");
    });
    it("keeps at most 18 fraction digits", () => {
        expect(sanitizeAmountInput("0." + "0".repeat(19))).toBe("0." + "0".repeat(18));
        expect(sanitizeAmountInput("1.1234567890123456789")).toBe("1.123456789012345678");
    });
});
