import {describe, expect, it} from "vitest";
import {utf8ByteLength, withinByteLimit} from "./bytes";

describe("utf8ByteLength", () => {
    it("counts ASCII as 1 byte", () => {
        expect(utf8ByteLength("MAPAE")).toBe(5);
        expect(utf8ByteLength("")).toBe(0);
    });
    it("counts Korean syllables as 3 bytes", () => {
        expect(utf8ByteLength("마패")).toBe(6);
        expect(utf8ByteLength("마패 커브")).toBe(13);
    });
    it("counts emoji as 4 bytes (surrogate pairs)", () => {
        expect(utf8ByteLength("🐴")).toBe(4);
        expect(utf8ByteLength("마🐴A")).toBe(8);
    });
});

describe("withinByteLimit (CurveFactory MAX_NAME_BYTES 32 / MAX_SYMBOL_BYTES 10)", () => {
    it("accepts the exact limit and rejects one byte over", () => {
        expect(withinByteLimit("a".repeat(32), 32)).toBe(true);
        expect(withinByteLimit("a".repeat(33), 32)).toBe(false);
        expect(withinByteLimit("가".repeat(10) + "ab", 32)).toBe(true); // 30 + 2
        expect(withinByteLimit("가".repeat(11), 32)).toBe(false); // 33
        expect(withinByteLimit("🐴🐴A", 9)).toBe(true); // 9 bytes, exact limit
        expect(withinByteLimit("🐴🐴A", 8)).toBe(false);
        expect(withinByteLimit("🐴🐴AB", 10)).toBe(true); // 10
        expect(withinByteLimit("🐴🐴ABC", 10)).toBe(false); // 11
    });
    it("rejects empty strings", () => {
        expect(withinByteLimit("", 10)).toBe(false);
    });
});
