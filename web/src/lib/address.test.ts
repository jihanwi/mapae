import {describe, expect, it} from "vitest";
import {addrKey, normalizeAddressParam, sameAddr} from "./address";
import {aggregate, Trade} from "./activity";
import {mergeHistory} from "./chainMerge";
import {tokenPageState} from "./tokenPage";

const CHECKSUM = "0xCB8DE4CAaC1AcBa352f1d8c659D4578115E8f781";
const LOWER = CHECKSUM.toLowerCase();
const UPPER = "0x" + CHECKSUM.slice(2).toUpperCase();

const trade = (block: bigint, i: number): Trade => ({
    curve: CHECKSUM as `0x${string}`, // the curve list's (checksummed) spelling
    venue: "curve",
    side: "buy",
    trader: "0x00000000000000000000000000000000000000a1",
    isDev: false,
    verified: true,
    tokenAmount: 1n,
    quoteAmount: 1n,
    volume: 1n,
    block,
    logIndex: i,
    tx: `0x${(Number(block) * 10 + i).toString(16).padStart(64, "0")}`,
});

describe("curve address in the URL", () => {
    it("lowercase, uppercase and checksummed inputs normalize to the same address", () => {
        const expected = normalizeAddressParam(CHECKSUM);
        expect(expected).not.toBeNull();
        expect(normalizeAddressParam(LOWER)).toBe(expected);
        expect(normalizeAddressParam(UPPER)).toBe(expected);
    });
    it("all three give the same trade history", () => {
        const stats = aggregate([trade(10n, 0), trade(11n, 0)]);
        const histories = [LOWER, UPPER, CHECKSUM].map((raw) => {
            const addr = normalizeAddressParam(raw)!;
            const browser = stats.get(addrKey(addr))?.recent ?? [];
            return mergeHistory([], browser, null, (b) => Number(b)).map((r) => r.key);
        });
        expect(histories[0]).toHaveLength(2);
        expect(histories[1]).toEqual(histories[0]);
        expect(histories[2]).toEqual(histories[0]);
    });
    it("a malformed address is 'curve not found'", () => {
        for (const raw of ["0x123", "hello", "", undefined, "0xZZ8de4caac1acba352f1d8c659d4578115e8f781"]) {
            const addr = normalizeAddressParam(raw);
            expect(addr).toBeNull();
            expect(tokenPageState({validAddress: addr !== null, isCurve: undefined, registryError: false, curveError: false, curveLoaded: false})).toBe("notFound");
        }
    });
    it("sameAddr ignores letter case", () => {
        expect(sameAddr(LOWER, CHECKSUM)).toBe(true);
        expect(sameAddr(LOWER, undefined)).toBe(false);
    });
});
