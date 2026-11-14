// Pure activity logic (no React, no RPC): log decoding, time interpolation, the retention cap,
// per-curve aggregation, market cap comparison and the six list sort orders. Tested in
// activity.test.ts. Amounts are raw 18-decimals bigints; nothing is converted to floating point.
import {decodeEventLog, encodeEventTopics, Hex} from "viem";
import {CurveSaleAbi, MapaePoolV3Abi} from "../contracts/abisV3.js"; // .js: also imported by Vercel Functions (ESM)
import {marketCapQuote, progressBps, TOTAL_SUPPLY, WAD} from "./curveMath.js";

type Address = `0x${string}`;
const lc = (a: string) => a.toLowerCase();

/** Retained activity entries (newest first); older ones are dropped. */
export const ACTIVITY_CAP = 2_000;
/** First load reads [latest - INITIAL_SPAN, latest]; the RPC allows at most 10,000 blocks per getLogs. */
export const INITIAL_SPAN = 9_000n;

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

const EVENTS = [
    ...CurveSaleAbi.filter((x) => x.type === "event" && (x.name === "Buy" || x.name === "Sell" || x.name === "Graduated")),
    ...MapaePoolV3Abi.filter((x) => x.type === "event" && x.name === "Swapped"),
] as const;

const topic0 = (name: "Buy" | "Sell" | "Graduated" | "Swapped") =>
    encodeEventTopics({abi: EVENTS, eventName: name} as Parameters<typeof encodeEventTopics>[0])[0] as Hex;

/** topics[0] OR-list for the single getLogs call (no address filter). */
export const ACTIVITY_TOPICS: Hex[] = [topic0("Buy"), topic0("Sell"), topic0("Swapped"), topic0("Graduated")];

/** A raw log as returned by eth_getLogs (only the fields used here). */
export type RawLog = {address: Address; topics: readonly Hex[]; data: Hex; blockNumber: bigint | null; logIndex: number | null; transactionHash: Hex | null};

/** Decoded, chain-level entry. Not yet tied to a curve: that happens in `resolve`, against the
 *  curve list known at read time (so a curve created after the fetch is still matched). */
export type Entry =
    | {kind: "Buy"; emitter: Address; trader: Address; isDev: boolean; quoteSpent: bigint; tokensOut: bigint; fees: bigint; block: bigint; logIndex: number; tx: Hex}
    | {kind: "Sell"; emitter: Address; trader: Address; isDev: boolean; tokenIn: bigint; quoteOut: bigint; fees: bigint; block: bigint; logIndex: number; tx: Hex}
    | {kind: "Swapped"; emitter: Address; to: Address; quoteIn: boolean; amountIn: bigint; amountOut: bigint; royalty: bigint; block: bigint; logIndex: number; tx: Hex}
    | {kind: "Graduated"; emitter: Address; pool: Address; block: bigint; logIndex: number; tx: Hex};

/** Decode logs whose topic0 is one of ACTIVITY_TOPICS; anything else (or pending logs) is skipped. */
export function decodeActivityLogs(logs: readonly RawLog[]): Entry[] {
    const out: Entry[] = [];
    for (const l of logs) {
        if (l.blockNumber === null || l.logIndex === null || l.transactionHash === null) continue;
        let ev;
        try {
            ev = decodeEventLog({abi: EVENTS, data: l.data, topics: l.topics as [Hex, ...Hex[]]});
        } catch {
            continue; // same topic0 but a different layout: not one of ours
        }
        const base = {emitter: lc(l.address) as Address, block: l.blockNumber, logIndex: l.logIndex, tx: l.transactionHash};
        const a = ev.args as Record<string, unknown>;
        if (ev.eventName === "Buy") {
            out.push({
                ...base,
                kind: "Buy",
                trader: lc(a.trader as string) as Address,
                isDev: a.isDev as boolean,
                quoteSpent: a.quoteSpent as bigint,
                tokensOut: a.tokensOut as bigint,
                fees: (a.platformFee as bigint) + (a.devFee as bigint) + (a.lpSeedFee as bigint),
            });
        } else if (ev.eventName === "Sell") {
            out.push({
                ...base,
                kind: "Sell",
                trader: lc(a.trader as string) as Address,
                isDev: a.isDev as boolean,
                tokenIn: a.tokenIn as bigint,
                quoteOut: a.quoteOut as bigint,
                fees: (a.platformFee as bigint) + (a.devFee as bigint) + (a.lpSeedFee as bigint),
            });
        } else if (ev.eventName === "Swapped") {
            out.push({
                ...base,
                kind: "Swapped",
                to: lc(a.to as string) as Address,
                quoteIn: a.quoteIn as boolean,
                amountIn: a.amountIn as bigint,
                amountOut: a.amountOut as bigint,
                royalty: a.royalty as bigint,
            });
        } else if (ev.eventName === "Graduated") {
            out.push({...base, kind: "Graduated", pool: lc(a.pool as string) as Address});
        }
    }
    return out;
}

