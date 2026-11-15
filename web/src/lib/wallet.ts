// Wallet profile math (pure, bigint). Amounts are quote-asset wei, quantities token wei, prices
// quote wei per whole token (18-decimal fixed point, like spotPrice). Results can be negative.
import type {Trade} from "./activity";

type Address = `0x${string}`;
const WAD = 10n ** 18n;

export type Amounts = {buyQuote: bigint; buyTokens: bigint; sellQuote: bigint; sellTokens: bigint};
export type Position = Amounts & {curve: Address; token: Address; name: string; symbol: string};
export type ServerPosition = {curve: string; token: string; name: string; symbol: string; buyQuote: string; buyTokens: string; sellQuote: string; sellTokens: string};

export const ZERO_AMOUNTS: Amounts = {buyQuote: 0n, buyTokens: 0n, sellQuote: 0n, sellTokens: 0n};

export function parsePosition(p: ServerPosition): Position {
    return {
        curve: p.curve.toLowerCase() as Address,
        token: p.token.toLowerCase() as Address,
        name: p.name,
        symbol: p.symbol,
        buyQuote: BigInt(p.buyQuote),
        buyTokens: BigInt(p.buyTokens),
        sellQuote: BigInt(p.sellQuote),
        sellTokens: BigInt(p.sellTokens),
    };
}

/** One position plus browser trades after the server's indexedBlock (older ones are already in the
 *  server sums, so they are skipped: no trade is counted twice). `extra` must be this wallet's
 *  trades of this curve. */
export function addTrades<T extends Amounts>(position: T, extra: readonly Pick<Trade, "side" | "quoteAmount" | "tokenAmount" | "block">[], indexedBlock: bigint): T {
    const out = {...position};
    for (const t of extra) {
        if (t.block <= indexedBlock) continue;
        if (t.side === "buy") {
            out.buyQuote += t.quoteAmount;
            out.buyTokens += t.tokenAmount;
        } else {
            out.sellQuote += t.quoteAmount;
            out.sellTokens += t.tokenAmount;
        }
    }
    return out;
}

/** Server positions plus this wallet's browser trades after indexedBlock; curves the server has no
 *  line for get a new one (name/symbol from `info`). indexedBlock null (no server): unchanged. */
export function mergeBrowserTrades(
    positions: readonly Position[],
    trades: readonly Trade[],
    wallet: string,
    indexedBlock: bigint | null,
    info: (curve: Address) => {token: Address; name: string; symbol: string} | undefined
): Position[] {
    if (indexedBlock === null) return [...positions];
    const w = wallet.toLowerCase();
    const mine = trades.filter((t) => t.trader.toLowerCase() === w && t.block > indexedBlock && t.tokenAmount > 0n);
    const byCurve = new Map<Address, Position>(positions.map((p) => [p.curve, p]));
    const groups = new Map<Address, Trade[]>();
    for (const t of mine) {
        const k = t.curve.toLowerCase() as Address;
        groups.set(k, [...(groups.get(k) ?? []), t]);
    }
    for (const [curve, ts] of groups) {
        const base = byCurve.get(curve);
        if (base) {
            byCurve.set(curve, addTrades(base, ts, indexedBlock));
            continue;
        }
        const i = info(curve);
        if (!i) continue;
        byCurve.set(curve, addTrades({curve, token: i.token.toLowerCase() as Address, name: i.name, symbol: i.symbol, ...ZERO_AMOUNTS}, ts, indexedBlock));
    }
    return [...byCurve.values()];
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

export type Pnl = {realized: bigint | undefined; unrealized: bigint | undefined; unrealizedBps: bigint | undefined; cost: bigint | undefined};

/** Average-cost P&L. Only bought quantities count: tokens received by transfer have no cost, so
 *  sells beyond what was bought and holdings beyond what is left of it are ignored. */
export function pnl(a: Amounts, balance: bigint, price: bigint | undefined): Pnl {
    if (a.buyTokens === 0n) return {realized: undefined, unrealized: undefined, unrealizedBps: undefined, cost: undefined};
    const soldCounted = min(a.sellTokens, a.buyTokens);
    const realized = a.sellTokens === 0n ? 0n : (a.sellQuote * soldCounted) / a.sellTokens - (a.buyQuote * soldCounted) / a.buyTokens;
    const left = a.buyTokens - soldCounted;
    const heldCounted = min(balance < 0n ? 0n : balance, left);
    const cost = (a.buyQuote * heldCounted) / a.buyTokens;
    const unrealized = price === undefined ? undefined : (heldCounted * price) / WAD - cost;
    const unrealizedBps = cost === 0n || unrealized === undefined ? undefined : (unrealized * 10_000n) / cost;
    return {realized, unrealized, unrealizedBps, cost};
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
