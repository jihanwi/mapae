import {describe, expect, it} from "vitest";
import {encodeAbiParameters, encodeEventTopics, Hex} from "viem";
import {CurveFactoryAbi, CurveSaleAbi, MapaePoolV3Abi, MembershipTokenV3Abi} from "../../src/contracts/abisV3.js";
import {decodeActivityLogs, resolve, tradePriceWad, type RawLog} from "../../src/lib/activity.js";
import {LiveTrade, mergeLiveCandles} from "../../src/lib/candles.js";
import {buyExactQuoteIn, spotPrice} from "../../src/lib/curveMath.js";
import {
    ACTIVITY_TOPICS,
    CronDeps,
    CURVE_CREATED_TOPIC,
    holderLabel,
    KnownCurve,
    parseBefore,
    parseCurve,
    parseInterval,
    parseLimit,
    planRanges,
    runCron,
    indexOnce,
    CRON_INDEX_OPTS,
    POKE_INDEX_OPTS,
    MAX_RANGES,
    TIME_BUDGET_MS,
    toCurveRows,
    toTradeRows,
    toTransferRows,
    TRANSFER_TOPIC,
    fillVerified,
    verifiedLookupTargets,
} from "./indexer.js";
import {curveList, holderSignals, INDEXER_STATE_ID, LIST_MAX, loadCurves, PokeClaim, POKE_GAP_SEC, readNextBlock, readState, Sql, trades as tradesQuery, walletTradeRows, walletTrades, writeRange} from "./db.js";
import {handlePoke} from "./poke.js";
import {paramsAllowed} from "./chainApi.js";

