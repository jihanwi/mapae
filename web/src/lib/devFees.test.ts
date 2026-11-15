import {describe, expect, it} from "vitest";
import {devFeeState, devFeeUnit} from "./devFees";

describe("devFeeUnit", () => {
    it("KRWs curves pay KRWs, ETH curves pay WETH", () => {
        expect(devFeeUnit(false)).toBe("KRWs");
        expect(devFeeUnit(true)).toBe("WETH");
    });
});

describe("devFeeState", () => {
    it("hidden for anyone but the Dev, whatever the amount", () => {
        expect(devFeeState({isDev: false, accrued: 0n})).toBe("hidden");
        expect(devFeeState({isDev: false, accrued: 5n})).toBe("hidden");
        expect(devFeeState({isDev: false, accrued: undefined})).toBe("hidden");
    });
    it("hidden for the Dev while the amount is unknown", () => {
        expect(devFeeState({isDev: true, accrued: undefined})).toBe("hidden");
    });
    it("empty at 0, ready above 0", () => {
        expect(devFeeState({isDev: true, accrued: 0n})).toBe("empty");
        expect(devFeeState({isDev: true, accrued: 1n})).toBe("ready");
    });
});
