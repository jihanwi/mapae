// Moving-average P&L state per wallet and token (pure, bigint, floor division). Shared by the API
// (/api/chain/wallet folds indexed trades) and the browser (adds trades past indexedBlock).
//   buy (q, t):  cost += q, tracked += t
//   sell (q, t): s = min(t, tracked); nothing when s = 0 (selling tokens that have no cost);
//                c = cost * s / tracked; realized += q * s / t - c; cost -= c; tracked -= s
// A sell settles at the average cost of that moment, so later buys never change it.

export type PositionState = {
    /** cost of the tracked quantity (quote wei) */
    cost: bigint;
    /** quantity that has a cost (token wei) */
    tracked: bigint;
    /** settled P&L (quote wei, signed) */
    realized: bigint;
    buyQuote: bigint;
    buyTokens: bigint;
    sellQuote: bigint;
    sellTokens: bigint;
};

export const EMPTY_POSITION: PositionState = {cost: 0n, tracked: 0n, realized: 0n, buyQuote: 0n, buyTokens: 0n, sellQuote: 0n, sellTokens: 0n};

export type TradeStep = {side: "buy" | "sell"; quoteAmount: bigint; tokenAmount: bigint};

export function applyTrade(p: PositionState, t: TradeStep): PositionState {
    if (t.side === "buy") {
        return {...p, cost: p.cost + t.quoteAmount, tracked: p.tracked + t.tokenAmount, buyQuote: p.buyQuote + t.quoteAmount, buyTokens: p.buyTokens + t.tokenAmount};
    }
    const out = {...p, sellQuote: p.sellQuote + t.quoteAmount, sellTokens: p.sellTokens + t.tokenAmount};
    if (t.tokenAmount === 0n) return out;
    const s = t.tokenAmount < p.tracked ? t.tokenAmount : p.tracked;
    if (s === 0n) return out;
    const c = (p.cost * s) / p.tracked;
    return {...out, realized: p.realized + (t.quoteAmount * s) / t.tokenAmount - c, cost: p.cost - c, tracked: p.tracked - s};
}

export type FoldRow = {curve: string; token: string; name: string; symbol: string; side: string; quoteAmount: string; tokenAmount: string};
export type FoldedPosition = {curve: string; token: string; name: string; symbol: string; state: PositionState};

/** Rows must already be in (block, log_index) order. One state per curve, first-seen order. */
export function foldTrades(rows: readonly FoldRow[]): FoldedPosition[] {
    const out = new Map<string, FoldedPosition>();
    for (const r of rows) {
        const cur = out.get(r.curve) ?? {curve: r.curve, token: r.token, name: r.name, symbol: r.symbol, state: EMPTY_POSITION};
        const side = r.side === "buy" ? "buy" : "sell";
        out.set(r.curve, {...cur, state: applyTrade(cur.state, {side, quoteAmount: BigInt(r.quoteAmount), tokenAmount: BigInt(r.tokenAmount)})});
    }
    return [...out.values()];
}

/** Wire form (all strings; realized may be negative). */
export function positionOut(f: FoldedPosition) {
    const s = f.state;
    return {
        curve: f.curve,
        token: f.token,
        name: f.name,
        symbol: f.symbol,
        cost: s.cost.toString(),
        tracked: s.tracked.toString(),
        realized: s.realized.toString(),
        buyQuote: s.buyQuote.toString(),
        buyTokens: s.buyTokens.toString(),
        sellQuote: s.sellQuote.toString(),
        sellTokens: s.sellTokens.toString(),
    };
}
