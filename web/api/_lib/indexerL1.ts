// L1 offering indexer (W-T33; W-T40: every L1 factory). Pure logic (no DB, no RPC): log -> row conversion and the run
// over ranges with injected dependencies. Separate cursor row from L0 (L1_INDEXER_STATE_ID in db.ts);
// runs after L0 in the same cron call and catch-up request.
//
// getLogs per range (at most 3, plus address chunks of TRANSFER_CHUNK):
//   1) OfferingCreated of every L1 factory (one call, address list)
//   2) every known offering (and the ones created in 1) for its 8 events, one topic list
//   3) every known RedeemManager, Sponsorship and pool (pools listed in 2 included) for
//      RedeemableCreated, Redeemed, Sponsored and Swapped, one topic list
// A call with no address is skipped (an empty address list would read the whole chain).
// Topics and decoding come from the ABIs in src/contracts/abisV3L1.ts / abisV3.ts; no hand-written
// hashes. Rows are keyed by (tx, log_index) so reading a range again adds nothing.
import {decodeEventLog, encodeEventTopics, Hex} from "viem";
import {MapaeFactoryL1Abi, OfferingL1Abi, RedeemManagerL1Abi, SponsorshipL1Abi} from "../../src/contracts/abisV3L1.js";
import {MapaePoolV3Abi} from "../../src/contracts/abisV3.js";
import {BlockTime, interpolateTs, RawLog} from "../../src/lib/activity.js";
import {chunk, CronResult, HEAD_LAG, IndexOpts, planRanges, RANGE_SPAN, TRANSFER_CHUNK, ZERO_ADDR} from "./indexer.js";

export type Address = `0x${string}`;
const lc = (a: string) => a.toLowerCase() as Address;

type AnyAbi = readonly {type: string; name?: string}[];
const eventsOf = (abi: AnyAbi, names: readonly string[]) => abi.filter((x) => x.type === "event" && names.includes(x.name ?? "")) as never[];
const topicOf = (abi: readonly never[], name: string) =>
    encodeEventTopics({abi, eventName: name} as Parameters<typeof encodeEventTopics>[0])[0] as Hex;

const FACTORY_EVENTS = eventsOf(MapaeFactoryL1Abi, ["OfferingCreated"]);
export const OFFERING_EVENT_NAMES = ["Committed", "Cancelled", "Claimed", "Refunded", "RefundsEnabled", "Settled", "Listed", "ProceedsDistributed"] as const;
const OFFERING_EVENTS = eventsOf(OfferingL1Abi, OFFERING_EVENT_NAMES);
const REDEEM_EVENTS = eventsOf(RedeemManagerL1Abi, ["RedeemableCreated", "Redeemed"]);
const SPONSOR_EVENTS = eventsOf(SponsorshipL1Abi, ["Sponsored"]);
const POOL_EVENTS = eventsOf(MapaePoolV3Abi, ["Swapped"]);
const CHILD_EVENTS = [...REDEEM_EVENTS, ...SPONSOR_EVENTS, ...POOL_EVENTS] as never[];

export const OFFERING_CREATED_TOPIC = topicOf(FACTORY_EVENTS, "OfferingCreated");
export const OFFERING_TOPICS: Hex[] = OFFERING_EVENT_NAMES.map((n) => topicOf(OFFERING_EVENTS, n));
export const CHILD_TOPICS: Hex[] = [topicOf(REDEEM_EVENTS, "RedeemableCreated"), topicOf(REDEEM_EVENTS, "Redeemed"), topicOf(SPONSOR_EVENTS, "Sponsored"), topicOf(POOL_EVENTS, "Swapped")];

// ---------------------------------------------------------------------------------------------
// Rows (addresses lowercase, amounts as raw integer strings)
// ---------------------------------------------------------------------------------------------

export type OfferingRow = {
    offering: Address;
    /** the factory that emitted OfferingCreated */
    factory: Address;
    token: Address;
    creator: Address;
    redeemManager: Address;
    vesting: Address;
    /** zero address when created without sponsorship */
    sponsorship: Address;
    /** zero address for an offering without a lock (L0 tier) */
    proceedsLock: Address;
    name: string;
    symbol: string;
    createdBlock: string;
    createdTs: string;
};

/** Settled + Listed + ProceedsDistributed of one offering, merged into one update. */
export type SettlementRow = {
    offering: Address;
    settledBlock: string | null;
    settledTs: string | null;
    pool: Address | null;
    totalSold: string | null;
    totalRaised: string | null;
    platformProceeds: string | null;
    upfront: string | null;
    locked: string | null;
};

export type OfferingEventKind = "commit" | "cancel" | "claim" | "refund" | "refunds_enabled" | "redeemable_created" | "redeemed" | "sponsored";

