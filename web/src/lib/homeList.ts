// Pure helpers for the home row list: prices, change vs. the window's reference price, search and
// the featured row. No RPC, no React.
import {addrKey} from "./address";
import {CurveStats, sortCurves, SortCurve} from "./activity";
import type {ServerSummary} from "./chainMerge";
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
