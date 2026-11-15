// Pure indexer logic (no DB, no RPC): range planning, log -> row conversion, the cron run order
// with injected dependencies, and query parameter validation. Decoding reuses src/lib/activity.ts.
import {decodeEventLog, encodeEventTopics, Hex, isAddress} from "viem";
import {CurveFactoryAbi, MembershipTokenV3Abi} from "../../src/contracts/abisV3.js";
import {ACTIVITY_TOPICS, BlockTime, decodeActivityLogs, interpolateTs, RawLog, resolve} from "../../src/lib/activity.js";

export type Address = `0x${string}`;
const lc = (a: string) => a.toLowerCase() as Address;
const WAD = 10n ** 18n;
export const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

// ---------------------------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------------------------

export const RANGE_SPAN = 9_000n;
export const MAX_RANGES = 12;
export const HEAD_LAG = 10n;
export const TIME_BUDGET_MS = 40_000;

/** Consecutive [from, to] ranges covering [next, head], at most `span` blocks each, at most `max`. */
export function planRanges(next: bigint, head: bigint, span = RANGE_SPAN, max = MAX_RANGES): Array<[bigint, bigint]> {
    const out: Array<[bigint, bigint]> = [];
    let from = next;
    while (from <= head && out.length < max) {
        const to = from + span - 1n < head ? from + span - 1n : head;
        out.push([from, to]);
        from = to + 1n;
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Rows (addresses lowercase, amounts as raw integer strings)
// ---------------------------------------------------------------------------------------------

export type CurveRow = {
    curve: Address;
    token: Address;
    dev: Address;
    quote: Address;
    virtualQuote: string;
    name: string;
    symbol: string;
    createdBlock: string;
    createdTs: string;
    /** v3.1: end of the real-name priority window (unix seconds, from CurveCreated). */
    priorityUntil: string;
    /** CurveFactory that emitted CurveCreated (lowercase). */
    factory: Address;
};
export type GraduationRow = {curve: Address; pool: Address; block: string};
export type TradeRow = {
    tx: Hex;
    logIndex: number;
    curve: Address;
    venue: "curve" | "pool";
    side: "buy" | "sell";
    trader: Address;
    isDev: boolean;
    /** v3.1: real-name status at trade time; null when unknown. */
    verified: boolean | null;
    quoteAmount: string;
    tokenAmount: string;
    priceWad: string;
    block: string;
    ts: string;
};
export type TransferRow = {tx: Hex; logIndex: number; token: Address; from: Address; to: Address; value: string; block: string};

/** A curve as the indexer knows it (from the DB or from this range's CurveCreated). */
export type KnownCurve = {curve: Address; token: Address; dev: Address; pool: Address | null};

const CURVE_CREATED = CurveFactoryAbi.filter((x) => x.type === "event" && x.name === "CurveCreated");
const TRANSFER = MembershipTokenV3Abi.filter((x) => x.type === "event" && x.name === "Transfer");
export const CURVE_CREATED_TOPIC = encodeEventTopics({abi: CURVE_CREATED, eventName: "CurveCreated"} as Parameters<typeof encodeEventTopics>[0])[0] as Hex;
export const TRANSFER_TOPIC = encodeEventTopics({abi: TRANSFER, eventName: "Transfer"} as Parameters<typeof encodeEventTopics>[0])[0] as Hex;
export {ACTIVITY_TOPICS};

const done = (l: RawLog): l is RawLog & {blockNumber: bigint; logIndex: number; transactionHash: Hex} =>
    l.blockNumber !== null && l.logIndex !== null && l.transactionHash !== null;

const tsStr = (block: bigint, a: BlockTime, b: BlockTime) => String(Math.round(interpolateTs(block, a, b)));

/** CurveCreated logs from the factory -> curve rows. */
export function toCurveRows(logs: readonly RawLog[], factory: string, a: BlockTime, b: BlockTime): CurveRow[] {
    const out: CurveRow[] = [];
    for (const l of logs) {
        if (!done(l) || lc(l.address) !== lc(factory)) continue;
        let ev;
        try {
            ev = decodeEventLog({abi: CURVE_CREATED, data: l.data, topics: l.topics as [Hex, ...Hex[]]});
        } catch {
            continue;
        }
        const x = ev.args as {dev: string; curve: string; token: string; quote: string; virtualQuote: bigint; name: string; symbol: string; priorityUntil: bigint};
        out.push({
            curve: lc(x.curve),
            token: lc(x.token),
            dev: lc(x.dev),
            quote: lc(x.quote),
            virtualQuote: x.virtualQuote.toString(),
            name: x.name,
            symbol: x.symbol,
            createdBlock: l.blockNumber.toString(),
            createdTs: tsStr(l.blockNumber, a, b),
            priorityUntil: x.priorityUntil.toString(),
            factory: lc(factory),
        });
    }
    return out;
}

/** Activity logs (Buy, Sell, Swapped, Graduated; no address filter) -> trade and graduation rows.
 *  Only logs from known curves (or their pools, including pools graduated in this same batch)
 *  are kept. Rows with token_amount 0 are skipped (no price). */
export function toTradeRows(logs: readonly RawLog[], known: readonly KnownCurve[], a: BlockTime, b: BlockTime): {trades: TradeRow[]; graduations: GraduationRow[]} {
    const entries = decodeActivityLogs(logs);
    // Pools first: a Graduated in this batch makes the pool known for the Swapped logs after it.
    const pools = new Map<string, Address>(known.filter((k) => k.pool).map((k) => [k.curve, k.pool as Address]));
    const known1 = new Set(known.map((k) => k.curve));
    const graduations: GraduationRow[] = [];
    for (const e of entries) {
        if (e.kind !== "Graduated" || !known1.has(lc(e.emitter))) continue;
        pools.set(lc(e.emitter), lc(e.pool));
        graduations.push({curve: lc(e.emitter), pool: lc(e.pool), block: e.block.toString()});
    }
    const refs = known.map((k, i) => ({address: k.curve, pool: (pools.get(k.curve) ?? ZERO_ADDR) as Address, dev: k.dev, index: i}));
    const {trades} = resolve(entries, refs);
    const out: TradeRow[] = [];
    for (const t of trades) {
        if (t.tokenAmount === 0n) continue;
        out.push({
            tx: t.tx.toLowerCase() as Hex,
            logIndex: t.logIndex,
            curve: lc(t.curve),
            venue: t.venue,
            side: t.side,
            trader: lc(t.trader),
            isDev: t.isDev,
            // Buy carries it; sells and pool swaps are looked up per range (fillVerified).
            verified: t.side === "buy" && t.venue === "curve" ? t.verified : null,
            quoteAmount: t.quoteAmount.toString(),
            tokenAmount: t.tokenAmount.toString(),
            priceWad: ((t.quoteAmount * WAD) / t.tokenAmount).toString(),
            block: t.block.toString(),
            ts: tsStr(t.block, a, b),
        });
    }
    return {trades: out, graduations};
}

/** ERC-20 Transfer logs from known tokens -> transfer rows. */
export function toTransferRows(logs: readonly RawLog[], tokens: ReadonlySet<string>): TransferRow[] {
    const out: TransferRow[] = [];
    for (const l of logs) {
        if (!done(l) || !tokens.has(lc(l.address))) continue;
        let ev;
        try {
            ev = decodeEventLog({abi: TRANSFER, data: l.data, topics: l.topics as [Hex, ...Hex[]]});
        } catch {
            continue;
        }
        const x = ev.args as {from: string; to: string; value: bigint};
        out.push({
            tx: l.transactionHash.toLowerCase() as Hex,
            logIndex: l.logIndex,
            token: lc(l.address),
            from: lc(x.from),
            to: lc(x.to),
            value: x.value.toString(),
            block: l.blockNumber.toString(),
        });
    }
    return out;
}

/** Wallets whose verified status must be looked up for this range (sells and pool swaps), unique. */
export function verifiedLookupTargets(rows: readonly TradeRow[]): Address[] {
    return [...new Set(rows.filter((r) => r.verified === null).map((r) => r.trader))];
}

/** Rows with `verified` filled from a lookup (address -> status). Missing entries stay null. */
export function fillVerified(rows: readonly TradeRow[], lookup: ReadonlyMap<string, boolean | null> | null): TradeRow[] {
    if (!lookup) return [...rows];
    return rows.map((r) => (r.verified === null ? {...r, verified: lookup.get(r.trader) ?? null} : r));
}

export function chunk<T>(xs: readonly T[], n: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
    return out;
}

// ---------------------------------------------------------------------------------------------
// Cron run (dependencies injected; the real ones are in api/cron/index.ts)
// ---------------------------------------------------------------------------------------------

export type RangeWrite = {curves: CurveRow[]; graduations: GraduationRow[]; trades: TradeRow[]; transfers: TransferRow[]; nextBlock: bigint; indexedTs: number};

export type CronDeps = {
    db: {
        ensureSchema(): Promise<void>;
        readNextBlock(): Promise<bigint | null>;
        /** Curves of the current factory only (older factories' curves are not indexed). */
        loadCurves(): Promise<KnownCurve[]>;
        writeRange(w: RangeWrite): Promise<void>;
    };
    rpc: {
        blockNumber(): Promise<bigint>;
        blockTime(n: bigint): Promise<BlockTime>;
        getLogs(q: {fromBlock: bigint; toBlock: bigint; address?: string | string[]; topics: (Hex | Hex[])[]}): Promise<RawLog[]>;
        /** MockDojang.isVerified for many wallets in ONE Multicall3 aggregate3 call. null = that call failed. */
        isVerifiedMany(wallets: readonly Address[]): Promise<Map<string, boolean | null>>;
    };
    nowMs(): number;
    factory: string;
    deployBlock: bigint;
};

export type CronResult = {status: number; body: Record<string, unknown>};

export const TRANSFER_CHUNK = 200;

/** Constant-time comparison (length is not secret). */
function sameSecret(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
}

/** Auth check only: true when `authorization` is exactly "Bearer <secret>" and secret is set. */
export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
    return !!secret && !!authorization && sameSecret(authorization, `Bearer ${secret}`);
}

/** How much one run may index: ranges of RANGE_SPAN blocks and a time budget checked before each
 *  range after the first. The cron uses the defaults; the on-demand catch-up uses 1 range / 8 s. */
export type IndexOpts = {maxRanges: number; timeBudgetMs: number};
export const CRON_INDEX_OPTS: IndexOpts = {maxRanges: MAX_RANGES, timeBudgetMs: TIME_BUDGET_MS};
export const POKE_INDEX_OPTS: IndexOpts = {maxRanges: 1, timeBudgetMs: 8_000};

export async function runCron(authorization: string | null, secret: string | undefined, deps: CronDeps, opts: IndexOpts = CRON_INDEX_OPTS): Promise<CronResult> {
    // 1) auth first: nothing touches the DB or the RPC before this passes
    if (!cronAuthorized(authorization, secret)) return {status: 401, body: {ok: false, error: "unauthorized"}};
    return indexOnce(deps, opts);
}

/** Steps 2-8 of a cron run without the secret check (callers gate access themselves: the cron by
 *  CRON_SECRET, the catch-up POST by the 20 s claim on the cursor row). */
export async function indexOnce(deps: CronDeps, opts: IndexOpts): Promise<CronResult> {
    const started = deps.nowMs();
    // 2) schema, 3) cursor
    await deps.db.ensureSchema();
    let next = (await deps.db.readNextBlock()) ?? deps.deployBlock;
    // 4) head
    const latest = await deps.rpc.blockNumber();
    const head = latest - HEAD_LAG;
    if (next > head) return {status: 200, body: {ok: true, indexed: 0, next_block: next.toString()}};

    const known = new Map<string, KnownCurve>((await deps.db.loadCurves()).map((c) => [c.curve, c]));
    const firstFrom = next;
    let lastTo: bigint | null = null;
    let ranges = 0;
    let trades = 0;
    let transfers = 0;
    let curves = 0;
    // 5) ranges, with a time budget checked before starting each one
    for (const [from, to] of planRanges(next, head, RANGE_SPAN, opts.maxRanges)) {
        if (ranges > 0 && deps.nowMs() - started > opts.timeBudgetMs) break;
        try {
            // 6a) two block headers for timestamp interpolation
            const [a, b] = await Promise.all([deps.rpc.blockTime(from), deps.rpc.blockTime(to)]);
            // 6b) curves created in this range
            const created = toCurveRows(await deps.rpc.getLogs({fromBlock: from, toBlock: to, address: deps.factory, topics: [CURVE_CREATED_TOPIC]}), deps.factory, a, b);
            for (const c of created) if (!known.has(c.curve)) known.set(c.curve, {curve: c.curve, token: c.token, dev: c.dev, pool: null});
            // 6c) activity, no address filter, kept for known curves/pools only
            const raw = toTradeRows(await deps.rpc.getLogs({fromBlock: from, toBlock: to, topics: [ACTIVITY_TOPICS]}), [...known.values()], a, b);
            // 6e) only when the range has sells or pool swaps: their real-name status, one multicall.
            //     A failed lookup leaves them null (logged) and indexing continues.
            const targets = verifiedLookupTargets(raw.trades);
            let lookup: Map<string, boolean | null> | null = null;
            if (targets.length > 0) {
                try {
                    lookup = await deps.rpc.isVerifiedMany(targets);
                } catch (e) {
                    console.error("indexer verified lookup failed", {from: from.toString(), to: to.toString()}, e);
                }
            }
            const act = {...raw, trades: fillVerified(raw.trades, lookup)};
            for (const g of act.graduations) {
                const k = known.get(g.curve);
                if (k) known.set(g.curve, {...k, pool: g.pool});
            }
            // 6d) token transfers, 200 token addresses per call, skipped when no token is known
            const tokens = [...known.values()].map((k) => k.token);
            const tLogs: RawLog[] = [];
            for (const part of chunk(tokens, TRANSFER_CHUNK)) tLogs.push(...(await deps.rpc.getLogs({fromBlock: from, toBlock: to, address: part, topics: [TRANSFER_TOPIC]})));
            const tRows = toTransferRows(tLogs, new Set(tokens));
            await deps.db.writeRange({curves: created, graduations: act.graduations, trades: act.trades, transfers: tRows, nextBlock: to + 1n, indexedTs: b.ts});
            next = to + 1n;
            lastTo = to;
            ranges++;
            trades += act.trades.length;
            transfers += tRows.length;
            curves += created.length;
        } catch (e) {
            // 7) stop at the failing range; next_block only covers the ranges written above
            console.error("indexer range failed", {from: from.toString(), to: to.toString()}, e);
            return {status: 500, body: {ok: false, next_block: next.toString()}};
        }
    }
    // 8)
    return {
        status: 200,
        body: {ok: true, from: firstFrom.toString(), to: lastTo?.toString() ?? null, ranges, trades, transfers, curves, next_block: next.toString()},
    };
}

// ---------------------------------------------------------------------------------------------
// Query parameter validation
// ---------------------------------------------------------------------------------------------

export const INTERVALS = [300, 3600, 86400] as const;
export type Interval = (typeof INTERVALS)[number];

export function parseCurve(v: string | null): Address | null {
    return v && /^0x[0-9a-fA-F]{40}$/.test(v) && isAddress(v, {strict: false}) ? lc(v) : null;
}
export function parseInterval(v: string | null): Interval | null {
    const n = Number(v);
    return (INTERVALS as readonly number[]).includes(n) && String(n) === v ? (n as Interval) : null;
}
/** limit: 1..50, default 50 when absent. null when present and invalid. */
export function parseLimit(v: string | null): number | null {
    if (v === null) return 50;
    if (!/^\d+$/.test(v)) return null;
    const n = Number(v);
    return n >= 1 && n <= 50 ? n : null;
}
/** before: unix seconds; undefined when absent, null when invalid. */
export function parseBefore(v: string | null): bigint | undefined | null {
    if (v === null) return undefined;
    return /^\d{1,15}$/.test(v) ? BigInt(v) : null;
}

export type HolderLabel = "curve" | "pool" | "dev" | null;
export function holderLabel(address: string, c: {curve: string; pool: string | null; dev: string}): HolderLabel {
    const a = address.toLowerCase();
    if (a === c.curve.toLowerCase()) return "curve";
    if (c.pool && a === c.pool.toLowerCase()) return "pool";
    if (a === c.dev.toLowerCase()) return "dev";
    return null;
}
