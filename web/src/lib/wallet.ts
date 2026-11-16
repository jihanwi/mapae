// Wallet profile math (pure, bigint). Amounts are quote-asset wei, quantities token wei, prices
// quote wei per whole token (18-decimal fixed point, like spotPrice). Results can be negative.
// P&L is moving-average: trades are applied in chain order (applyTrade, shared with the API in
// api/_lib/positions.ts), so a settled sell never changes when more is bought later.
import type {Trade} from "./activity";
import {fmtRound, fmtSig} from "./format";
import {applyTrade, EMPTY_POSITION, PositionState} from "../../api/_lib/positions";

export {applyTrade, EMPTY_POSITION};
export type {PositionState};

type Address = `0x${string}`;
const WAD = 10n ** 18n;

export type Position = PositionState & {curve: Address; token: Address; name: string; symbol: string};
export type ServerPosition = {
    curve: string;
    token: string;
    name: string;
    symbol: string;
    cost: string;
    tracked: string;
    realized: string;
    buyQuote: string;
    buyTokens: string;
    sellQuote: string;
    sellTokens: string;
};

export function parsePosition(p: ServerPosition): Position {
    return {
        curve: p.curve.toLowerCase() as Address,
        token: p.token.toLowerCase() as Address,
        name: p.name,
        symbol: p.symbol,
        cost: BigInt(p.cost),
        tracked: BigInt(p.tracked),
        realized: BigInt(p.realized),
        buyQuote: BigInt(p.buyQuote),
        buyTokens: BigInt(p.buyTokens),
        sellQuote: BigInt(p.sellQuote),
        sellTokens: BigInt(p.sellTokens),
    };
}

/** Server positions plus this wallet's browser trades after indexedBlock, applied in (block,
 *  logIndex) order; curves the server has no line for start from zero (name/symbol from `info`).
 *  Older trades are already folded on the server, so nothing is counted twice. indexedBlock null
 *  (no server): unchanged. */