type A = `0x${string}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as A;
const up = (a: string) => ("0x" + a.slice(2).toUpperCase()) as A;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const E18 = 10n ** 18n;
const FACTORY = addr(0xfac);
const CURVE = addr(0xc1);
const TOKEN = addr(0x70);
const POOL = addr(0xb1);
const DEV = addr(0xde);
const ALICE = addr(0xa1);
const BOB = addr(0xb0b);
const T0 = {block: 100n, ts: 1_000};
const T1 = {block: 200n, ts: 1_100};
const VQ = 2_000_000n * E18; // KRWs preset virtual quote

const raw = (address: A, topics: Hex[], data: Hex, block: bigint, i: number): RawLog => ({address, topics, data, blockNumber: block, logIndex: i, transactionHash: tx(Number(block) * 10 + i)});

function created(block: bigint): RawLog {
    const topics = encodeEventTopics({abi: CurveFactoryAbi, eventName: "CurveCreated", args: {dev: up(DEV), curve: up(CURVE), token: up(TOKEN)}}) as Hex[];
    const data = encodeAbiParameters([{type: "address"}, {type: "uint256"}, {type: "string"}, {type: "string"}, {type: "uint64"}], [addr(0x99), 2_000_000n * E18, "Horse", "HRN", 1_650n]);
    return raw(FACTORY, topics, data, block, 0);
}
function buy(trader: A, isDev: boolean, quoteSpent: bigint, tokensOut: bigint, block: bigint, i: number, verified = true, r = 0n, s = 0n): RawLog {
    const topics = encodeEventTopics({abi: CurveSaleAbi, eventName: "Buy", args: {trader}}) as Hex[];
    const data = encodeAbiParameters(Array(9).fill(null).map((_, k) => ({type: k <= 1 ? "bool" : "uint256"})), [isDev, verified, quoteSpent, tokensOut, 0n, 0n, 0n, r, s]);
    return raw(CURVE, topics, data, block, i);
}
function sell(trader: A, tokenIn: bigint, quoteOut: bigint, block: bigint, i: number, r = 0n, s = 0n): RawLog {
    const topics = encodeEventTopics({abi: CurveSaleAbi, eventName: "Sell", args: {trader}}) as Hex[];
    const data = encodeAbiParameters(Array(8).fill(null).map((_, k) => ({type: k === 0 ? "bool" : "uint256"})), [false, tokenIn, quoteOut, 0n, 0n, 0n, r, s]);
    return raw(CURVE, topics, data, block, i);
}
function graduated(block: bigint, i: number): RawLog {
    const topics = encodeEventTopics({abi: CurveSaleAbi, eventName: "Graduated", args: {pool: POOL}}) as Hex[];
    const data = encodeAbiParameters([{type: "uint256"}, {type: "uint256"}, {type: "uint256"}], [1n, 1n, 1n]);
    return raw(CURVE, topics, data, block, i);
}
function swapped(to: A, quoteIn: boolean, amountIn: bigint, amountOut: bigint, block: bigint, i: number): RawLog {
    const topics = encodeEventTopics({abi: MapaePoolV3Abi, eventName: "Swapped", args: {sender: addr(0x5e), to}}) as Hex[];
    const data = encodeAbiParameters([{type: "bool"}, {type: "uint256"}, {type: "uint256"}, {type: "uint256"}], [quoteIn, amountIn, amountOut, 0n]);
    return raw(POOL, topics, data, block, i);
}
function transfer(token: A, from: A, to: A, value: bigint, block: bigint, i: number): RawLog {
    const topics = encodeEventTopics({abi: MembershipTokenV3Abi, eventName: "Transfer", args: {from, to}}) as Hex[];
    return raw(token, topics, encodeAbiParameters([{type: "uint256"}], [value]), block, i);
}

describe("planRanges", () => {
    it("is empty when next is past head", () => {
        expect(planRanges(11n, 10n)).toEqual([]);
    });
    it("covers exactly one span", () => {
        expect(planRanges(1n, 9000n)).toEqual([[1n, 9000n]]);
        expect(planRanges(1n, 9001n)).toEqual([[1n, 9000n], [9001n, 9001n]]);
        expect(planRanges(5n, 5n)).toEqual([[5n, 5n]]);
    });
    it("stops at max ranges", () => {
        const r = planRanges(0n, 1_000_000n);
        expect(r).toHaveLength(12);
        expect(r[11]).toEqual([99_000n, 107_999n]);
    });
});

describe("rows", () => {
    it("curve rows from CurveCreated, lowercase, interpolated time", () => {
        const rows = toCurveRows([created(150n)], up(FACTORY), T0, T1);
        expect(rows).toEqual([
            {curve: CURVE, token: TOKEN, dev: DEV, quote: addr(0x99), virtualQuote: (2_000_000n * E18).toString(), name: "Horse", symbol: "HRN", createdBlock: "150", createdTs: "1050", priorityUntil: "1650", factory: FACTORY},
        ]);
        expect(toCurveRows([created(150n)], addr(0xbad), T0, T1)).toEqual([]);
    });
    it("trades: Buy, Sell, Swapped both ways, Graduated links the pool, zero token amount skipped", () => {
        const known: KnownCurve[] = [{curve: CURVE, token: TOKEN, dev: DEV, pool: null, virtualQuote: VQ}];
        const logs = [
            buy(up(ALICE), false, 3n * E18, 1000n * E18, 110n, 0, true, 3n * E18, 1000n * E18),
            buy(DEV, true, E18, 0n, 111n, 0), // zero tokens: skipped
            sell(ALICE, 500n * E18, E18, 120n, 0, 2n * E18, 500n * E18),
            graduated(130n, 1),
            swapped(up(ALICE), true, 2n * E18, 400n * E18, 140n, 0),
            swapped(DEV, false, 100n * E18, E18 / 2n, 150n, 0),
            buy(ALICE, false, E18, E18, 160n, 0),
        ];
        logs[6] = {...logs[6], address: addr(0x999)}; // unknown curve: dropped
        const {trades, graduations} = toTradeRows(logs, known, T0, T1);
        expect(graduations).toEqual([{curve: CURVE, pool: POOL, block: "130"}]);
        const byBlock = Object.fromEntries(trades.map((t) => [t.block, t]));
        expect(Object.keys(byBlock).sort()).toEqual(["110", "120", "140", "150"]);
        expect(byBlock["110"]).toMatchObject({venue: "curve", side: "buy", trader: ALICE, isDev: false, verified: true, quoteAmount: (3n * E18).toString(), tokenAmount: (1000n * E18).toString(), priceWad: spotPrice(VQ, 3n * E18, 1000n * E18).toString(), rAfter: (3n * E18).toString(), sAfter: (1000n * E18).toString(), ts: "1010"});
        expect(byBlock["120"]).toMatchObject({side: "sell", verified: null, tokenAmount: (500n * E18).toString(), quoteAmount: E18.toString(), priceWad: spotPrice(VQ, 2n * E18, 500n * E18).toString(), rAfter: (2n * E18).toString(), sAfter: (500n * E18).toString()});
        expect(byBlock["140"]).toMatchObject({venue: "pool", side: "buy", trader: ALICE, isDev: false, quoteAmount: (2n * E18).toString(), tokenAmount: (400n * E18).toString(), priceWad: (2n * E18 / 400n).toString(), rAfter: null, sAfter: null});
        expect(byBlock["150"]).toMatchObject({venue: "pool", side: "sell", trader: DEV, isDev: true, tokenAmount: (100n * E18).toString(), quoteAmount: (E18 / 2n).toString()});
        expect(trades.every((t) => t.tx === t.tx.toLowerCase())).toBe(true);
    });
    it("decision 50: a sold-out KRWs curve prices at the spot 0.03 KRWs (mcap 3,000만), far above the executed price", () => {
        const known: KnownCurve[] = [{curve: CURVE, token: TOKEN, dev: DEV, pool: null, virtualQuote: VQ}];
        const s = 800_000_000n * E18;
        const r = 6_000_000n * E18;
        const {trades} = toTradeRows([buy(ALICE, false, r, s, 110n, 0, true, r, s)], known, T0, T1);
        const p = BigInt(trades[0].priceWad);
        expect(p).toBe(spotPrice(VQ, r, s));
        // 0.03e18 within rounding (Vt is ceil(3.2e27 / 3), so the spot sits a hair under 0.03).
        expect(p <= 3n * E18 / 100n && p > 3n * E18 / 100n - 10n ** 9n).toBe(true);
        expect((p * 1_000_000_000n) / E18).toBe(29_999_999n); // mcap just under 3,000만 KRWs
        const exec = (r * E18) / s; // 0.0075 KRWs
        expect(exec * 4n).toBeLessThanOrEqual(p + 1n);
    });
    it("decision 50: a small buy's spot and executed prices are within 1%", () => {
        const known: KnownCurve[] = [{curve: CURVE, token: TOKEN, dev: DEV, pool: null, virtualQuote: VQ}];
        const {tokensOut, quoteUsed} = buyExactQuoteIn(VQ, 0n, 0n, 1_000n * E18);
        const {trades} = toTradeRows([buy(ALICE, false, quoteUsed, tokensOut, 110n, 0, true, quoteUsed, tokensOut)], known, T0, T1);
        const spot = BigInt(trades[0].priceWad);
        const exec = (quoteUsed * E18) / tokensOut;
        expect(spot).toBeGreaterThan(exec);
        expect((spot - exec) * 100n).toBeLessThan(exec);
    });
    it("decision 50: without a known virtual quote a curve trade falls back to the executed price", () => {
        expect(tradePriceWad({venue: "curve", quoteAmount: 3n * E18, tokenAmount: 1000n * E18, rAfter: 3n * E18, sAfter: 1000n * E18}, undefined)).toBe(3n * E18 / 1000n);
        expect(tradePriceWad({venue: "pool", quoteAmount: 3n * E18, tokenAmount: 1000n * E18}, VQ)).toBe(3n * E18 / 1000n);
    });
    it("decision 50: server rows and browser live candles give the same price for the same trade", () => {
        const known: KnownCurve[] = [{curve: CURVE, token: TOKEN, dev: DEV, pool: POOL, virtualQuote: VQ}];
        const r = 1_234_567n * E18;
        const s = 300_000_000n * E18;
        const logs = [buy(ALICE, false, 50_000n * E18, 9_000_000n * E18, 110n, 0, true, r, s), swapped(ALICE, true, 2n * E18, 30n * E18, 120n, 0)];
        const server = toTradeRows(logs, known, T0, T1).trades;
        // the browser path: activity decode + resolve, then the chart's tradePriceWad
        const {trades: browser} = resolve(decodeActivityLogs(logs), [{address: CURVE, pool: POOL, dev: DEV, index: 0}]);
        expect(browser).toHaveLength(2);
        for (const t of browser) {
            const row = server.find((x) => x.logIndex === t.logIndex && x.block === t.block.toString())!;
            const live: LiveTrade = {block: t.block, logIndex: t.logIndex, ts: 1_000, quoteAmount: t.quoteAmount, tokenAmount: t.tokenAmount, priceWad: tradePriceWad(t, VQ)};
            const [candle] = mergeLiveCandles([], [live], null, 300);
            expect(candle.c.toString()).toBe(row.priceWad);
        }
        expect(server.find((x) => x.venue === "curve")!.priceWad).toBe(spotPrice(VQ, r, s).toString());
        expect(server.find((x) => x.venue === "pool")!.priceWad).toBe((2n * E18 * E18 / (30n * E18)).toString());
    });
    it("transfers from known tokens only, lowercase", () => {
        const rows = toTransferRows([transfer(up(TOKEN), addr(0), up(ALICE), 5n, 101n, 2), transfer(addr(0x77), addr(0), ALICE, 5n, 101n, 3)], new Set([TOKEN]));
        expect(rows).toEqual([{tx: tx(1012), logIndex: 2, token: TOKEN, from: addr(0), to: ALICE, value: "5", block: "101"}]);
    });
    it("holder labels", () => {
        const c = {curve: CURVE, pool: POOL, dev: DEV};
        expect(holderLabel(up(CURVE), c)).toBe("curve");
        expect(holderLabel(POOL, c)).toBe("pool");
        expect(holderLabel(DEV, c)).toBe("dev");
        expect(holderLabel(ALICE, {...c, pool: null})).toBeNull();
    });
});

function deps(over: {head?: bigint; next?: bigint | null; failAt?: number; nowStep?: number; withSell?: boolean; lookupFails?: boolean} = {}) {
    const calls: string[] = [];
    const writes: {nextBlock: bigint; trades: number; rows: import("./indexer.js").TradeRow[]}[] = [];
    let now = 0;
    let rangeNo = 0;
    const d: CronDeps = {
        db: {
            ensureSchema: async () => void calls.push("ensureSchema"),
            readNextBlock: async () => (calls.push("readNextBlock"), over.next === undefined ? null : over.next),
            loadCurves: async () => (calls.push("loadCurves"), [{curve: CURVE, token: TOKEN, dev: DEV, pool: null, virtualQuote: VQ}]),
            writeRange: async (w) => void writes.push({nextBlock: w.nextBlock, trades: w.trades.length, rows: w.trades}),
        },
        rpc: {
            blockNumber: async () => (calls.push("blockNumber"), over.head ?? 20_010n),
            blockTime: async (n) => (calls.push("blockTime"), {block: n, ts: Number(n)}),
            getLogs: async (q) => {
                calls.push(`getLogs:${q.topics[0] === CURVE_CREATED_TOPIC ? "created" : q.topics[0] === TRANSFER_TOPIC ? "transfer" : q.topics[0] === ACTIVITY_TOPICS ? "activity" : "?"}`);
                if (q.topics[0] === ACTIVITY_TOPICS) {
                    rangeNo++;
                    if (over.failAt === rangeNo) throw new Error("rpc down");
                    return over.withSell ? [buy(ALICE, false, E18, E18, q.fromBlock, 0), sell(BOB, E18, E18 / 2n, q.fromBlock, 1)] : [buy(ALICE, false, E18, E18, q.fromBlock, 0)];
                }
                return [];
            },
            isVerifiedMany: async (wallets) => {
                calls.push(`multicall:${wallets.length}`);
                if (over.lookupFails) throw new Error("multicall down");
                return new Map(wallets.map((w) => [w.toLowerCase(), true]));
            },
        },
        nowMs: () => (now += over.nowStep ?? 1),
        factory: FACTORY,
        deployBlock: 1000n,
    };
    return {d, calls, writes};
}

describe("runCron", () => {
    it("never touches the DB or RPC when the secret is wrong, empty or missing", async () => {
        for (const [auth, secret] of [["Bearer nope", "s3cret"], ["Bearer ", ""], [null, "s3cret"], ["Bearer s3cret", undefined]] as const) {
            const {d, calls, writes} = deps();
            const r = await runCron(auth, secret, d);
            expect(r.status).toBe(401);
            expect(calls).toEqual([]);
            expect(writes).toEqual([]);
        }
    });
    it("starts at deployBlock and makes exactly 5 RPC calls per range (2 headers + 3 getLogs)", async () => {
        const {d, calls, writes} = deps({head: 1000n + 9_000n + 10n - 1n}); // head - 10 = 9999: one range [1000, 9999]
        const r = await runCron("Bearer s3cret", "s3cret", d);
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ok: true, from: "1000", to: "9999", ranges: 1, trades: 1, next_block: "10000"});
        expect(calls).toEqual(["ensureSchema", "readNextBlock", "blockNumber", "loadCurves", "blockTime", "blockTime", "getLogs:created", "getLogs:activity", "getLogs:transfer"]);
        expect(writes.map((w) => [w.nextBlock, w.trades])).toEqual([[10_000n, 1]]);
    });
    it("returns indexed 0 when caught up", async () => {
        const {d} = deps({next: 20_001n, head: 20_010n});
        expect((await runCron("Bearer s3cret", "s3cret", d)).body).toMatchObject({ok: true, indexed: 0});
    });
    it("stops at a failing range and only advances past the ranges that were written", async () => {
        const {d, writes} = deps({next: 1000n, head: 1000n + 30_000n, failAt: 2});
        const r = await runCron("Bearer s3cret", "s3cret", d);
        expect(r).toEqual({status: 500, body: {ok: false, next_block: "10000"}});
        expect(writes.map((w) => w.nextBlock)).toEqual([10_000n]);
    });
    it("does not start a new range after the 40 s budget", async () => {
        const {d, writes} = deps({next: 1000n, head: 1000n + 100_000n, nowStep: 25_000});
        const r = await runCron("Bearer s3cret", "s3cret", d);
        expect(r.status).toBe(200);
        expect(writes.length).toBeLessThan(12);
        expect(writes.length).toBeGreaterThanOrEqual(1);
    });
});

describe("v3.1 verified status", () => {
    it("Buy rows carry the event value; sells are filled from ONE lookup per range", async () => {
        const {d, calls, writes} = deps({head: 1000n + 9_000n + 10n - 1n, withSell: true});
        await runCron("Bearer s3cret", "s3cret", d);
        expect(calls.filter((c) => c.startsWith("multicall"))).toEqual(["multicall:1"]); // Bob only
        expect(calls.length).toBe(9 + 1); // 5 RPC + 1 lookup per range (plus schema/cursor/head/load)
        const rows = writes[0].rows;
        expect(rows.find((r) => r.side === "buy")!.verified).toBe(true);
        expect(rows.find((r) => r.side === "sell")!.verified).toBe(true);
    });
    it("a failed lookup leaves null and indexing continues", async () => {
        const {d, writes} = deps({head: 1000n + 9_000n + 10n - 1n, withSell: true, lookupFails: true});
        const r = await runCron("Bearer s3cret", "s3cret", d);
        expect(r.status).toBe(200);
        expect(writes[0].rows.find((x) => x.side === "sell")!.verified).toBeNull();
        expect(writes[0].rows.find((x) => x.side === "buy")!.verified).toBe(true);
    });
    it("no sells or swaps: no lookup at all", async () => {
        const {d, calls} = deps({head: 1000n + 9_000n + 10n - 1n});
        await runCron("Bearer s3cret", "s3cret", d);
        expect(calls.some((c) => c.startsWith("multicall"))).toBe(false);
    });
    it("helpers: targets are unique null-status traders; missing lookups stay null", () => {
        const base = {tx: tx(1), logIndex: 0, curve: CURVE, venue: "curve" as const, trader: ALICE, isDev: false, quoteAmount: "1", tokenAmount: "1", priceWad: "1", rAfter: null, sAfter: null, block: "1", ts: "1"};
        const rows = [
            {...base, side: "sell" as const, verified: null},
            {...base, logIndex: 1, side: "sell" as const, verified: null},
            {...base, logIndex: 2, side: "buy" as const, verified: false, trader: BOB},
        ];
        expect(verifiedLookupTargets(rows)).toEqual([ALICE]);
        expect(fillVerified(rows, new Map()).map((r) => r.verified)).toEqual([null, null, false]);
        expect(fillVerified(rows, null).map((r) => r.verified)).toEqual([null, null, false]);
    });
    it("only the current factory's CurveCreated logs become curves", () => {
        expect(toCurveRows([created(150n)], addr(0xbad), T0, T1)).toEqual([]);
    });
});

describe("db: v3.1 cursor row and factory filter", () => {
    it("reads and writes indexer state id 33 (v3.2 reindex) and loads curves of one factory", async () => {
        const seen: {text: string; params: unknown[]}[] = [];
        const fake = {
            query: (text: string, params: unknown[] = []) => {
                seen.push({text, params});
                return Promise.resolve([]);
            },
            transaction: async (qs: unknown[]) => qs,
        } as unknown as Sql;
        expect(INDEXER_STATE_ID).toBe(33);
        await readNextBlock(fake);
        await readState(fake);
        await loadCurves(fake, "0xABC");
        await writeRange(fake, {curves: [], graduations: [], trades: [], transfers: [], nextBlock: 5n, indexedTs: 7});
        expect(seen[0].params).toEqual([33]);
        expect(seen[1].params).toEqual([33]);
        expect(seen[2]).toMatchObject({params: ["0xabc"]});
        expect(seen[2].text).toContain("WHERE factory = $1");
        const state = seen.find((q) => q.text.includes("mapae_indexer_state (id"))!;
        expect(state.params).toEqual(["5", "7", 33]);
    });
});

describe("db: trust signals (decision 51)", () => {
    it("one statement over the token's transfers and the curve's trades, curve and pool excluded", async () => {
        const seen: {text: string; params: unknown[]}[] = [];
        const sql = {
            query: (text: string, params: unknown[] = []) => {
                seen.push({text, params});
                return Promise.resolve([{devFirstBuy: "0"}]);
            },
        } as unknown as Sql;
        const r = await holderSignals(sql, {curve: CURVE, token: TOKEN, dev: DEV, pool: null});
        expect(r).toEqual({devFirstBuy: "0"});
        expect(seen).toHaveLength(1);
        expect(seen[0].params).toEqual([TOKEN, DEV, CURVE, null, "0x0000000000000000000000000000000000000000"]);
        const q = seen[0].text;
        // holders: zero address, curve and (when graduated) pool excluded
        expect(q).toContain("WHERE bal > 0 AND addr <> $5 AND addr <> $3 AND ($4::text IS NULL OR addr <> $4::text)");
        // launch tx = the mint Transfer from the zero address; first buy = Dev curve buys in it
        expect(q).toContain("from_addr = $5 ORDER BY block, log_index LIMIT 1");
        expect(q).toMatch(/side = 'buy' AND venue = 'curve' AND tx IN \(SELECT tx FROM born\)/);
        // Dev sends to anyone but the curve and the pool
        expect(q).toContain("from_addr = $2 AND to_addr <> $3 AND ($4::text IS NULL OR to_addr <> $4::text)");
        expect(q).toContain("rn <= 10");
        expect(q).toContain("verified IS TRUE");
        await holderSignals(sql, {curve: CURVE, token: TOKEN, dev: DEV, pool: POOL});
        expect(seen[1].params[3]).toBe(POOL);
    });
});

describe("db: decision 50 price columns", () => {
    const capture = () => {
        const seen: {text: string; params: unknown[]}[] = [];
        const sql = {
            query: (text: string, params: unknown[] = []) => {
                seen.push({text, params});
                return Promise.resolve([]);
            },
            transaction: async (qs: unknown[]) => qs,
        } as unknown as Sql;
        return {sql, seen};
    };
    it("trade history (curve and wallet) answers the executed price, not the stored spot", async () => {
        const {sql, seen} = capture();
        await tradesQuery(sql, CURVE, undefined, 10);
        await walletTrades(sql, ALICE, FACTORY, undefined, 10);
        for (const q of seen) {
            expect(q.text).toMatch(/div\(t?\.?quote_amount \* 1000000000000000000::numeric, t?\.?token_amount\)::text AS "priceWad"/);
            expect(q.text).not.toContain("price_wad");
        }
    });
    it("W-T16 list: one statement for every curve of the factory, latest r / s and verified buyers, 501 rows max", async () => {
        const {sql, seen} = capture();
        await curveList(sql, "0xABC");
        expect(seen).toHaveLength(1);
        expect(seen[0].params).toEqual(["0xabc", LIST_MAX + 1]);
        expect(LIST_MAX).toBe(500);
        const q = seen[0].text;
        expect(q).toContain("WHERE m.factory = $1");
        expect(q).toContain("ORDER BY m.created_ts DESC");
        expect(q).toContain("COALESCE(l.r_after, 0)::text AS r");
        expect(q).toMatch(/count\(DISTINCT t\.trader\)[\s\S]*t\.verified = true AND NOT t\.is_dev/);
    });
    it("the P&L fold reads amounts only (positions.ts never sees a price)", async () => {
        const {sql, seen} = capture();
        await walletTradeRows(sql, ALICE, FACTORY);
        expect(seen[0].text).not.toContain("price_wad");
        expect(seen[0].text).toContain("quote_amount");
    });
    it("loadCurves reads virtual_quote; trade upserts overwrite price_wad, r_after, s_after", async () => {
        const {sql, seen} = capture();
        await loadCurves(sql, FACTORY);
        expect(seen[0].text).toContain("virtual_quote");
        const row = {tx: tx(1), logIndex: 0, curve: CURVE, venue: "curve" as const, side: "buy" as const, trader: ALICE, isDev: false, verified: true, quoteAmount: "1", tokenAmount: "1", priceWad: "7", rAfter: "3", sAfter: "4", block: "1", ts: "1"};
        await writeRange(sql, {curves: [], graduations: [], trades: [row, {...row, logIndex: 1, venue: "pool", rAfter: null, sAfter: null}], transfers: [], nextBlock: 2n, indexedTs: 1});
        const ins = seen.find((q) => q.text.includes("INSERT INTO mapae_trades"))!;
        expect(ins.text).toContain("DO UPDATE SET price_wad = EXCLUDED.price_wad, r_after = EXCLUDED.r_after, s_after = EXCLUDED.s_after");
        expect(ins.params.slice(13)).toEqual([["3", null], ["4", null]]);
        // curves and transfers stay insert-once, so a reindex does not duplicate them
        expect(seen.find((q) => q.text.includes("INSERT INTO mapae_curves"))!.text).toContain("ON CONFLICT (curve) DO NOTHING");
        expect(seen.find((q) => q.text.includes("INSERT INTO mapae_transfers"))!.text).toContain("ON CONFLICT (tx, log_index) DO NOTHING");
    });
});

describe("query params", () => {
    it("validates curve, interval, limit and before", () => {
        expect(parseCurve(up(CURVE))).toBe(CURVE);
        expect(parseCurve("0x123")).toBeNull();
        expect(parseCurve(null)).toBeNull();
        expect(parseInterval("300")).toBe(300);
        expect(parseInterval("3600")).toBe(3600);
        expect(parseInterval("86400")).toBe(86400);
        expect(parseInterval("60")).toBeNull();
        expect(parseInterval("300.0")).toBeNull();
        expect(parseLimit(null)).toBe(50);
        expect(parseLimit("1")).toBe(1);
        expect(parseLimit("50")).toBe(50);
        expect(parseLimit("0")).toBeNull();
        expect(parseLimit("51")).toBeNull();
        expect(parseLimit("abc")).toBeNull();
        expect(parseBefore(null)).toBeUndefined();
        expect(parseBefore("1700000000")).toBe(1_700_000_000n);
        expect(parseBefore("-1")).toBeNull();
    });
});

describe("catch-up indexing options", () => {
    it("the cron defaults are unchanged (12 ranges, 40 s) and the catch-up is 1 range / 8 s", () => {
        expect(CRON_INDEX_OPTS).toEqual({maxRanges: 12, timeBudgetMs: 40_000});
        expect(CRON_INDEX_OPTS).toEqual({maxRanges: MAX_RANGES, timeBudgetMs: TIME_BUDGET_MS});
        expect(POKE_INDEX_OPTS).toEqual({maxRanges: 1, timeBudgetMs: 8_000});
    });
    it("runCron without options behaves like runCron with the cron defaults", async () => {
        const a = deps({next: 1000n, head: 1000n + 50_000n});
        const b = deps({next: 1000n, head: 1000n + 50_000n});
        const ra = await runCron("Bearer s3cret", "s3cret", a.d);
        const rb = await runCron("Bearer s3cret", "s3cret", b.d, CRON_INDEX_OPTS);
        expect(ra).toEqual(rb);
        expect(a.writes.map((w) => w.nextBlock)).toEqual(b.writes.map((w) => w.nextBlock));
    });
    it("indexOnce with the catch-up options writes at most one range", async () => {
        const {d, writes} = deps({next: 1000n, head: 1000n + 50_000n});
        const r = await indexOnce(d, POKE_INDEX_OPTS);
        expect(r.status).toBe(200);
        expect(writes.map((w) => w.nextBlock)).toEqual([10_000n]);
    });
});

describe("catch-up claim (handlePoke)", () => {
    /** In-memory stand-in for the one-statement claim: the row's poke_ts and the 20 s gap. */
    function claimDb(opts: {row?: boolean; missingColumnOnce?: boolean} = {}) {
        let pokeTs: number | null = null;
        let row = opts.row ?? true;
        let missing = opts.missingColumnOnce ?? false;
        const log: string[] = [];
        return {
            log,
            claim: async (now: number): Promise<PokeClaim> => {
                if (missing) throw Object.assign(new Error("column poke_ts does not exist"), {code: "42703"});
                if (!row) return "no_row";
                if (pokeTs === null || pokeTs <= now - POKE_GAP_SEC) {
                    pokeTs = now;
                    return "claimed";
                }
                return "throttled";
            },
            ensureSchema: async () => {
                log.push("ensureSchema");
                missing = false;
            },
            index: async () => {
                log.push("index");
                row = true;
                return {status: 200, body: {ok: true}};
            },
            indexedBlock: async () => "123",
        };
    }

    it("a second request within 20 s does not index (ran false); after 20 s it does", async () => {
        const db = claimDb();
        let ms = 1_000_000_000;
        const p = () => handlePoke({...db, nowMs: () => ms});
        expect(await p()).toEqual({indexedBlock: "123", ran: true});
        ms += 5_000;
        expect(await p()).toEqual({indexedBlock: "123", ran: false});
        ms += 14_000; // 19 s after the first
        expect((await p()).ran).toBe(false);
        ms += 1_000; // 20 s
        expect((await p()).ran).toBe(true);
        expect(db.log.filter((x) => x === "index")).toHaveLength(2);
    });
    it("no cursor row yet (just after a version switch): ensureSchema, then one run creates it", async () => {
        const db = claimDb({row: false});
        const r = await handlePoke({...db, nowMs: () => 0});
        expect(r.ran).toBe(true);
        expect(db.log).toEqual(["ensureSchema", "index"]);
    });
    it("a missing poke_ts column is migrated once and the claim retried", async () => {
        const db = claimDb({missingColumnOnce: true});
        expect((await handlePoke({...db, nowMs: () => 0})).ran).toBe(true);
        expect(db.log).toEqual(["ensureSchema", "index"]);
    });
    it("a failed index run is an error (the route answers 503), not a silent ran:false", async () => {
        const db = claimDb();
        await expect(handlePoke({...db, index: async () => ({status: 500, body: {ok: false}}), nowMs: () => 0})).rejects.toThrow(/catch-up index failed/);
    });
});

describe("chain API query parameters", () => {
    const q = (s: string) => new URLSearchParams(s);
    it("unknown parameters are rejected", () => {
        expect(paramsAllowed(q("curve=0x1&zzz=1"), ["curve", "before", "limit"])).toBe(false);
        expect(paramsAllowed(q("curve=0x1&before=5&limit=10"), ["curve", "before", "limit"])).toBe(true);
        expect(paramsAllowed(q(""), ["curve"])).toBe(true);
    });
    it("v must be a digit string of at most 20 characters", () => {
        expect(paramsAllowed(q("curve=0x1&v=41419458"), ["curve"])).toBe(true);
        expect(paramsAllowed(q("v=" + "9".repeat(20)), [])).toBe(true);
        for (const bad of ["", "abc", "-1", "1.5", "9".repeat(21), "0x10"]) expect(paramsAllowed(q("v=" + bad), []), bad).toBe(false);
    });
});
