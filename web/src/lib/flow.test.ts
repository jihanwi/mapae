import {describe, expect, it} from "vitest";
import {flowShare} from "./flow";

describe("flowShare", () => {
    it("null when nothing traded", () => {
        expect(flowShare(0n, 0n)).toBeNull();
    });
    it("100 or 0 when one side is empty", () => {
        expect(flowShare(5n, 0n)).toBe(100);
        expect(flowShare(0n, 5n)).toBe(0);
    });
    it("rounds half up to a whole percent", () => {
        expect(flowShare(1n, 1n)).toBe(50);
        expect(flowShare(1n, 2n)).toBe(33); // 33.33
        expect(flowShare(2n, 1n)).toBe(67); // 66.67
        expect(flowShare(1n, 199n)).toBe(1); // 0.5 -> 1
        expect(flowShare(3n, 997n)).toBe(0); // 0.3 -> 0
        expect(flowShare(10n ** 30n, 3n * 10n ** 30n)).toBe(25);
    });
});