export type OfferingEventRow = {
    tx: Hex;
    logIndex: number;
    offering: Address;
    kind: OfferingEventKind;
    actor: Address | null;
    amount: string | null;
    amount2: string | null;
    /** redeem item id; "target_missed" / "settle_timeout" for refunds_enabled (RefundsEnabled.emergency) */
    ref: string | null;
    /** sponsor message (Sponsored only) */
    message: string | null;
    block: string;
    ts: string;
};

export type SwapRow = {
    tx: Hex;
    logIndex: number;
    offering: Address;
    pool: Address;
    trader: Address;
    quoteIn: boolean;
    quoteAmount: string;
    tokenAmount: string;
    block: string;
    ts: string;
};

/** An offering as the indexer knows it (DB or this range's OfferingCreated / Listed). */
export type KnownOffering = {offering: Address; redeemManager: Address; sponsorship: Address | null; pool: Address | null};

const done = (l: RawLog): l is RawLog & {blockNumber: bigint; logIndex: number; transactionHash: Hex} =>
    l.blockNumber !== null && l.logIndex !== null && l.transactionHash !== null;
const tsStr = (block: bigint, a: BlockTime, b: BlockTime) => String(Math.round(interpolateTs(block, a, b)));

function decode(abi: readonly never[], l: RawLog): {eventName: string; args: Record<string, unknown>} | null {
    try {
        const ev = decodeEventLog({abi, data: l.data, topics: l.topics as [Hex, ...Hex[]]}) as unknown as {eventName: string; args: Record<string, unknown>};
        return ev;
    } catch {
        return null;
    }
}

/** OfferingCreated from the L1 factories -> offering rows without name and symbol (read from the
 *  token). A log from any other address is dropped. */
export function toOfferingRows(logs: readonly RawLog[], factories: readonly string[], a: BlockTime, b: BlockTime): Omit<OfferingRow, "name" | "symbol">[] {
    const out: Omit<OfferingRow, "name" | "symbol">[] = [];
    const ok = new Set(factories.map(lc));
    for (const l of logs) {
        if (!done(l) || !ok.has(lc(l.address))) continue;
        const ev = decode(FACTORY_EVENTS, l);
        if (!ev || ev.eventName !== "OfferingCreated") continue;
        const x = ev.args as Record<string, string>;
        out.push({
            offering: lc(x.offering),
            factory: lc(l.address),
            token: lc(x.token),
            creator: lc(x.creator),
            redeemManager: lc(x.redeemManager),
            vesting: lc(x.vesting),
            sponsorship: lc(x.sponsorship),
            proceedsLock: lc(x.proceedsLock),
            createdBlock: l.blockNumber.toString(),
            createdTs: tsStr(l.blockNumber, a, b),
        });
    }
    return out;
}

const str = (v: unknown) => (typeof v === "bigint" ? v.toString() : null);

/** Events of known offerings -> event rows and one merged settlement row per offering. */
export function toOfferingEventRows(logs: readonly RawLog[], known: ReadonlySet<string>, a: BlockTime, b: BlockTime): {events: OfferingEventRow[]; settlements: SettlementRow[]} {
    const events: OfferingEventRow[] = [];
    const settle = new Map<string, SettlementRow>();
    const s = (o: Address): SettlementRow => {
        let r = settle.get(o);
        if (!r) {
            r = {offering: o, settledBlock: null, settledTs: null, pool: null, totalSold: null, totalRaised: null, platformProceeds: null, upfront: null, locked: null};
            settle.set(o, r);
        }
        return r;
    };
    for (const l of logs) {
        if (!done(l) || !known.has(lc(l.address))) continue;
        const ev = decode(OFFERING_EVENTS, l);
        if (!ev) continue;
        const o = lc(l.address);
        const x = ev.args;
        const row = (kind: OfferingEventKind, actor: unknown, amount: unknown, amount2: unknown = undefined, ref: string | null = null): OfferingEventRow => ({
            tx: l.transactionHash.toLowerCase() as Hex,
            logIndex: l.logIndex,
            offering: o,
            kind,
            actor: typeof actor === "string" ? lc(actor) : null,
            amount: str(amount),
            amount2: str(amount2),
            ref,
            message: null,
            block: l.blockNumber.toString(),
            ts: tsStr(l.blockNumber, a, b),
        });
        switch (ev.eventName) {
            case "Committed":
                events.push(row("commit", x.participant, x.amount, x.cumulative));
                break;
            case "Cancelled":
                events.push(row("cancel", x.participant, x.amount, x.cumulative));
                break;
            case "Claimed":
                events.push(row("claim", x.participant, x.allocation, x.refundAmount));
                break;
            case "Refunded":
                events.push(row("refund", x.participant, x.amount));
                break;
            case "RefundsEnabled":
                events.push(row("refunds_enabled", null, undefined, undefined, x.emergency ? "settle_timeout" : "target_missed"));
                break;
            case "Settled": {
                const r = s(o);
                r.settledBlock = l.blockNumber.toString();
                r.settledTs = tsStr(l.blockNumber, a, b);
                r.totalSold = str(x.totalSold);
                r.totalRaised = str(x.totalRaised);
                break;
            }
            case "Listed":
                s(o).pool = lc(x.pool as string);
                break;
            case "ProceedsDistributed": {
                const r = s(o);
                r.platformProceeds = str(x.platformProceeds);
                r.upfront = str(x.upfront);
                r.locked = str(x.locked);
                break;
            }
        }
    }
    return {events, settlements: [...settle.values()]};
}