export function mergeBrowserTrades(
    positions: readonly Position[],
    trades: readonly Trade[],
    wallet: string,
    indexedBlock: bigint | null,
    info: (curve: Address) => {token: Address; name: string; symbol: string} | undefined
): Position[] {
    if (indexedBlock === null) return [...positions];
    const w = wallet.toLowerCase();
    const mine = trades
        .filter((t) => t.trader.toLowerCase() === w && t.block > indexedBlock && t.tokenAmount > 0n)
        .sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
    const byCurve = new Map<Address, Position>(positions.map((p) => [p.curve, p]));
    for (const t of mine) {
        const curve = t.curve.toLowerCase() as Address;
        let base = byCurve.get(curve);
        if (!base) {
            const i = info(curve);
            if (!i) continue;
            base = {curve, token: i.token.toLowerCase() as Address, name: i.name, symbol: i.symbol, ...EMPTY_POSITION};
        }
        byCurve.set(curve, {...base, ...applyTrade(base, t)});
    }
    return [...byCurve.values()];
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

export type Pnl = {realized: bigint | undefined; unrealized: bigint | undefined; unrealizedBps: bigint | undefined; cost: bigint | undefined};

/** Display values of a moving-average position: realized as settled; the unrealized part covers
 *  min(balance, tracked) at its share of the remaining cost. Never bought: all undefined. */
export function pnl(p: PositionState, balance: bigint, price: bigint | undefined): Pnl {
    if (p.buyTokens === 0n) return {realized: undefined, unrealized: undefined, unrealizedBps: undefined, cost: undefined};
    const heldCounted = min(balance < 0n ? 0n : balance, p.tracked);
    const cost = p.tracked === 0n ? 0n : (p.cost * heldCounted) / p.tracked;
    const unrealized = price === undefined ? undefined : (heldCounted * price) / WAD - cost;
    const unrealizedBps = cost === 0n || unrealized === undefined ? undefined : (unrealized * 10_000n) / cost;
    return {realized: p.realized, unrealized, unrealizedBps, cost};
}

/** Value of a balance at `price`; undefined without a price. */
export const holdingValue = (balance: bigint, price: bigint | undefined): bigint | undefined => (price === undefined ? undefined : (balance * price) / WAD);

export type Unit = "KRWs" | "ETH";
export type Sum = {realized: bigint | undefined; unrealized: bigint | undefined; value: bigint | undefined};

/** Sums per quote unit (never across units). A missing value is skipped; a total stays undefined
 *  when no row had that value. Units without rows are absent. */
export function totals(rows: readonly {unit: Unit; realized?: bigint; unrealized?: bigint; value?: bigint}[]): Map<Unit, Sum> {
    const out = new Map<Unit, Sum>();
    const add = (x: bigint | undefined, y: bigint | undefined) => (y === undefined ? x : (x ?? 0n) + y);
    for (const r of rows) {
        const s = out.get(r.unit) ?? {realized: undefined, unrealized: undefined, value: undefined};
        out.set(r.unit, {realized: add(s.realized, r.realized), unrealized: add(s.unrealized, r.unrealized), value: add(s.value, r.value)});
    }
    return out;
}

export type HoldingRow = {unit: Unit; balance: bigint; value?: bigint; realized?: bigint; traded: boolean};

/** Holding (balance > 0): KRWs group then ETH, each by value (largest first, unknown value last).
 *  Sold out (balance 0 with trades): by |realized| (largest first, unknown last). */
export function splitHoldings<T extends HoldingRow>(rows: readonly T[]): {holding: T[]; soldOut: T[]} {
    const unitRank = (u: Unit) => (u === "KRWs" ? 0 : 1);
    const desc = (a: bigint | undefined, b: bigint | undefined) => (a === undefined ? (b === undefined ? 0 : 1) : b === undefined ? -1 : a === b ? 0 : a > b ? -1 : 1);
    const abs = (x: bigint | undefined) => (x === undefined ? undefined : x < 0n ? -x : x);
    const holding = rows.filter((r) => r.balance > 0n).sort((a, b) => unitRank(a.unit) - unitRank(b.unit) || desc(a.value, b.value));
    const soldOut = rows.filter((r) => r.balance === 0n && r.traded).sort((a, b) => desc(abs(a.realized), abs(b.realized)));
    return {holding, soldOut};
}

/** Display amount: KRWs as a whole number, ETH / WETH with 4 significant digits (tiny ETH values
 *  would otherwise round to "0"). Magnitude only; see signedPnl for the sign. */
export function walletAmount(abs: bigint, unit: Unit | "WETH", locale: string): string {
    return unit === "KRWs" ? fmtRound(abs, 0, locale) : fmtSig(abs, 4, locale);
}

/** Signed P&L text and tone. A value that DISPLAYS as zero gets no sign and the flat tone (never
 *  "-0"); the same holds for the percentage. */
export function signedPnl(v: bigint, unit: Unit | "WETH", locale: string, bps?: bigint): {text: string; tone: "up" | "down" | "flat"} {
    const abs = v < 0n ? -v : v;
    const amt = walletAmount(abs, unit, locale);
    const zero = !/[1-9]/.test(amt);
    const tone = zero || v === 0n ? "flat" : v > 0n ? "up" : "down";
    const sign = tone === "up" ? "+" : tone === "down" ? "-" : "";
    let pct = "";
    if (bps !== undefined) {
        const b = bps < 0n ? -bps : bps;
        const tenths = (b + 5n) / 10n;
        const pSign = tenths === 0n ? "" : bps > 0n ? "+" : "-";
        pct = ` (${pSign}${tenths / 10n}.${tenths % 10n}%)`;
    }
    return {text: `${sign}${amt} ${unit}${pct}`, tone};
}

/** The held count on the wallet profile, or null for "–" (unknown). Unknown while no chain read
 *  has answered yet (loading or failing) instead of a "0" that only means "nothing read":
 *  - chain reads failing now (balances or the curve list) -> unknown;
 *  - the browser trade window (RPC) not loaded yet -> unknown (it adds tokens to read);
 *  - tokens to read but their balances not read successfully -> unknown;
 *  - no token to read: known only once the server profile answered (it lists received tokens). */
export function heldCount(p: {held: number; tokens: number; balancesRead: boolean; activityLoaded: boolean; profileOk: boolean; chainFail: boolean}): number | null {
    if (p.chainFail || !p.activityLoaded) return null;
    if (p.tokens > 0) return p.balancesRead ? p.held : null;
    return p.profileOk ? p.held : null;
}