const entryKey = (e: {tx: Hex; logIndex: number}) => `${e.tx}:${e.logIndex}`;
const newerFirst = (a: {block: bigint; logIndex: number}, b: {block: bigint; logIndex: number}) =>
    a.block === b.block ? b.logIndex - a.logIndex : a.block > b.block ? -1 : 1;

/** Merge new entries into the retained list: dedupe by tx:logIndex, newest first, keep `cap`. */
export function mergeEntries<T extends {tx: Hex; logIndex: number; block: bigint}>(existing: readonly T[], incoming: readonly T[], cap = ACTIVITY_CAP): T[] {
    const seen = new Set<string>();
    const all: T[] = [];
    for (const e of [...incoming, ...existing]) {
        const k = entryKey(e);
        if (seen.has(k)) continue;
        seen.add(k);
        all.push(e);
    }
    return all.sort(newerFirst).slice(0, cap);
}

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

export type BlockTime = {block: bigint; ts: number};

/** Estimated unix time of `block`, linear between two known blocks (no per-log block lookup). */
export function interpolateTs(block: bigint, a: BlockTime, b: BlockTime): number {
    if (b.block === a.block) return b.ts;
    const span = Number(b.block - a.block);
    return a.ts + (Number(block - a.block) * (b.ts - a.ts)) / span;
}

/** Whole hours covered by [from, to] (at least 1), for the "last ~N hours" caption. */
export function coverageHours(from: BlockTime, to: BlockTime): number {
    return Math.max(1, Math.round((to.ts - from.ts) / 3600));
}

// ---------------------------------------------------------------------------------------------
// Curves ↔ entries
// ---------------------------------------------------------------------------------------------

/** The curve fields this module needs. `index` = position in allCurves (higher = newer). */
export type CurveRef = {address: Address; pool: Address; dev: Address; index: number};

/** One trade tied to a curve, in display form. */
export type Trade = {
    curve: Address;
    venue: "curve" | "pool";
    side: "buy" | "sell";
    trader: Address;
    isDev: boolean;
    tokenAmount: bigint;
    /** Pair asset amount shown to the user: paid on a buy, received on a sell. */
    quoteAmount: bigint;
    /** Pair asset volume including fees (see `volumeOf`). */
    volume: bigint;
    block: bigint;
    logIndex: number;
    tx: Hex;
};

const ZERO = "0x0000000000000000000000000000000000000000";

/** Tie entries to known curves (curve address for Buy/Sell/Graduated, pool address for Swapped).
 *  Entries from unknown emitters are dropped. Also returns the graduation block per curve. */
