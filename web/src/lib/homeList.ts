// Pure helpers for the home row list: prices, change vs. the window's reference price, search and
// the featured row. No RPC, no React.
import {addrKey} from "./address";
import {CurveStats, sortCurves, SortCurve} from "./activity";
import type {ServerListRow, ServerSummary} from "./chainMerge";
import type {CurveInfo} from "../hooks/curves";
import {costToSellOut, grossForNet, spotPrice} from "./curveMath";

type Address = `0x${string}`;

/** The fields the home list needs (CurveInfo satisfies it). */
export type HomeCurve = SortCurve & {token: Address; name: string; symbol: string; totalFeeBps: number};

/** Price now, quote per whole token (18-decimal fixed point): the curve spot before graduation,
 *  the pool spot after (undefined while the pool spot is not loaded). */
export function currentPrice(c: Pick<HomeCurve, "graduated" | "virtualQuote" | "r" | "s" | "poolSpot">): bigint | undefined {
    return c.graduated ? c.poolSpot : spotPrice(c.virtualQuote, c.r, c.s);
}

/** Price at launch (nothing bought yet). */
export const openingPrice = (c: Pick<HomeCurve, "virtualQuote">): bigint => spotPrice(c.virtualQuote, 0n, 0n);

/** (current - ref) * 10000 / ref; undefined when either is missing or ref is 0. */
export function changeBps(current: bigint | undefined, ref: bigint | undefined): bigint | undefined {
    if (current === undefined || ref === undefined || ref === 0n) return undefined;
    return ((current - ref) * 10_000n) / ref;
}

/** Reference price for the window: the server's last price before it, else the opening price (no
 *  trade before the window means the price had not moved from launch). No server answer -> undefined. */
export function refPrice(c: Pick<HomeCurve, "address" | "virtualQuote">, server: ServerSummary | undefined): bigint | undefined {
    if (!server) return undefined;
    const s = server.curves[addrKey(c.address)];
    return s?.refPriceWad ? BigInt(s.refPriceWad) : openingPrice(c);
}

export const changeOf = (c: HomeCurve, server: ServerSummary | undefined) => changeBps(currentPrice(c), refPrice(c, server));

/** "+12.3%", "-4.5%", "0.0%"; 1000% and above as a whole number with grouping ("+1,234%"). */
export function changeLabel(bps: bigint, locale: string): {text: string; tone: "up" | "down" | "flat"} {
    const neg = bps < 0n;
    const abs = neg ? -bps : bps;
    let body: string;
    let zero: boolean;
    if (abs >= 100_000n) {
        const whole = (abs + 50n) / 100n;
        body = whole.toLocaleString(locale);
        zero = false;
    } else {
        const tenths = (abs + 5n) / 10n;
        body = `${tenths / 10n}.${tenths % 10n}`;
        zero = tenths === 0n;
    }
    if (zero) return {text: "0.0%", tone: "flat"};
    return neg ? {text: `-${body}%`, tone: "down"} : {text: `+${body}%`, tone: "up"};
}

/** Quote still needed to graduate, fees included (the token page's figure). */
export const leftToGraduate = (c: Pick<HomeCurve, "virtualQuote" | "r" | "s" | "totalFeeBps">): bigint =>
    grossForNet(costToSellOut(c.virtualQuote, c.r, c.s), BigInt(c.totalFeeBps));

/** Name or symbol contains the query, or the curve / token address starts with it (trimmed, any case). */
export function searchCurves<T extends Pick<HomeCurve, "address" | "token" | "name" | "symbol">>(curves: readonly T[], query: string): T[] {
    const q = query.trim().toLowerCase();
    if (q === "") return [...curves];
    return curves.filter(
        (c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q) || addrKey(c.address).startsWith(q) || addrKey(c.token).startsWith(q)
    );
}

const FULL_ADDR = /^0x[0-9a-fA-F]{40}$/;

/** A pasted full address (curve or token, any case) -> that entry. */
export function exactAddressHit<T extends Pick<HomeCurve, "address" | "token">>(curves: readonly T[], query: string): T | undefined {
    const q = query.trim();
    if (!FULL_ADDR.test(q)) return undefined;
    const k = addrKey(q);
    return curves.find((c) => addrKey(c.address) === k || addrKey(c.token) === k);
}

