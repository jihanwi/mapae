import {describe, expect, it} from "vitest";
import {chunk100, displayName, nicknameKey} from "./nicknames";

const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const MIXED = "0x2D6E234037Da0180be8e4B905f3baA6C544b391d";

describe("nicknameKey", () => {
    it("same key whatever the order or letter case", () => {
        expect(nicknameKey([a(2), MIXED, a(1)])).toEqual(nicknameKey([a(1), MIXED.toLowerCase(), a(2), a(2)]));
        expect(nicknameKey([MIXED])).toEqual([MIXED.toLowerCase()]);
    });
    it("empty input -> empty key", () => {
        expect(nicknameKey([])).toEqual([]);
    });
});

describe("chunk100", () => {
    it("100 stay together, 101 split into 100 + 1, 0 gives none", () => {
        const list = (n: number) => Array.from({length: n}, (_, i) => a(i));
        expect(chunk100(list(100)).map((c) => c.length)).toEqual([100]);
        expect(chunk100(list(101)).map((c) => c.length)).toEqual([100, 1]);
        expect(chunk100([])).toEqual([]);
    });
});

describe("displayName", () => {
    it("nickname when present, short address otherwise", () => {
        expect(displayName("고래잡이_B", MIXED)).toBe("고래잡이_B");
        expect(displayName(null, MIXED)).toBe("0x2D6E…391d");
        expect(displayName("", MIXED)).toBe("0x2D6E…391d");
    });
});