export function resolve(entries: readonly Entry[], curves: readonly CurveRef[]): {trades: Trade[]; graduatedAt: Map<Address, bigint>} {
    const byCurve = new Map<string, CurveRef>();
    const byPool = new Map<string, CurveRef>();
    for (const c of curves) {
        byCurve.set(lc(c.address), c);
        if (lc(c.pool) !== ZERO) byPool.set(lc(c.pool), c);
    }
    const trades: Trade[] = [];
    const graduatedAt = new Map<Address, bigint>();
    for (const e of entries) {
        if (e.kind === "Graduated") {
            const c = byCurve.get(e.emitter);
            if (c) graduatedAt.set(c.address, e.block);
            continue;
        }
        const pos = {block: e.block, logIndex: e.logIndex, tx: e.tx};
        if (e.kind === "Buy" || e.kind === "Sell") {
            const c = byCurve.get(e.emitter);
            if (!c) continue;
            trades.push(
                e.kind === "Buy"
                    ? {...pos, curve: c.address, venue: "curve", side: "buy", trader: e.trader, isDev: e.isDev, tokenAmount: e.tokensOut, quoteAmount: e.quoteSpent, volume: e.quoteSpent}
                    : {...pos, curve: c.address, venue: "curve", side: "sell", trader: e.trader, isDev: e.isDev, tokenAmount: e.tokenIn, quoteAmount: e.quoteOut, volume: e.quoteOut + e.fees}
            );
            continue;
        }
        const c = byPool.get(e.emitter);
        if (!c) continue;
        // Pool swaps: the verified wallet is `to` (the pool gates `to`, the sender may be a router).
        const isDev = e.to === lc(c.dev);
        trades.push(
            e.quoteIn
                ? {...pos, curve: c.address, venue: "pool", side: "buy", trader: e.to, isDev, tokenAmount: e.amountOut, quoteAmount: e.amountIn, volume: e.amountIn}
                : // amountOut is net of platform fee and royalty; royalty is in the event, the platform
                  // fee is not (separate PlatformFeePaid event), so sell volume is amountOut + royalty.
                  {...pos, curve: c.address, venue: "pool", side: "sell", trader: e.to, isDev, tokenAmount: e.amountIn, quoteAmount: e.amountOut, volume: e.amountOut + e.royalty}
        );
    }
    trades.sort(newerFirst);
    return {trades, graduatedAt};
}

export type CurveStats = {
    lastTradeBlock: bigint;
    tradeCount: number;
    /** Distinct non-Dev wallets that traded in the window. */
    uniqueTraders: number;
    /** Buy + sell volume in the pair asset, fees included, Dev trades included (shown on cards). */
    volumeQuote: bigint;
    /** Same, without the Dev's trades (used for the Popular volume rank). */
    volumeQuoteNonDev: bigint;
    /** Newest first. */
    recent: Trade[];
};

/** Per-curve stats over the retained window. Curves with no trade have no entry. */
export function aggregate(trades: readonly Trade[], recentLimit = 30): Map<Address, CurveStats> {
    const out = new Map<Address, CurveStats>();
    const traders = new Map<Address, Set<string>>();
    for (const t of [...trades].sort(newerFirst)) {
        let s = out.get(t.curve);
        if (!s) {
            s = {lastTradeBlock: t.block, tradeCount: 0, uniqueTraders: 0, volumeQuote: 0n, volumeQuoteNonDev: 0n, recent: []};
            out.set(t.curve, s);
            traders.set(t.curve, new Set());
        }
        s.tradeCount++;
        s.volumeQuote += t.volume;
        if (t.block > s.lastTradeBlock) s.lastTradeBlock = t.block;
        if (!t.isDev) {
            traders.get(t.curve)!.add(lc(t.trader));
            s.volumeQuoteNonDev += t.volume;
        }
        if (s.recent.length < recentLimit) s.recent.push(t);
    }
    for (const [c, set] of traders) out.get(c)!.uniqueTraders = set.size;
    return out;
}

// ---------------------------------------------------------------------------------------------
// Market cap and normalization (no FX: curves in different pair assets are compared as ratios)
// ---------------------------------------------------------------------------------------------

/** Market cap in the curve's pair asset: curve spot before graduation, pool spot after.
 *  undefined when the graduated pool's price is not loaded. */
export function marketCap(c: {graduated: boolean; virtualQuote: bigint; r: bigint; s: bigint}, poolSpot: bigint | undefined): bigint | undefined {
    if (!c.graduated) return marketCapQuote(c.virtualQuote, c.r, c.s);
    if (poolSpot === undefined) return undefined;
    return (poolSpot * TOTAL_SUPPLY) / WAD;
}

/** A ratio num/den compared by cross-multiplication. */
export type Ratio = {num: bigint; den: bigint};
/** Positive if a > b, negative if a < b, 0 if equal. Denominators must be > 0. */
export function cmpRatio(a: Ratio, b: Ratio): number {
    const l = a.num * b.den;
    const r = b.num * a.den;
    return l === r ? 0 : l > r ? 1 : -1;
}
/** Market cap relative to the curve's starting point: mcap / virtualQuote. */
export const mcapRatio = (mcap: bigint, virtualQuote: bigint): Ratio => ({num: mcap, den: virtualQuote});
/** Volume relative to the graduation threshold: volume / (3 * virtualQuote). */
export const volumeRatio = (volume: bigint, virtualQuote: bigint): Ratio => ({num: volume, den: 3n * virtualQuote});