/** Child contract -> its offering, for the known offerings (and pools listed in this range). */
export function childIndex(known: readonly KnownOffering[]): Map<string, {offering: Address; kind: "redeem" | "sponsor" | "pool"}> {
    const m = new Map<string, {offering: Address; kind: "redeem" | "sponsor" | "pool"}>();
    for (const k of known) {
        m.set(k.redeemManager, {offering: k.offering, kind: "redeem"});
        if (k.sponsorship && k.sponsorship !== ZERO_ADDR) m.set(k.sponsorship, {offering: k.offering, kind: "sponsor"});
        if (k.pool && k.pool !== ZERO_ADDR) m.set(k.pool, {offering: k.offering, kind: "pool"});
    }
    return m;
}

/** RedeemManager, Sponsorship and pool events -> event rows and swap rows. A log is kept only when
 *  its emitter is the matching child of a known offering. Swaps with a zero token amount are kept
 *  (the pool emitted them; they show as a trade with no price). */
export function toChildRows(logs: readonly RawLog[], children: ReadonlyMap<string, {offering: Address; kind: "redeem" | "sponsor" | "pool"}>, a: BlockTime, b: BlockTime): {events: OfferingEventRow[]; swaps: SwapRow[]} {
    const events: OfferingEventRow[] = [];
    const swaps: SwapRow[] = [];
    for (const l of logs) {
        if (!done(l)) continue;
        const c = children.get(lc(l.address));
        if (!c) continue;
        const ev = decode(c.kind === "redeem" ? REDEEM_EVENTS : c.kind === "sponsor" ? SPONSOR_EVENTS : POOL_EVENTS, l);
        if (!ev) continue;
        const x = ev.args;
        const base = {tx: l.transactionHash.toLowerCase() as Hex, logIndex: l.logIndex, offering: c.offering, block: l.blockNumber.toString(), ts: tsStr(l.blockNumber, a, b)};
        if (ev.eventName === "RedeemableCreated") {
            events.push({...base, kind: "redeemable_created", actor: lc(x.creator as string), amount: str(x.burnAmount), amount2: str(x.maxClaims), ref: str(x.id), message: null});
        } else if (ev.eventName === "Redeemed") {
            events.push({...base, kind: "redeemed", actor: lc(x.redeemer as string), amount: str(x.burnAmount), amount2: null, ref: str(x.id), message: null});
        } else if (ev.eventName === "Sponsored") {
            events.push({...base, kind: "sponsored", actor: lc(x.sponsor as string), amount: str(x.krwValue), amount2: str(x.tokensBurned), ref: null, message: typeof x.message === "string" ? x.message : null});
        } else if (ev.eventName === "Swapped") {
            const quoteIn = x.quoteIn === true;
            swaps.push({
                ...base,
                pool: lc(l.address),
                trader: lc(x.sender as string),
                quoteIn,
                quoteAmount: String(quoteIn ? x.amountIn : x.amountOut),
                tokenAmount: String(quoteIn ? x.amountOut : x.amountIn),
            });
        }
    }
    return {events, swaps};
}

// ---------------------------------------------------------------------------------------------
// Run (dependencies injected; the real ones are in cronDeps.ts)
// ---------------------------------------------------------------------------------------------

export type RangeWriteL1 = {
    offerings: OfferingRow[];
    settlements: SettlementRow[];
    events: OfferingEventRow[];
    swaps: SwapRow[];
    nextBlock: bigint;
    indexedTs: number;
};

export type L1Deps = {
    db: {
        readNextBlock(): Promise<bigint | null>;
        loadOfferings(): Promise<KnownOffering[]>;
        writeRange(w: RangeWriteL1): Promise<void>;
    };
    rpc: {
        blockNumber(): Promise<bigint>;
        blockTime(n: bigint): Promise<BlockTime>;
        getLogs(q: {fromBlock: bigint; toBlock: bigint; address?: string | string[]; topics: (Hex | Hex[])[]}): Promise<RawLog[]>;
        /** name() and symbol() of many tokens in one multicall (only ranges with new offerings). */
        tokenNames(tokens: readonly Address[]): Promise<Map<string, {name: string; symbol: string}>>;
    };
    nowMs(): number;
    /** every L1 MapaeFactory (L1_FACTORIES); OfferingCreated is read from all of them in one call */
    factories: readonly string[];
    deployBlock: bigint;
};

