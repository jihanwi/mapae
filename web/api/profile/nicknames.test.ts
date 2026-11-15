import {describe, expect, it} from "vitest";
import {NICKNAMES_MAX, parseAddresses} from "./nicknames";

const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

describe("nicknames addresses parameter", () => {
    it("missing or empty -> null", () => {
        expect(parseAddresses(null)).toBeNull();
        expect(parseAddresses("")).toBeNull();
        expect(parseAddresses(",")).toBeNull();
    });
    it("any malformed address -> null", () => {
        expect(parseAddresses(`${a(1)},0x12`)).toBeNull();
        expect(parseAddresses(`${a(1)}, ${a(2)}`)).toBeNull();
        expect(parseAddresses("0xZZ" + "0".repeat(38))).toBeNull();
    });
    it("lowercases and dedupes", () => {
        const mixed = "0x2D6E234037Da0180be8e4B905f3baA6C544b391d";
        expect(parseAddresses(`${mixed},${mixed.toLowerCase()},${a(1)}`)).toEqual([mixed.toLowerCase(), a(1)]);
    });
    it("100 addresses pass, 101 do not (counted after dedupe)", () => {
        const hundred = Array.from({length: NICKNAMES_MAX}, (_, i) => a(i + 1));
        expect(parseAddresses(hundred.join(","))).toHaveLength(100);
        expect(parseAddresses([...hundred, a(101)].join(","))).toBeNull();
        expect(parseAddresses([...hundred, hundred[0].toUpperCase().replace("0X", "0x")].join(","))).toHaveLength(100);
    });
});