/** The first not-yet-graduated entry of the "almost" order. */
export function featured<T extends HomeCurve>(curves: readonly T[], stats: ReadonlyMap<Address, CurveStats>): T | undefined {
    return sortCurves("almost", curves.filter((c) => !c.graduated), stats)[0];
}

// ---------------------------------------------------------------------------------------------
// Server-first list (W-T16): the server rows render at once, chain reads overlay a few of them.
// ---------------------------------------------------------------------------------------------

const ZERO_POOL = "0x0000000000000000000000000000000000000000" as Address;

/** Rows the chain overlays on the home: the first OVERLAY_MAX visible ones. */
export const OVERLAY_MAX = 30;

/** A server list row as a CurveInfo (source "server"). totalFeeBps is not indexed, so it is 0 and
 *  figures that need it are hidden for server rows. A graduated row has no pool spot; the summary's
 *  last price (the last pool trade's average) stands in for it. */
export function serverCurveInfo(row: ServerListRow, index: number, wethAddr: Address, lastPriceWad?: string): CurveInfo {
    const pool = (row.pool ?? ZERO_POOL).toLowerCase() as Address;
    const graduated = row.pool !== null;
    return {
        address: row.curve,
        token: row.token,
        quote: row.quote,
        dev: row.dev,
        r: BigInt(row.r),
        s: BigInt(row.s),
        virtualQuote: BigInt(row.virtualQuote),
        graduated,
        verifiedBuyerCount: row.verifiedBuyers,
        pool,
        totalFeeBps: 0,
        name: row.name,
        symbol: row.symbol,
        isEth: row.quote.toLowerCase() === wethAddr.toLowerCase(),
        index,
        priorityUntil: BigInt(row.priorityUntil),
        poolSpot: graduated && lastPriceWad ? BigInt(lastPriceWad) : undefined,
        source: "server",
    };
}

/** The home list: server rows (newest first) with chain reads laid over them, plus curves the
 *  chain lists but the server does not know yet, at the top. `chainAddrs` is allCurves (oldest
 *  first) when it loaded; it gives every row its allCurves index. Without server rows the chain
 *  infos are the list (newest first). */
export function mergeCurveList(p: {
    server: readonly ServerListRow[] | undefined;
    summary?: ServerSummary;
    chainAddrs: readonly Address[] | undefined;
    chain: ReadonlyMap<string, CurveInfo>;
    weth: Address;
}): CurveInfo[] {
    const idx = new Map<string, number>((p.chainAddrs ?? []).map((a, i) => [addrKey(a), i]));
    if (!p.server) return [...p.chain.values()].sort((a, b) => b.index - a.index);
    const known = new Set(p.server.map((r) => addrKey(r.curve)));
    const n = p.server.length;
    const rows = p.server.map((row, i) => {
        const k = addrKey(row.curve);
        const live = p.chain.get(k);
        if (live) return live;
        return serverCurveInfo(row, idx.get(k) ?? n - 1 - i, p.weth, p.summary?.curves[k]?.lastPriceWad);
    });
    const fresh = [...p.chain.values()].filter((c) => !known.has(addrKey(c.address))).sort((a, b) => b.index - a.index);
    return [...fresh, ...rows];
}

/** Curves on the chain that the server list does not hold (newest first). */
export function newOnChain(chainAddrs: readonly Address[] | undefined, server: readonly ServerListRow[] | undefined): Address[] {
    if (!chainAddrs || !server) return [];
    const known = new Set(server.map((r) => addrKey(r.curve)));
    return chainAddrs.filter((a) => !known.has(addrKey(a))).reverse();
}

/** Chain overlay targets: new curves plus at most OVERLAY_MAX of the visible ones, deduped. */
export function overlayTargets(fresh: readonly Address[], visible: readonly Address[]): Address[] {
    const out: Address[] = [];
    const seen = new Set<string>();
    const add = (a: Address) => {
        const k = addrKey(a);
        if (seen.has(k)) return false;
        seen.add(k);
        out.push(a);
        return true;
    };
    for (const a of fresh) add(a);
    let n = 0;
    for (const a of visible) {
        if (n >= OVERLAY_MAX) break;
        if (add(a)) n++;
    }
    return out;
}