// ---------------------------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------------------------

export const TABS = ["latest", "popular", "mcap", "almost", "new", "graduated"] as const;
export type Tab = (typeof TABS)[number];

export type SortCurve = CurveRef & {graduated: boolean; virtualQuote: bigint; r: bigint; s: bigint; poolSpot?: bigint};

/** Competition ranking (1, 1, 3): rank = 1 + number of items strictly better. */
function competitionRanks<T>(items: readonly T[], better: (a: T, b: T) => boolean): number[] {
    return items.map((x) => 1 + items.filter((y) => better(y, x)).length);
}

const byNewest = (a: CurveRef, b: CurveRef) => b.index - a.index;

/** Curves in the order of `tab`. Tabs that filter (popular, almost, graduated) drop the rest. */
export function sortCurves<T extends SortCurve>(tab: Tab, curves: readonly T[], stats: ReadonlyMap<Address, CurveStats>, graduatedAt: ReadonlyMap<Address, bigint> = new Map()): T[] {
    const list = [...curves];
    const last = (c: T) => stats.get(c.address)?.lastTradeBlock;
    switch (tab) {
        case "latest":
            return list.sort((a, b) => {
                const la = last(a);
                const lb = last(b);
                if (la !== undefined && lb !== undefined) return la === lb ? byNewest(a, b) : la > lb ? -1 : 1;
                if (la !== undefined) return -1;
                if (lb !== undefined) return 1;
                return byNewest(a, b);
            });
        case "popular": {
            const active = list.filter((c) => (stats.get(c.address)?.uniqueTraders ?? 0) > 0);
            const u = (c: T) => stats.get(c.address)!.uniqueTraders;
            const v = (c: T) => volumeRatio(stats.get(c.address)!.volumeQuoteNonDev, c.virtualQuote); // Dev trades do not lift the rank
            const ru = competitionRanks(active, (a, b) => u(a) > u(b));
            const rv = competitionRanks(active, (a, b) => cmpRatio(v(a), v(b)) > 0);
            const sum = new Map(active.map((c, i) => [c.address, ru[i] + rv[i]]));
            return active.sort((a, b) => {
                const d = sum.get(a.address)! - sum.get(b.address)!;
                if (d !== 0) return d;
                if (u(a) !== u(b)) return u(b) - u(a);
                const la = last(a)!;
                const lb = last(b)!;
                return la === lb ? byNewest(a, b) : la > lb ? -1 : 1;
            });
        }
        case "mcap": {
            const key = (c: T) => {
                const m = marketCap(c, c.poolSpot);
                return m === undefined ? undefined : mcapRatio(m, c.virtualQuote);
            };
            return list.sort((a, b) => {
                const ka = key(a);
                const kb = key(b);
                if (ka && kb) {
                    const d = cmpRatio(kb, ka);
                    return d !== 0 ? d : byNewest(a, b);
                }
                if (ka) return -1; // unknown market cap (pool price not loaded) goes last
                if (kb) return 1;
                return byNewest(a, b);
            });
        }
        case "almost":
            return list
                .filter((c) => !c.graduated)
                .sort((a, b) => {
                    const pa = progressBps(a.virtualQuote, a.r);
                    const pb = progressBps(b.virtualQuote, b.r);
                    return pa === pb ? byNewest(a, b) : pa > pb ? -1 : 1;
                });
        case "new":
            return list.sort(byNewest);
        case "graduated":
            return list
                .filter((c) => c.graduated)
                .sort((a, b) => {
                    const ga = graduatedAt.get(a.address);
                    const gb = graduatedAt.get(b.address);
                    if (ga !== undefined && gb !== undefined && ga !== gb) return ga > gb ? -1 : 1;
                    if (ga !== undefined && gb === undefined) return -1;
                    if (gb !== undefined && ga === undefined) return 1;
                    return byNewest(a, b);
                });
    }
}
