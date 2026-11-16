import {describe, expect, it} from "vitest";
import {encodeAbiParameters, encodeEventTopics, Hex} from "viem";
import {MapaeFactoryL1Abi, OfferingL1Abi, RedeemManagerL1Abi, SponsorshipL1Abi} from "../../src/contracts/abisV3L1.js";
import {MapaePoolV3Abi} from "../../src/contracts/abisV3.js";
import type {RawLog} from "../../src/lib/activity.js";
import {
    CHILD_TOPICS,
    childIndex,
    indexL1Once,
    KnownOffering,
    L1Deps,
    OFFERING_CREATED_TOPIC,
    OFFERING_TOPICS,
    RangeWriteL1,
    toChildRows,
    toOfferingEventRows,
    toOfferingRows,
    withL1,
} from "./indexerL1.js";
import {CRON_INDEX_OPTS, POKE_INDEX_OPTS} from "./indexer.js";
import {ensureSchema, L1_INDEXER_STATE_ID, L1_PREV_STATE_ID, INDEXER_STATE_ID, l1IndexStart, l1Resume, offeringDetail, offeringFeed, offeringList, readNextBlockL1, Sql, writeRangeL1} from "./db.js";
import {parseFeed} from "../chain/offerings.js";
import {paramsAllowed} from "./chainApi.js";