async function logsByAddress(deps: L1Deps, from: bigint, to: bigint, addrs: readonly string[], topics: Hex[]): Promise<RawLog[]> {
    const out: RawLog[] = [];
    // no address: no call (an empty filter would read every contract)
    for (const part of chunk([...new Set(addrs)], TRANSFER_CHUNK)) out.push(...(await deps.rpc.getLogs({fromBlock: from, toBlock: to, address: part, topics: [topics]})));
    return out;
}

/** One L1 indexing pass: ranges from the L1 cursor, same span, head lag and budget as L0. */
export async function indexL1Once(deps: L1Deps, opts: IndexOpts): Promise<CronResult> {
    const started = deps.nowMs();
    let next = (await deps.db.readNextBlock()) ?? deps.deployBlock;
    const head = (await deps.rpc.blockNumber()) - HEAD_LAG;
    if (next > head) return {status: 200, body: {ok: true, indexed: 0, next_block: next.toString()}};
    const known = new Map<string, KnownOffering>((await deps.db.loadOfferings()).map((k) => [k.offering, k]));
    const firstFrom = next;
    let lastTo: bigint | null = null;
    let ranges = 0;
    let events = 0;
    let swaps = 0;
    let offerings = 0;
    for (const [from, to] of planRanges(next, head, RANGE_SPAN, opts.maxRanges)) {
        if (ranges > 0 && deps.nowMs() - started > opts.timeBudgetMs) break;
        try {
            const [a, b] = await Promise.all([deps.rpc.blockTime(from), deps.rpc.blockTime(to)]);
            // 1) offerings created in this range (known before their own events are read)
            const created = toOfferingRows(await deps.rpc.getLogs({fromBlock: from, toBlock: to, address: [...deps.factories], topics: [OFFERING_CREATED_TOPIC]}), deps.factories, a, b);
            let names = new Map<string, {name: string; symbol: string}>();
            if (created.length > 0) names = await deps.rpc.tokenNames(created.map((c) => c.token));
            const newRows: OfferingRow[] = created.map((c) => ({...c, name: names.get(c.token)?.name ?? "", symbol: names.get(c.token)?.symbol ?? ""}));
            for (const c of created) {
                if (!known.has(c.offering)) known.set(c.offering, {offering: c.offering, redeemManager: c.redeemManager, sponsorship: c.sponsorship === ZERO_ADDR ? null : c.sponsorship, pool: null});
            }
            // 2) offering events (a Listed here makes its pool known for step 3)
            const offeringLogs = await logsByAddress(deps, from, to, [...known.keys()], OFFERING_TOPICS);
            const off = toOfferingEventRows(offeringLogs, new Set(known.keys()), a, b);
            for (const s of off.settlements) {
                const k = known.get(s.offering);
                if (k && s.pool) known.set(s.offering, {...k, pool: s.pool});
            }
            // 3) RedeemManager, Sponsorship and pool events
            const children = childIndex([...known.values()]);
            const child = toChildRows(await logsByAddress(deps, from, to, [...children.keys()], CHILD_TOPICS), children, a, b);
            const w: RangeWriteL1 = {offerings: newRows, settlements: off.settlements, events: [...off.events, ...child.events], swaps: child.swaps, nextBlock: to + 1n, indexedTs: b.ts};
            await deps.db.writeRange(w);
            next = to + 1n;
            lastTo = to;
            ranges++;
            events += w.events.length;
            swaps += w.swaps.length;
            offerings += newRows.length;
        } catch (e) {
            console.error("indexer L1 range failed", {from: from.toString(), to: to.toString()}, e);
            return {status: 500, body: {ok: false, next_block: next.toString()}};
        }
    }
    return {status: 200, body: {ok: true, from: firstFrom.toString(), to: lastTo?.toString() ?? null, ranges, offerings, events, swaps, next_block: next.toString()}};
}

/** L0 first, then L1. L0's result is returned as before; L1's is added under `l1`. An L1 failure
 *  (thrown or a non-200 result) is logged and never undoes or fails the L0 run. */
export async function withL1(l0: () => Promise<CronResult>, l1: () => Promise<CronResult>): Promise<CronResult> {
    const r = await l0();
    let l1Body: Record<string, unknown>;
    try {
        const x = await l1();
        if (x.status !== 200) console.error("indexer L1 failed", x.body);
        l1Body = x.body;
    } catch (e) {
        console.error("indexer L1 failed before indexing", e);
        l1Body = {ok: false, error: "failed"};
    }
    return {status: r.status, body: {...r.body, l1: l1Body}};
}
