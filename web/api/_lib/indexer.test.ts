import {describe, expect, it} from "vitest";
import {encodeAbiParameters, encodeEventTopics, Hex} from "viem";
import {CurveFactoryAbi, CurveSaleAbi, MapaePoolV3Abi, MembershipTokenV3Abi} from "../../src/contracts/abisV3.js";
import type {RawLog} from "../../src/lib/activity.js";
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
    toCurveRows,
    toTradeRows,
    toTransferRows,
    TRANSFER_TOPIC,
} from "./indexer.js";

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
const T0 = {block: 100n, ts: 1_000};
const T1 = {block: 200n, ts: 1_100};

const raw = (address: A, topics: Hex[], data: Hex, block: bigint, i: number): RawLog => ({address, topics, data, blockNumber: block, logIndex: i, transactionHash: tx(Number(block) * 10 + i)});

function created(block: bigint): RawLog {
    const topics = encodeEventTopics({abi: CurveFactoryAbi, eventName: "CurveCreated", args: {dev: up(DEV), curve: up(CURVE), token: up(TOKEN)}}) as Hex[];
    const data = encodeAbiParameters([{type: "address"}, {type: "uint256"}, {type: "string"}, {type: "string"}], [addr(0x99), 2_000_000n * E18, "Horse", "HRN"]);
    return raw(FACTORY, topics, data, block, 0);
}
function buy(trader: A, isDev: boolean, quoteSpent: bigint, tokensOut: bigint, block: bigint, i: number): RawLog {
    const topics = encodeEventTopics({abi: CurveSaleAbi, eventName: "Buy", args: {trader}}) as Hex[];
    const data = encodeAbiParameters(Array(8).fill(null).map((_, k) => ({type: k === 0 ? "bool" : "uint256"})), [isDev, quoteSpent, tokensOut, 0n, 0n, 0n, 0n, 0n]);
    return raw(CURVE, topics, data, block, i);
}
function sell(trader: A, tokenIn: bigint, quoteOut: bigint, block: bigint, i: number): RawLog {
    const topics = encodeEventTopics({abi: CurveSaleAbi, eventName: "Sell", args: {trader}}) as Hex[];
    const data = encodeAbiParameters(Array(8).fill(null).map((_, k) => ({type: k === 0 ? "bool" : "uint256"})), [false, tokenIn, quoteOut, 0n, 0n, 0n, 0n, 0n]);
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
            {curve: CURVE, token: TOKEN, dev: DEV, quote: addr(0x99), virtualQuote: (2_000_000n * E18).toString(), name: "Horse", symbol: "HRN", createdBlock: "150", createdTs: "1050"},
        ]);
        expect(toCurveRows([created(150n)], addr(0xbad), T0, T1)).toEqual([]);
    });
    it("trades: Buy, Sell, Swapped both ways, Graduated links the pool, zero token amount skipped", () => {
        const known: KnownCurve[] = [{curve: CURVE, token: TOKEN, dev: DEV, pool: null}];
        const logs = [
            buy(up(ALICE), false, 3n * E18, 1000n * E18, 110n, 0),
            buy(DEV, true, E18, 0n, 111n, 0), // zero tokens: skipped
            sell(ALICE, 500n * E18, E18, 120n, 0),
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
        expect(byBlock["110"]).toMatchObject({venue: "curve", side: "buy", trader: ALICE, isDev: false, quoteAmount: (3n * E18).toString(), tokenAmount: (1000n * E18).toString(), priceWad: (3n * E18 / 1000n).toString(), ts: "1010"});
        expect(byBlock["120"]).toMatchObject({side: "sell", tokenAmount: (500n * E18).toString(), quoteAmount: E18.toString(), priceWad: (E18 / 500n).toString()});
        expect(byBlock["140"]).toMatchObject({venue: "pool", side: "buy", trader: ALICE, isDev: false, quoteAmount: (2n * E18).toString(), tokenAmount: (400n * E18).toString()});
        expect(byBlock["150"]).toMatchObject({venue: "pool", side: "sell", trader: DEV, isDev: true, tokenAmount: (100n * E18).toString(), quoteAmount: (E18 / 2n).toString()});
        expect(trades.every((t) => t.tx === t.tx.toLowerCase())).toBe(true);
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

function deps(over: {head?: bigint; next?: bigint | null; failAt?: number; nowStep?: number} = {}) {
    const calls: string[] = [];
    const writes: {nextBlock: bigint; trades: number}[] = [];
    let now = 0;
    let rangeNo = 0;
    const d: CronDeps = {
        db: {
            ensureSchema: async () => void calls.push("ensureSchema"),
            readNextBlock: async () => (calls.push("readNextBlock"), over.next === undefined ? null : over.next),
            loadCurves: async () => (calls.push("loadCurves"), [{curve: CURVE, token: TOKEN, dev: DEV, pool: null}]),
            writeRange: async (w) => void writes.push({nextBlock: w.nextBlock, trades: w.trades.length}),
        },
        rpc: {
            blockNumber: async () => (calls.push("blockNumber"), over.head ?? 20_010n),
            blockTime: async (n) => (calls.push("blockTime"), {block: n, ts: Number(n)}),
            getLogs: async (q) => {
                calls.push(`getLogs:${q.topics[0] === CURVE_CREATED_TOPIC ? "created" : q.topics[0] === TRANSFER_TOPIC ? "transfer" : q.topics[0] === ACTIVITY_TOPICS ? "activity" : "?"}`);
                if (q.topics[0] === ACTIVITY_TOPICS) {
                    rangeNo++;
                    if (over.failAt === rangeNo) throw new Error("rpc down");
                    return [buy(ALICE, false, E18, E18, q.fromBlock, 0)];
                }
                return [];
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
        expect(writes).toEqual([{nextBlock: 10_000n, trades: 1}]);
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