type A = `0x${string}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as A;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const E18 = 10n ** 18n;
const FACTORY = addr(0xfac);
/** W-T40: a second L1 factory (the indexer reads both in one call) */
const FACTORY2 = addr(0xfac2);
const OFFERING2 = addr(0x0f2);
const OFFERING = addr(0x0f1);
const TOKEN = addr(0x70);
const CREATOR = addr(0xc0);
const RM = addr(0x5e1);
const VEST = addr(0x7e5);
const SP = addr(0x5b);
const LOCK = addr(0x10c);
const POOL = addr(0xb1);
const ALICE = addr(0xa1);
const BOB = addr(0xb0b);
const T0 = {block: 100n, ts: 1_000};
const T1 = {block: 200n, ts: 1_100};

const raw = (address: A, topics: Hex[], data: Hex, block: bigint, i: number, txn?: Hex): RawLog => ({address, topics, data, blockNumber: block, logIndex: i, transactionHash: txn ?? tx(Number(block) * 100 + i)});
const ev = (abi: readonly unknown[], eventName: string, args: Record<string, unknown>) => encodeEventTopics({abi, eventName, args} as never) as Hex[];
const data = (types: string[], values: unknown[]) => encodeAbiParameters(types.map((type) => ({type})), values);

function createdLog(block: bigint, sponsorship = SP, offering = OFFERING, token = TOKEN, factory: A = FACTORY, i = 0): RawLog {
    return raw(factory, ev(MapaeFactoryL1Abi, "OfferingCreated", {creator: CREATOR, offering, token}), data(["address", "address", "address", "address"], [RM, VEST, sponsorship, LOCK]), block, i);
}
const committed = (who: A, amount: bigint, cumulative: bigint, block: bigint, i: number, o = OFFERING) =>
    raw(o, ev(OfferingL1Abi, "Committed", {participant: who}), data(["uint256", "uint256"], [amount, cumulative]), block, i);
const cancelled = (who: A, amount: bigint, cumulative: bigint, block: bigint, i: number) =>
    raw(OFFERING, ev(OfferingL1Abi, "Cancelled", {participant: who}), data(["uint256", "uint256"], [amount, cumulative]), block, i);
const settled = (block: bigint, i: number) => raw(OFFERING, ev(OfferingL1Abi, "Settled", {allocationRoot: tx(1)}), data(["uint256", "uint256", "bytes32"], [50_000n * E18, 50_000_000n * E18, tx(2)]), block, i);
const listed = (block: bigint, i: number) => raw(OFFERING, ev(OfferingL1Abi, "Listed", {pool: POOL}), data(["uint256", "uint256", "uint256"], [1n, 2n, 3n]), block, i);
const distributed = (block: bigint, i: number) =>
    raw(OFFERING, ev(OfferingL1Abi, "ProceedsDistributed", {}), data(["uint256", "uint256", "uint256", "address"], [3_750_000n * E18, 10_000_000n * E18, 35_000_000n * E18, LOCK]), block, i);
const claimed = (who: A, block: bigint, i: number) => raw(OFFERING, ev(OfferingL1Abi, "Claimed", {participant: who}), data(["uint256", "uint256"], [7n * E18, 1n * E18]), block, i);
const refunded = (who: A, block: bigint, i: number) => raw(OFFERING, ev(OfferingL1Abi, "Refunded", {participant: who}), data(["uint256"], [5n]), block, i);
const refundsEnabled = (emergency: boolean, block: bigint, i: number) => raw(OFFERING, ev(OfferingL1Abi, "RefundsEnabled", {}), data(["bool"], [emergency]), block, i);
const redeemable = (id: bigint, block: bigint, i: number) => raw(RM, ev(RedeemManagerL1Abi, "RedeemableCreated", {id, creator: CREATOR}), data(["uint256", "uint256", "uint256"], [10n * E18, 100n, 0n]), block, i);
const redeemed = (id: bigint, who: A, block: bigint, i: number) => raw(RM, ev(RedeemManagerL1Abi, "Redeemed", {id, redeemer: who}), data(["uint256"], [10n * E18]), block, i);
const sponsored = (who: A, block: bigint, i: number) =>
    raw(SP, ev(SponsorshipL1Abi, "Sponsored", {sponsor: who, messageHash: tx(9)}), data(["bool", "uint256", "uint256", "uint256", "uint256", "string"], [true, 1000n, 1000n, 3n, 900n, "응원해요"]), block, i);
const swapped = (who: A, quoteIn: boolean, amountIn: bigint, amountOut: bigint, block: bigint, i: number) =>
    raw(POOL, ev(MapaePoolV3Abi, "Swapped", {sender: who, to: who}), data(["bool", "uint256", "uint256", "uint256"], [quoteIn, amountIn, amountOut, 0n]), block, i);

const KNOWN: KnownOffering = {offering: OFFERING, redeemManager: RM, sponsorship: SP, pool: POOL};

describe("L1 rows", () => {
    it("OfferingCreated -> offering row, lowercase, zero sponsorship kept as zero", () => {
        const rows = toOfferingRows([createdLog(150n), createdLog(160n, addr(0))], [FACTORY], T0, T1);
        expect(rows[0]).toEqual({offering: OFFERING, factory: FACTORY, token: TOKEN, creator: CREATOR, redeemManager: RM, vesting: VEST, sponsorship: SP, proceedsLock: LOCK, createdBlock: "150", createdTs: "1050"});
        expect(rows[1].sponsorship).toBe(addr(0));
        // another emitter is ignored
        expect(toOfferingRows([{...createdLog(150n), address: addr(0xbad)}], [FACTORY, FACTORY2], T0, T1)).toEqual([]);
    });
    it("W-T40: OfferingCreated of both factories, each row carries its own factory", () => {
        const rows = toOfferingRows([createdLog(150n), createdLog(151n, SP, OFFERING2, addr(0x71), FACTORY2)], [FACTORY, FACTORY2], T0, T1);
        expect(rows.map((r) => [r.offering, r.factory])).toEqual([[OFFERING, FACTORY], [OFFERING2, FACTORY2]]);
    });
    it("offering events by kind (commit, cancel, claim, refund, refunds_enabled)", () => {
        const {events} = toOfferingEventRows(
            [committed(ALICE, 300n, 300n, 110n, 0), cancelled(ALICE, 100n, 200n, 120n, 1), claimed(ALICE, 130n, 2), refunded(BOB, 140n, 3), refundsEnabled(true, 150n, 4), refundsEnabled(false, 151n, 5)],
            new Set([OFFERING]),
            T0,
            T1
        );
        expect(events.map((e) => [e.kind, e.actor, e.amount, e.amount2, e.ref])).toEqual([
            ["commit", ALICE, "300", "300", null],
            ["cancel", ALICE, "100", "200", null],
            ["claim", ALICE, (7n * E18).toString(), E18.toString(), null],
            ["refund", BOB, "5", null, null],
            ["refunds_enabled", null, null, null, "settle_timeout"],
            ["refunds_enabled", null, null, null, "target_missed"],
        ]);
        expect(events.every((e) => e.offering === OFFERING && e.tx === e.tx.toLowerCase())).toBe(true);
        expect(events[0].ts).toBe("1010");
    });
    it("Settled, Listed and ProceedsDistributed merge into ONE settlement row", () => {
        const {events, settlements} = toOfferingEventRows([settled(180n, 0), listed(180n, 1), distributed(180n, 2)], new Set([OFFERING]), T0, T1);
        expect(events).toEqual([]);
        expect(settlements).toEqual([
            {
                offering: OFFERING,
                settledBlock: "180",
                settledTs: "1080",
                pool: POOL,
                totalSold: (50_000n * E18).toString(),
                totalRaised: (50_000_000n * E18).toString(),
                platformProceeds: (3_750_000n * E18).toString(),
                upfront: (10_000_000n * E18).toString(),
                locked: (35_000_000n * E18).toString(),
            },
        ]);
    });
    it("events of unknown offerings are dropped", () => {
        expect(toOfferingEventRows([committed(ALICE, 1n, 1n, 110n, 0, addr(0x999))], new Set([OFFERING]), T0, T1).events).toEqual([]);
    });
    it("child rows: redeem items, redeems, sponsorships (with message) and swaps both ways", () => {
        const {events, swaps} = toChildRows(
            [redeemable(7n, 110n, 0), redeemed(7n, ALICE, 120n, 1), sponsored(BOB, 130n, 2), swapped(ALICE, true, 10_000n, 8n, 140n, 3), swapped(BOB, false, 5n, 4_000n, 150n, 4)],
            childIndex([KNOWN]),
            T0,
            T1
        );
        expect(events.map((e) => [e.kind, e.actor, e.amount, e.amount2, e.ref, e.message, e.offering])).toEqual([
            ["redeemable_created", CREATOR, (10n * E18).toString(), "100", "7", null, OFFERING],
            ["redeemed", ALICE, (10n * E18).toString(), null, "7", null, OFFERING],
            ["sponsored", BOB, "1000", "3", null, "응원해요", OFFERING],
        ]);
        expect(swaps.map((s) => [s.trader, s.quoteIn, s.quoteAmount, s.tokenAmount, s.pool, s.offering])).toEqual([
            [ALICE, true, "10000", "8", POOL, OFFERING],
            [BOB, false, "4000", "5", POOL, OFFERING],
        ]);
    });
    it("a Swapped from a contract that is not the offering's pool is ignored; no sponsorship -> no sponsor child", () => {
        const idx = childIndex([{...KNOWN, sponsorship: null, pool: null}]);
        expect([...idx.keys()]).toEqual([RM]);
        expect(toChildRows([swapped(ALICE, true, 1n, 1n, 140n, 0), sponsored(BOB, 130n, 1)], idx, T0, T1)).toEqual({events: [], swaps: []});
    });
    it("topics come from the ABIs: 1 + 8 + 4, all distinct", () => {
        const all = [OFFERING_CREATED_TOPIC, ...OFFERING_TOPICS, ...CHILD_TOPICS];
        expect(all).toHaveLength(13);
        expect(new Set(all).size).toBe(13);
    });
});

/** In-memory deps: logs by address, a DB that keeps rows keyed like the real tables. */
function deps(o: {logs?: RawLog[]; next?: bigint | null; head?: bigint; failNames?: boolean; known?: KnownOffering[]} = {}) {
    const calls: string[] = [];
    const writes: RangeWriteL1[] = [];
    const logs = o.logs ?? [];
    const d: L1Deps = {
        db: {
            readNextBlock: async () => (calls.push("readNextBlock"), o.next === undefined ? null : o.next),
            loadOfferings: async () => (calls.push("loadOfferings"), o.known ?? []),
            writeRange: async (w) => {
                calls.push("writeRange");
                writes.push(w);
            },
        },
        rpc: {
            blockNumber: async () => (calls.push("blockNumber"), o.head ?? 1_009n),
            blockTime: async (n) => (calls.push("blockTime"), {block: n, ts: Number(n)}),
            getLogs: async (q) => {
                const addrs = ([] as string[]).concat(q.address ?? []).map((x) => x.toLowerCase());
                const topics = ([] as Hex[]).concat(q.topics[0] as Hex | Hex[]);
                calls.push(`getLogs:${addrs.length}`);
                return logs.filter((l) => l.blockNumber! >= q.fromBlock && l.blockNumber! <= q.toBlock && addrs.includes(l.address.toLowerCase()) && topics.includes(l.topics[0]));
            },
            tokenNames: async (tokens) => {
                calls.push("tokenNames");
                if (o.failNames) throw new Error("rpc");
                return new Map(tokens.map((t) => [t, {name: "노들 프로토콜", symbol: "NODL"}]));
            },
        },
        nowMs: () => 0,
        factories: [FACTORY2, FACTORY],
        deployBlock: 1_000n,
    };
    return {d, calls, writes};
}

describe("indexL1Once", () => {
    it("starts at the deployment block; an offering created in a range has its events, redeem items and pool swaps read in the SAME range", async () => {
        const logs = [createdLog(1_000n), committed(ALICE, 300n, 300n, 1_001n, 0), redeemable(1n, 1_001n, 1), settled(1_002n, 0), listed(1_002n, 1), distributed(1_002n, 2), swapped(BOB, true, 10n, 1n, 1_003n, 0)];
        const {d, calls, writes} = deps({logs, head: 1_013n});
        const r = await indexL1Once(d, CRON_INDEX_OPTS);
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ok: true, from: "1000", to: "1003", ranges: 1, offerings: 1, next_block: "1004"});
        // 2 headers, OfferingCreated (both factories, one call), names (new offering), offerings, children: 3 getLogs
        expect(calls).toEqual(["readNextBlock", "blockNumber", "loadOfferings", "blockTime", "blockTime", "getLogs:2", "tokenNames", "getLogs:1", "getLogs:3", "writeRange"]);
        const w = writes[0];
        expect(w.offerings.map((x) => [x.offering, x.name, x.symbol])).toEqual([[OFFERING, "노들 프로토콜", "NODL"]]);
        expect(w.events.map((e) => e.kind)).toEqual(["commit", "redeemable_created"]);
        expect(w.settlements[0]).toMatchObject({pool: POOL, upfront: (10_000_000n * E18).toString()});
        expect(w.swaps).toHaveLength(1);
        expect(w.nextBlock).toBe(1_004n);
    });
    it("no known offering and none created: only OfferingCreated is read (no address-less getLogs)", async () => {
        const {d, calls} = deps({head: 1_013n});
        await indexL1Once(d, CRON_INDEX_OPTS);
        expect(calls.filter((c) => c.startsWith("getLogs"))).toEqual(["getLogs:2"]);
    });
    it("reading the same range again produces the same keyed rows (idempotent writes)", async () => {
        const logs = [createdLog(1_000n), committed(ALICE, 300n, 300n, 1_001n, 0)];
        const a = deps({logs, head: 1_013n});
        await indexL1Once(a.d, CRON_INDEX_OPTS);
        const b = deps({logs, head: 1_013n, known: [{offering: OFFERING, redeemManager: RM, sponsorship: SP, pool: null}]});
        await indexL1Once(b.d, CRON_INDEX_OPTS);
        const keys = (w: RangeWriteL1) => w.events.map((e) => `${e.tx}:${e.logIndex}`);
        expect(keys(b.writes[0])).toEqual(keys(a.writes[0]));
        // a table keyed by (tx, log_index) with DO NOTHING keeps one row per key
        const table = new Map<string, unknown>();
        for (const w of [...a.writes, ...b.writes]) for (const e of w.events) if (!table.has(`${e.tx}:${e.logIndex}`)) table.set(`${e.tx}:${e.logIndex}`, e);
        expect(table.size).toBe(1);
    });
    it("caught up: nothing read", async () => {
        const {d, calls} = deps({next: 2_000n, head: 2_005n});
        expect((await indexL1Once(d, CRON_INDEX_OPTS)).body).toMatchObject({ok: true, indexed: 0});
        expect(calls).toEqual(["readNextBlock", "blockNumber"]);
    });
    it("a failing range stops there and does not advance the cursor", async () => {
        const {d, writes} = deps({logs: [createdLog(1_000n)], head: 1_013n, failNames: true});
        const r = await indexL1Once(d, CRON_INDEX_OPTS);
        expect(r).toEqual({status: 500, body: {ok: false, next_block: "1000"}});
        expect(writes).toEqual([]);
    });
    it("catch-up runs one range at most", async () => {
        const {d, writes} = deps({head: 1_000n + 30_000n});
        await indexL1Once(d, POKE_INDEX_OPTS);
        expect(writes).toHaveLength(1);
    });
    it("W-T40: one range with OfferingCreated of both factories: both offerings and their commits go in; reading it again adds no row", async () => {
        const logs = [createdLog(1_000n), createdLog(1_000n, SP, OFFERING2, addr(0x71), FACTORY2, 1), committed(ALICE, 300n, 300n, 1_001n, 0), committed(BOB, 200n, 200n, 1_001n, 1, OFFERING2)];
        const a = deps({logs, head: 1_013n});
        await indexL1Once(a.d, CRON_INDEX_OPTS);
        // OfferingCreated: one getLogs over the two factories (same count per range as one factory)
        expect(a.calls.filter((c) => c.startsWith("getLogs"))[0]).toBe("getLogs:2");
        expect(a.writes[0].offerings.map((o) => [o.offering, o.factory])).toEqual([[OFFERING, FACTORY], [OFFERING2, FACTORY2]]);
        expect(a.writes[0].events.map((e) => [e.offering, e.actor])).toEqual([[OFFERING, ALICE], [OFFERING2, BOB]]);
        // the same range again (both offerings now known): same keys, so keyed tables keep one row each
        const b = deps({logs, head: 1_013n, known: [{offering: OFFERING, redeemManager: RM, sponsorship: SP, pool: null}, {offering: OFFERING2, redeemManager: RM, sponsorship: SP, pool: null}]});
        await indexL1Once(b.d, CRON_INDEX_OPTS);
        const offeringsTable = new Map<string, unknown>();
        const eventsTable = new Map<string, unknown>();
        for (const w of [...a.writes, ...b.writes]) {
            for (const o of w.offerings) if (!offeringsTable.has(o.offering)) offeringsTable.set(o.offering, o);
            for (const e of w.events) if (!eventsTable.has(`${e.tx}:${e.logIndex}`)) eventsTable.set(`${e.tx}:${e.logIndex}`, e);
        }
        expect(offeringsTable.size).toBe(2);
        expect(eventsTable.size).toBe(2);
    });
    it("100 offerings still cost 3 getLogs per range (address lists, chunked at 200)", async () => {
        const known = Array.from({length: 100}, (_, i) => ({offering: addr(0x1000 + i), redeemManager: addr(0x2000 + i), sponsorship: addr(0x3000 + i), pool: addr(0x4000 + i)}));
        const {d, calls} = deps({head: 1_013n, known});
        await indexL1Once(d, CRON_INDEX_OPTS);
        // offerings: 100 addresses (1 call); children: 300 addresses (2 calls of <= 200)
        expect(calls.filter((c) => c.startsWith("getLogs"))).toEqual(["getLogs:2", "getLogs:100", "getLogs:200", "getLogs:100"]);
    });
});

describe("L0 then L1", () => {
    it("L1 runs after L0 and its failure never changes L0's status", async () => {
        const order: string[] = [];
        const ok = await withL1(async () => (order.push("l0"), {status: 200, body: {ok: true, ranges: 1}}), async () => (order.push("l1"), {status: 500, body: {ok: false, next_block: "5"}}));
        expect(order).toEqual(["l0", "l1"]);
        expect(ok).toEqual({status: 200, body: {ok: true, ranges: 1, l1: {ok: false, next_block: "5"}}});
        const thrown = await withL1(async () => ({status: 200, body: {ok: true}}), async () => {
            throw new Error("db");
        });
        expect(thrown).toEqual({status: 200, body: {ok: true, l1: {ok: false, error: "failed"}}});
    });
});

/** SQL recorder: answers each statement with `answer(text)`. */
function recorder(answer: (q: string, p: unknown[]) => unknown[] = () => []) {
    const qs: {q: string; p: unknown[]}[] = [];
    const sql = {
        query: (q: string, p: unknown[] = []) => {
            qs.push({q, p});
            return Promise.resolve(answer(q, p));
        },
        transaction: async (xs: Promise<unknown>[]) => Promise.all(xs),
    } as unknown as Sql;
    return {sql, qs};
}

describe("W-T40: L1 cursor row 133", () => {
    it("row 133 continues; without it, row 132's position or the v3.3-L1 deployment block, whichever is earlier", async () => {
        expect(L1_INDEXER_STATE_ID).toBe(133);
        expect(L1_PREV_STATE_ID).toBe(132);
        expect(l1Resume(41_520_000n, 41_530_000n, 41_506_506n)).toBe(41_520_000n);
        // row 132 already past the new factory: start at its deployment (no OfferingCreated missed)
        expect(l1Resume(null, 41_530_000n, 41_506_506n)).toBe(41_506_506n);
        // row 132 behind it: continue from row 132 (no block of either factory skipped)
        expect(l1Resume(null, 41_500_000n, 41_506_506n)).toBe(41_500_000n);
        // empty database: the indexer starts at the oldest L1 deployment
        expect(l1Resume(null, null, 41_506_506n)).toBeNull();
        expect(l1IndexStart()).toBe(41_489_012n);
        const {sql} = recorder(() => [{id: 132, n: "41530000"}]);
        expect(await readNextBlockL1(sql)).toBe(41_506_506n);
        const empty = recorder(() => []);
        expect(await readNextBlockL1(empty.sql)).toBeNull();
    });
    it("schema: factory column, old rows filled with the v3.2-L1 factory; list and detail return it", async () => {
        const {sql, qs} = recorder();
        await ensureSchema(sql);
        expect(qs.some((x) => x.q === "ALTER TABLE mapae_offerings ADD COLUMN IF NOT EXISTS factory text")).toBe(true);
        expect(qs.find((x) => x.q.startsWith("UPDATE mapae_offerings SET factory"))!.q).toBe("UPDATE mapae_offerings SET factory = '0xa9ca0c10cd6b6398679b578dce192cb4caa5bc71' WHERE factory IS NULL");
        const l = recorder();
        await offeringList(l.sql);
        expect(l.qs[0].q).toContain("o.factory");
        const w = recorder();
        await writeRangeL1(w.sql, {offerings: [{offering: OFFERING, factory: FACTORY2, token: TOKEN, creator: CREATOR, redeemManager: RM, vesting: VEST, sponsorship: SP, proceedsLock: LOCK, name: "a", symbol: "A", createdBlock: "1", createdTs: "2"}], settlements: [], events: [], swaps: [], nextBlock: 5n, indexedTs: 9});
        const ins = w.qs.find((x) => x.q.includes("INSERT INTO mapae_offerings"))!;
        expect(ins.q).toContain("created_ts, factory)");
        expect(ins.p[11]).toEqual([FACTORY2]);
    });
});

describe("db: L1 tables and cursor", () => {
    it("own cursor row, never the L0 row", async () => {
        expect(L1_INDEXER_STATE_ID).not.toBe(INDEXER_STATE_ID);
        const {sql, qs} = recorder(() => [{id: 133, n: "41510000"}, {id: 132, n: "41509000"}]);
        expect(await readNextBlockL1(sql)).toBe(41_510_000n);
        expect(qs[0].p).toEqual([[L1_INDEXER_STATE_ID, L1_PREV_STATE_ID]]);
        const w = recorder();
        await writeRangeL1(w.sql, {offerings: [], settlements: [], events: [], swaps: [], nextBlock: 5n, indexedTs: 9});
        const state = w.qs.find((x) => x.q.includes("mapae_indexer_state"))!;
        expect(state.p).toEqual(["5", "9", L1_INDEXER_STATE_ID]);
        // swaps go to their own table, not mapae_trades
        expect(w.qs.some((x) => x.q.includes("mapae_trades"))).toBe(false);
        expect(w.qs.some((x) => x.q.includes("INSERT INTO mapae_offering_swaps"))).toBe(true);
        // idempotent inserts and COALESCE settlement updates
        expect(w.qs.filter((x) => x.q.includes("ON CONFLICT (tx, log_index) DO NOTHING"))).toHaveLength(2);
        expect(w.qs.find((x) => x.q.includes("UPDATE mapae_offerings"))!.q).toContain("COALESCE(u.up, m.upfront)");
    });
    it("list: one statement for every offering (participants from the last cumulative per wallet)", async () => {
        const {sql, qs} = recorder();
        await offeringList(sql);
        expect(qs).toHaveLength(1);
        expect(qs[0].q).toContain("DISTINCT ON (offering, actor)");
        expect(qs[0].q).toContain("FILTER (WHERE cumulative > 0)");
    });
    it("detail: three statements whatever the number of wallets or items; feeds: 50 newest before a block", async () => {
        const {sql, qs} = recorder();
        await offeringDetail(sql, OFFERING);
        expect(qs).toHaveLength(3);
        const f = recorder();
        await offeringFeed(f.sql, OFFERING, "commits", 123n);
        expect(f.qs[0].p).toEqual([OFFERING, ["commit", "cancel"], "123", 50]);
        expect(f.qs[0].q).toContain("block < $3::bigint");
        expect(f.qs[0].q).toContain("ORDER BY block DESC, log_index DESC");
        const s = recorder();
        await offeringFeed(s.sql, OFFERING, "swaps", undefined);
        expect(s.qs[0].q).toContain("FROM mapae_offering_swaps");
    });
});

describe("GET /api/chain/offerings params", () => {
    it("only offering, feed, before and v", () => {
        const ok = (q: string) => paramsAllowed(new URLSearchParams(q), ["offering", "feed", "before"]);
        expect(ok(`offering=${OFFERING}&feed=commits&v=41491999`)).toBe(true);
        expect(ok(`offering=${OFFERING}&feed=commits&x=1`)).toBe(false);
        expect(parseFeed("swaps")).toBe("swaps");
        expect(parseFeed("trades")).toBeNull();
        expect(parseFeed(null)).toBeUndefined();
    });
});
