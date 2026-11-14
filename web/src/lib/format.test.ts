import {describe, expect, it} from "vitest";
import {fmt, fmtRound, fmtSig} from "./format";

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
