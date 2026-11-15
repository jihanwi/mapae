import {describe, expect, it} from "vitest";
import {parseAddress} from "./wallet";
import {parseWalletTradesParams} from "./wallet-trades";

const MIXED = "0x2D6E234037Da0180be8e4B905f3baA6C544b391d";
const LOWER = MIXED.toLowerCase();
const q = (s: string) => new URLSearchParams(s);

describe("wallet address parameter", () => {
    it("rejects a missing or malformed address", () => {
        expect(parseAddress(null)).toBeNull();
        expect(parseAddress("")).toBeNull();
        expect(parseAddress("0x123")).toBeNull();
        expect(parseAddress(MIXED.slice(2))).toBeNull();
        expect(parseAddress("0xZZ" + "0".repeat(38))).toBeNull();
    });
    it("lowercases a mixed-case or uppercase address", () => {
        expect(parseAddress(MIXED)).toBe(LOWER);
        expect(parseAddress("0x" + MIXED.slice(2).toUpperCase())).toBe(LOWER);
        expect(parseAddress(LOWER)).toBe(LOWER);
    });
});

describe("wallet-trades parameters", () => {
    it("needs a valid address", () => {
        expect(parseWalletTradesParams(q(""))).toBeNull();
        expect(parseWalletTradesParams(q("address=0x12"))).toBeNull();
    });
    it("defaults to the first page of 50", () => {
        expect(parseWalletTradesParams(q(`address=${MIXED}`))).toEqual({address: LOWER, before: undefined, limit: 50});
    });
    it("accepts before and limit, rejects bad ones", () => {
        expect(parseWalletTradesParams(q(`address=${LOWER}&before=1700000000&limit=20`))).toEqual({address: LOWER, before: 1_700_000_000n, limit: 20});
        expect(parseWalletTradesParams(q(`address=${LOWER}&before=abc`))).toBeNull();
        expect(parseWalletTradesParams(q(`address=${LOWER}&limit=0`))).toBeNull();
        expect(parseWalletTradesParams(q(`address=${LOWER}&limit=51`))).toBeNull();
    });
});
