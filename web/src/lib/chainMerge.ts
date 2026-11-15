// Merging the server index (Neon, via /api/chain/*) with the browser RPC window. The server covers
// everything up to indexedBlock; only browser entries after indexedBlock are added on top.
import type {CurveStats, Trade} from "./activity";

type Address = `0x${string}`;

export type ServerCurveSummary = {
    trades24h: number;
    traders24h: number;
    volume24h: string;
    volume24hExDev: string;
    lastTradeTs: string;
    lastPriceWad: string;
};
export type ServerSummary = {indexedBlock: string | null; indexedTs: string | null; curves: Record<string, ServerCurveSummary>};

export type ServerTrade = {
    tx: `0x${string}`;
    logIndex: number;
    side: "buy" | "sell";
    venue: "curve" | "pool";
    trader: Address;
    isDev: boolean;
    quoteAmount: string;
    tokenAmount: string;
    priceWad: string;
    ts: string;
    /** v3.1 index: real-name status at trade time (null when unknown). */
    verified?: boolean | null;
};

export const DAY = 86_400;
const after = (b: bigint, indexed: bigint | null) => indexed === null || b > indexed;

/** 24 h per-curve stats: server numbers plus browser trades after indexedBlock (and inside 24 h).
 *  Volumes use quote_amount on both sides (the server's definition). Trader counts are added, so a
 *  wallet that traded both before and after indexedBlock is counted twice (upper bound). */
export function mergeStats(
    server: ServerSummary,
    browser: readonly Trade[],
    tsOf: (b: bigint) => number | undefined,
    nowSec: number
): Map<Address, CurveStats> {
    const indexed = server.indexedBlock === null ? null : BigInt(server.indexedBlock);
    const since = nowSec - DAY;
    const out = new Map<Address, CurveStats>();
    for (const [curve, s] of Object.entries(server.curves)) {
        out.set(curve.toLowerCase() as Address, {
            lastTradeBlock: 0n,
            lastTradeTs: Number(s.lastTradeTs),
            tradeCount: s.trades24h,
            uniqueTraders: s.traders24h,
            volumeQuote: BigInt(s.volume24h),
            volumeQuoteNonDev: BigInt(s.volume24hExDev),
            recent: [],
        });
    }
    const fresh = new Map<Address, Set<string>>();
    for (const t of browser) {
        if (!after(t.block, indexed)) continue;
        const ts = tsOf(t.block);
        const key = t.curve.toLowerCase() as Address;
        let s = out.get(key);
        if (!s) {
            s = {lastTradeBlock: 0n, tradeCount: 0, uniqueTraders: 0, volumeQuote: 0n, volumeQuoteNonDev: 0n, recent: []};
            out.set(key, s);
        }
        if (t.block > s.lastTradeBlock) s.lastTradeBlock = t.block;
        if (ts !== undefined && (s.lastTradeTs === undefined || ts > s.lastTradeTs)) s.lastTradeTs = ts;
        s.recent.push(t);
        if (ts !== undefined && ts < since) continue;
        s.tradeCount++;
        s.volumeQuote += t.quoteAmount;
        if (!t.isDev) {
            s.volumeQuoteNonDev += t.quoteAmount;
            // v3.1: only verified buys count as real-name traders (same rule as the server's traders24h)
            if (t.side !== "buy" || t.verified !== true) continue;
            let set = fresh.get(key);
            if (!set) fresh.set(key, (set = new Set()));
            if (!set.has(t.trader.toLowerCase())) {
                set.add(t.trader.toLowerCase());
                s.uniqueTraders++;
            }
        }
    }
    return out;
}

/** Stats of the listed curves only, keyed by lowercase address (the rule for every stats map). */
export function keyByCurves(stats: Map<Address, CurveStats>, curves: readonly {address: Address}[]): Map<Address, CurveStats> {
    const m = new Map<Address, CurveStats>();
    for (const c of curves) {
        const k = c.address.toLowerCase() as Address;
        const s = stats.get(k);
        if (s) m.set(k, s);
    }
    return m;
}

export type HistoryRow = {
    key: string;
    tx: `0x${string}`;
    logIndex: number;
    side: "buy" | "sell";
    venue: "curve" | "pool";
    trader: Address;
    isDev: boolean;
    /** Real-name status at trade time; null when unknown (browser sells / swaps, index lookup failed). */
    verified: boolean | null;
    quoteAmount: bigint;
    tokenAmount: bigint;
    ts: number | undefined;
};

/** Server history + browser trades after indexedBlock, deduped by (tx, logIndex), newest first. */
export function mergeHistory(server: readonly ServerTrade[], browser: readonly Trade[], indexedBlock: string | null, tsOf: (b: bigint) => number | undefined): HistoryRow[] {
    const indexed = indexedBlock === null ? null : BigInt(indexedBlock);
    const seen = new Set<string>();
    const rows: HistoryRow[] = [];
    const push = (r: HistoryRow) => {
        if (seen.has(r.key)) return;
        seen.add(r.key);
        rows.push(r);
    };
    for (const t of browser) {
        if (!after(t.block, indexed)) continue;
        push({key: `${t.tx.toLowerCase()}:${t.logIndex}`, tx: t.tx, logIndex: t.logIndex, side: t.side, venue: t.venue, trader: t.trader, isDev: t.isDev, verified: t.verified, quoteAmount: t.quoteAmount, tokenAmount: t.tokenAmount, ts: tsOf(t.block)});
    }
    for (const t of server) {
        push({key: `${t.tx.toLowerCase()}:${t.logIndex}`, tx: t.tx, logIndex: t.logIndex, side: t.side, venue: t.venue, trader: t.trader, isDev: t.isDev, verified: t.verified ?? null, quoteAmount: BigInt(t.quoteAmount), tokenAmount: BigInt(t.tokenAmount), ts: Number(t.ts)});
    }
    return rows.sort((a, b) => (b.ts ?? Infinity) - (a.ts ?? Infinity));
}

/** Share of the 1e9 total supply, floored to two decimals ("12.34"). */
export function sharePct(balance: bigint, totalSupply: bigint): string {
    const bps = (balance * 10_000n) / totalSupply;
    return `${bps / 100n}.${(bps % 100n).toString().padStart(2, "0")}`;
}
