import {describe, expect, it} from "vitest";
import type {Trade} from "./activity";
import {sortCurves, SortCurve} from "./activity";
import {mergeHistory, mergeStats, ServerSummary, ServerTrade, sharePct} from "./chainMerge";

type A = `0x${string}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as A;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const C1 = addr(0xc1);
const C2 = addr(0xc2);
const DEV = addr(0xde);
const NOW = 1_000_000;
const tsOf = (b: bigint) => Number(b); // block == unix second in these tests

function trade(curve: A, trader: A, block: number, quote: bigint, isDev = false, i = 0): Trade {
    return {curve, venue: "curve", side: "buy", trader, isDev, verified: true, tokenAmount: 1n, quoteAmount: quote, volume: quote + 1n, block: BigInt(block), logIndex: i, tx: tx(block * 10 + i)};
}

const server: ServerSummary = {
    indexedBlock: String(NOW - 100),
    indexedTs: String(NOW - 100),
    curves: {
        [C1]: {trades24h: 3, traders24h: 2, volume24h: "300", volume24hExDev: "200", lastTradeTs: String(NOW - 500), lastPriceWad: "1", refPriceWad: null},
    },
};

describe("mergeStats", () => {
    it("adds only browser trades after indexedBlock to the server 24 h numbers", () => {
        const m = mergeStats(
            server,
            [
                trade(C1, addr(0xa1), NOW - 200, 999n), // before indexedBlock: already in the server numbers
                trade(C1, addr(0xa2), NOW - 50, 10n),
                trade(C1, DEV, NOW - 40, 20n, true),
                trade(C1, addr(0xa2), NOW - 30, 5n),
                trade(C2, addr(0xb1), NOW - 20, 7n),
            ],
            tsOf,
            NOW
        );
        const s1 = m.get(C1)!;
        expect(s1.tradeCount).toBe(3 + 3);
        expect(s1.uniqueTraders).toBe(2 + 1); // a2 once, Dev excluded
        expect(s1.volumeQuote).toBe(300n + 10n + 20n + 5n); // quote_amount, Dev included
        expect(s1.volumeQuoteNonDev).toBe(200n + 10n + 5n);
        expect(s1.lastTradeTs).toBe(NOW - 30);
        const s2 = m.get(C2)!;
        expect(s2).toMatchObject({tradeCount: 1, uniqueTraders: 1, volumeQuote: 7n, lastTradeTs: NOW - 20});
    });
    it("keeps the Popular formula: ranks by traders and Dev-excluded normalized volume", () => {
        const m = mergeStats(server, [trade(C2, addr(0xb1), NOW - 20, 7n)], tsOf, NOW);
        const curves: SortCurve[] = [
            {address: C1, pool: addr(0), dev: DEV, index: 0, graduated: false, virtualQuote: 100n, r: 0n, s: 0n},
            {address: C2, pool: addr(0), dev: DEV, index: 1, graduated: false, virtualQuote: 100n, r: 0n, s: 0n},
        ];
        // C1: 2 traders, 200 non-Dev volume; C2: 1 trader, 7 -> C1 first on both ranks
        expect(sortCurves("popular", curves, m).map((c) => c.address)).toEqual([C1, C2]);
        // Latest uses the merged last trade time
        expect(sortCurves("latest", curves, m).map((c) => c.address)).toEqual([C2, C1]);
    });
    it("without an indexedBlock every browser trade counts", () => {
        const m = mergeStats({indexedBlock: null, indexedTs: null, curves: {}}, [trade(C1, addr(0xa1), NOW - 10, 4n)], tsOf, NOW);
        expect(m.get(C1)!.tradeCount).toBe(1);
    });
    it("window = 3600: browser trades older than an hour only move the last trade, not the numbers", () => {
        const hourServer: ServerSummary = {indexedBlock: String(NOW - 5000), indexedTs: String(NOW - 5000), window: 3600, curves: {}};
        const browser = [trade(C1, addr(0xa1), NOW - 4000, 50n), trade(C1, addr(0xa2), NOW - 100, 3n)];
        const h = mergeStats(hourServer, browser, tsOf, NOW, 3600).get(C1)!;
        expect(h).toMatchObject({tradeCount: 1, uniqueTraders: 1, volumeQuote: 3n, lastTradeTs: NOW - 100});
        // the same trades over 24 h (default) count both
        const d = mergeStats(hourServer, browser, tsOf, NOW).get(C1)!;
        expect(d).toMatchObject({tradeCount: 2, uniqueTraders: 2, volumeQuote: 53n});
    });
});

describe("mergeHistory", () => {
    const st = (block: number, i = 0): ServerTrade => ({tx: tx(block * 10 + i), logIndex: i, side: "sell", venue: "pool", trader: addr(0xa1), isDev: false, quoteAmount: "5", tokenAmount: "6", priceWad: "1", ts: String(block)});
    it("appends browser trades after indexedBlock, dedupes by (tx, logIndex), newest first", () => {
        const rows = mergeHistory([st(NOW - 100), st(NOW - 300)], [trade(C1, addr(0xa2), NOW - 50, 1n), trade(C1, addr(0xa2), NOW - 100, 1n), trade(C1, addr(0xa2), NOW - 150, 1n)], String(NOW - 120), tsOf);
        expect(rows.map((r) => r.ts)).toEqual([NOW - 50, NOW - 100, NOW - 300]);
        // NOW - 100 came from the browser first (block > indexedBlock); the server copy is a duplicate
        expect(rows.filter((r) => r.ts === NOW - 100)).toHaveLength(1);
    });
});

describe("sharePct", () => {
    it("floors to two decimals of the 1e9 supply", () => {
        const S = 1_000_000_000n * 10n ** 18n;
        expect(sharePct(S / 2n, S)).toBe("50.00");
        expect(sharePct(S / 3n, S)).toBe("33.33");
        expect(sharePct(S / 100_000n, S)).toBe("0.00");
        expect(sharePct(S, S)).toBe("100.00");
    });
});
