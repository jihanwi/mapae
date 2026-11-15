import {describe, expect, it} from "vitest";
import {encodeAbiParameters, encodeEventTopics, Hex} from "viem";
import {CurveSaleAbi, MapaePoolV3Abi} from "../contracts/abisV3";
import {
    ACTIVITY_CAP,
    ACTIVITY_TOPICS,
    aggregate,
    cmpRatio,
    coverageHours,
    decodeActivityLogs,
    interpolateTs,
    marketCap,
    mcapRatio,
    mergeEntries,
    RawLog,
    resolve,
    SortCurve,
    sortCurves,
    Trade,
} from "./activity";
import {CURVE_SUPPLY, VIRTUAL_TOKEN_RESERVE} from "./curveMath";

type A = `0x${string}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as A;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const E18 = 10n ** 18n;

const CURVE = addr(0xc1);
const POOL = addr(0xb1);
const DEV = addr(0xde);
const ALICE = addr(0xa1);
const BOB = addr(0xb0b);

function buyLog(o: {emitter: A; trader: A; isDev: boolean; verified?: boolean; quoteSpent: bigint; tokensOut: bigint; block: bigint; i: number}): RawLog {
    const topics = encodeEventTopics({abi: CurveSaleAbi, eventName: "Buy", args: {trader: o.trader}}) as Hex[];
    const data = encodeAbiParameters(
        [{type: "bool"}, {type: "bool"}, {type: "uint256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint256"}],
        [o.isDev, o.verified ?? true, o.quoteSpent, o.tokensOut, 1n, 2n, 3n, 0n, 0n]
    );
    return {address: o.emitter, topics, data, blockNumber: o.block, logIndex: o.i, transactionHash: tx(o.i + Number(o.block) * 100)};
}
function sellLog(o: {emitter: A; trader: A; isDev: boolean; tokenIn: bigint; quoteOut: bigint; block: bigint; i: number}): RawLog {
    const topics = encodeEventTopics({abi: CurveSaleAbi, eventName: "Sell", args: {trader: o.trader}}) as Hex[];
    const data = encodeAbiParameters(
        [{type: "bool"}, {type: "uint256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint256"}, {type: "uint256"}],
        [o.isDev, o.tokenIn, o.quoteOut, 10n, 20n, 30n, 0n, 0n]
    );
    return {address: o.emitter, topics, data, blockNumber: o.block, logIndex: o.i, transactionHash: tx(o.i + Number(o.block) * 100)};
}
function swapLog(o: {emitter: A; sender: A; to: A; quoteIn: boolean; amountIn: bigint; amountOut: bigint; royalty: bigint; block: bigint; i: number}): RawLog {
    const topics = encodeEventTopics({abi: MapaePoolV3Abi, eventName: "Swapped", args: {sender: o.sender, to: o.to}}) as Hex[];
    const data = encodeAbiParameters([{type: "bool"}, {type: "uint256"}, {type: "uint256"}, {type: "uint256"}], [o.quoteIn, o.amountIn, o.amountOut, o.royalty]);
    return {address: o.emitter, topics, data, blockNumber: o.block, logIndex: o.i, transactionHash: tx(o.i + Number(o.block) * 100)};
}

const curveRef = {address: CURVE, pool: POOL, dev: DEV, index: 0};

describe("decode + resolve + aggregate", () => {
    const logs = [
        buyLog({emitter: CURVE, trader: DEV, isDev: true, quoteSpent: 100n, tokensOut: 5n, block: 10n, i: 0}),
        buyLog({emitter: CURVE, trader: ALICE, isDev: false, quoteSpent: 200n, tokensOut: 7n, block: 11n, i: 0}),
        buyLog({emitter: CURVE, trader: ALICE, isDev: false, quoteSpent: 300n, tokensOut: 8n, block: 12n, i: 0}),
        sellLog({emitter: CURVE, trader: BOB, isDev: false, tokenIn: 4n, quoteOut: 40n, block: 13n, i: 0}),
        // pool: buy by Bob through a router (sender != to), sell by the Dev
        swapLog({emitter: POOL, sender: addr(0x777), to: BOB, quoteIn: true, amountIn: 1000n, amountOut: 9n, royalty: 5n, block: 20n, i: 1}),
        swapLog({emitter: POOL, sender: DEV, to: DEV, quoteIn: false, amountIn: 3n, amountOut: 50n, royalty: 2n, block: 21n, i: 2}),
        // unknown emitter is dropped
        buyLog({emitter: addr(0x999), trader: ALICE, isDev: false, quoteSpent: 1n, tokensOut: 1n, block: 22n, i: 0}),
    ];
    const entries = decodeActivityLogs(logs);
    const {trades} = resolve(entries, [curveRef]);
    const s = aggregate(trades).get(CURVE)!;

    it("topics OR-list has Buy, Sell, Swapped, Graduated", () => {
        expect(ACTIVITY_TOPICS).toHaveLength(4);
        expect(new Set(ACTIVITY_TOPICS).size).toBe(4);
    });
    it("drops logs from unknown addresses", () => {
        expect(entries).toHaveLength(7);
        expect(trades).toHaveLength(6);
    });
    it("excludes the Dev (isDev on curve events, trader == dev on pool swaps) and dedupes wallets", () => {
        // v3.1: only verified curve buys count (Alice twice); Bob only sold and swapped on the pool
        expect(s.uniqueTraders).toBe(1);
        expect(trades.find((t) => t.venue === "pool" && t.side === "sell")!.isDev).toBe(true);
        expect(trades.find((t) => t.venue === "pool" && t.side === "buy")!.trader).toBe(BOB);
    });
    it("sums volume including fees, Dev included, curve and pool together", () => {
        // buys: 100 + 200 + 300; curve sell 40 + fees 60; pool buy 1000; pool sell 50 + royalty 2
        expect(s.volumeQuote).toBe(100n + 200n + 300n + 100n + 1000n + 52n);
        expect(s.tradeCount).toBe(6);
        expect(s.lastTradeBlock).toBe(21n);
        expect(s.recent[0].block).toBe(21n);
    });
});

describe("v3.1 verified buys", () => {
    it("decodes Buy.verified and counts only verified non-Dev buyers", () => {
        const logs = [
            buyLog({emitter: CURVE, trader: ALICE, isDev: false, verified: false, quoteSpent: 10n, tokensOut: 1n, block: 30n, i: 0}),
            buyLog({emitter: CURVE, trader: BOB, isDev: false, verified: true, quoteSpent: 10n, tokensOut: 1n, block: 31n, i: 0}),
            buyLog({emitter: CURVE, trader: DEV, isDev: true, verified: true, quoteSpent: 10n, tokensOut: 1n, block: 32n, i: 0}),
        ];
        const entries = decodeActivityLogs(logs);
        expect(entries.map((e) => (e.kind === "Buy" ? e.verified : null))).toEqual([false, true, true]);
        const {trades} = resolve(entries, [curveRef]);
        expect(trades.find((t) => t.trader === ALICE)!.verified).toBe(false);
        expect(aggregate(trades).get(CURVE)!.uniqueTraders).toBe(1); // Bob only
    });
    it("Popular drops curves without any verified buyer", () => {
        const c1 = sc(1);
        const c2 = sc(2);
        const s = aggregate([trade(c1.address, ALICE, 5n, 100n, false, false), trade(c2.address, BOB, 6n, 1n)]);
        expect(ids(sortCurves("popular", [c1, c2], s))).toEqual([2]);
    });
});

describe("time interpolation", () => {
    it("is linear between the two known blocks", () => {
        const a = {block: 1000n, ts: 1_000_000};
        const b = {block: 10000n, ts: 1_009_000};
        expect(interpolateTs(1000n, a, b)).toBe(1_000_000);
        expect(interpolateTs(10000n, a, b)).toBe(1_009_000);
        expect(interpolateTs(5500n, a, b)).toBe(1_004_500);
        expect(interpolateTs(5n, b, b)).toBe(1_009_000);
    });
    it("reports covered hours, at least 1", () => {
        expect(coverageHours({block: 0n, ts: 0}, {block: 9000n, ts: 9000})).toBe(3); // 2.5 h rounds to 3
        expect(coverageHours({block: 0n, ts: 0}, {block: 1n, ts: 60})).toBe(1);
    });
});

describe("retention cap", () => {
    it("keeps the newest ACTIVITY_CAP entries and dedupes", () => {
        const mk = (n: number) => ({tx: tx(n), logIndex: 0, block: BigInt(n)});
        const old = Array.from({length: ACTIVITY_CAP}, (_, i) => mk(i));
        const merged = mergeEntries(old, [mk(ACTIVITY_CAP), mk(ACTIVITY_CAP + 1), mk(5)]);
        expect(merged).toHaveLength(ACTIVITY_CAP);
        expect(merged[0].block).toBe(BigInt(ACTIVITY_CAP + 1));
        expect(merged.at(-1)!.block).toBe(2n); // 0 and 1 dropped
        expect(merged.filter((e) => e.block === 5n)).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------------------------

const VQ_KRW = 2_000_000n * E18; // arbitrary starting reserves
const VQ_ETH = 2n * E18;
function sc(n: number, o: Partial<SortCurve> = {}): SortCurve {
    return {address: addr(n), pool: addr(0), dev: DEV, index: n, graduated: false, virtualQuote: VQ_KRW, r: 0n, s: 0n, ...o};
}
function trade(curve: A, trader: A, block: bigint, volume: bigint, isDev = false, verified: boolean | null = true): Trade {
    return {curve, venue: "curve", side: "buy", trader, isDev, verified, tokenAmount: 1n, quoteAmount: volume, volume, block, logIndex: 0, tx: tx(Number(block) * 1000 + Number(BigInt(curve) % 1000n))};
}
const ids = (l: SortCurve[]) => l.map((c) => Number(BigInt(c.address)));

describe("market cap across pair assets", () => {
    it("compares mcap / virtualQuote by bigint cross-multiplication", () => {
        // KRWs curve at 2x its start, ETH curve at 3x
        const a = mcapRatio(2n * VQ_KRW, VQ_KRW);
        const b = mcapRatio(3n * VQ_ETH, VQ_ETH);
        expect(cmpRatio(b, a)).toBe(1);
        expect(cmpRatio(a, b)).toBe(-1);
        expect(cmpRatio(mcapRatio(4n * VQ_ETH, 2n * VQ_ETH), a)).toBe(0);
    });
    it("uses the pool spot after graduation", () => {
        expect(marketCap({graduated: true, virtualQuote: VQ_KRW, r: 0n, s: 0n}, 3n * E18)).toBe(3n * 1_000_000_000n * E18);
        expect(marketCap({graduated: true, virtualQuote: VQ_KRW, r: 0n, s: 0n}, undefined)).toBeUndefined();
    });
    it("mcap tab: ETH curve at 3x beats KRWs curve at 2x; unknown pool price goes last", () => {
        // Curve spot mcap scales with (vq+r)^2 / vq at s matching the reserve; use graduated pools for exact ratios.
        const krw = sc(1, {graduated: true, poolSpot: (2n * VQ_KRW * E18) / 1_000_000_000n / E18});
        const eth = sc(2, {graduated: true, virtualQuote: VQ_ETH, poolSpot: (3n * VQ_ETH) / 1_000_000_000n});
        const unknown = sc(3, {graduated: true});
        expect(ids(sortCurves("mcap", [unknown, krw, eth], new Map()))).toEqual([2, 1, 3]);
    });
});

describe("tab sorting", () => {
    // index = creation order (higher = newer)
    const c1 = sc(1, {r: 100_000n * E18});
    const c2 = sc(2, {r: 500_000n * E18});
    const c3 = sc(3, {graduated: true});
    const c4 = sc(4, {graduated: true});
    const c5 = sc(5);
    const all = [c1, c2, c3, c4, c5];
    const stats = aggregate([trade(c2.address, ALICE, 50n, 10n), trade(c1.address, BOB, 70n, 10n), trade(c3.address, ALICE, 60n, 10n)]);

    it("latest: last trade desc, then curves without trades newest first", () => {
        expect(ids(sortCurves("latest", all, stats))).toEqual([1, 3, 2, 5, 4]);
    });
    it("almost: ungraduated only, progress desc", () => {
        expect(ids(sortCurves("almost", all, stats))).toEqual([2, 1, 5]);
    });
    it("new: newest first", () => {
        expect(ids(sortCurves("new", all, stats))).toEqual([5, 4, 3, 2, 1]);
    });
    it("graduated: graduated only, newest graduation first, else newest created", () => {
        expect(ids(sortCurves("graduated", all, stats, new Map([[c3.address, 90n]])))).toEqual([3, 4]);
        expect(ids(sortCurves("graduated", all, stats))).toEqual([4, 3]);
    });
    it("mcap: ratio desc", () => {
        expect(ids(sortCurves("mcap", [c1, c2, c5], stats))).toEqual([2, 1, 5]);
    });
    it("popular: drops curves with no non-Dev trader", () => {
        const s = aggregate([trade(c1.address, DEV, 10n, 999n, true)]);
        expect(sortCurves("popular", all, s)).toEqual([]);
    });
});

describe("popular ranking", () => {
    const a = sc(1);
    const b = sc(2);
    const c = sc(3);
    const d = sc(4);
    it("sums the trader rank and the volume rank (smaller first)", () => {
        // traders: a 3, b 1, c 2 ; volume: a 10, b 100, c 50
        // ranks: a 1+3=4, b 3+1=4, c 2+2=4 -> all tie on sum; tie-break: more traders first
        const t = [
            trade(a.address, addr(0x101), 1n, 4n), trade(a.address, addr(0x102), 2n, 3n), trade(a.address, addr(0x103), 3n, 3n),
            trade(b.address, addr(0x201), 4n, 100n),
            trade(c.address, addr(0x301), 5n, 25n), trade(c.address, addr(0x302), 6n, 25n),
        ];
        expect(ids(sortCurves("popular", [a, b, c], aggregate(t)))).toEqual([1, 3, 2]);
    });
    it("tied values share a rank (competition ranking), then last trade breaks the tie", () => {
        // a and b: 1 trader, same volume -> both ranks 1+1 = 2; c: 1 trader, less volume -> 1+3 = 4
        const t = [trade(a.address, addr(0x101), 5n, 50n), trade(b.address, addr(0x201), 9n, 50n), trade(c.address, addr(0x301), 20n, 10n)];
        expect(ids(sortCurves("popular", [a, b, c], aggregate(t)))).toEqual([2, 1, 3]);
    });
    it("a curve where only the Dev trades big does not lead the volume rank", () => {
        // a: 1 trader, small non-Dev volume, huge Dev volume; b: 1 trader, larger non-Dev volume
        const t = [
            trade(a.address, addr(0x101), 1n, 10n),
            trade(a.address, DEV, 2n, 10n ** 30n, true),
            trade(b.address, addr(0x201), 1n, 50n),
        ];
        const s = aggregate(t);
        expect(s.get(a.address)!.volumeQuote).toBe(10n + 10n ** 30n); // card value still includes the Dev
        expect(s.get(a.address)!.volumeQuoteNonDev).toBe(10n);
        expect(ids(sortCurves("popular", [a, b], s))).toEqual([2, 1]);
    });
    it("normalizes volume by 3 x virtualQuote across pair assets", () => {
        // a: KRWs volume 0.3 x threshold, d: ETH volume 0.6 x threshold
        const dEth = {...d, virtualQuote: VQ_ETH};
        const t = [trade(a.address, addr(0x101), 1n, (3n * VQ_KRW * 3n) / 10n), trade(dEth.address, addr(0x401), 2n, (3n * VQ_ETH * 6n) / 10n)];
        expect(ids(sortCurves("popular", [a, dEth], aggregate(t)))).toEqual([4, 1]);
    });
});

it("curveMath constants used by the market cap are 18-decimals", () => {
    expect(CURVE_SUPPLY > 0n && VIRTUAL_TOKEN_RESERVE > 0n).toBe(true);
});
