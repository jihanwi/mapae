// Trust signals card and chart trade markers (decision 51). Facts only: shares of the supply or of
// the circulating amount, counts and times. No score, grade or colour by value. Pure; tested.
import {TOTAL_SUPPLY} from "./curveMath";

/** GET /api/chain/holders `signals` (wei strings). */
export type ServerSignals = {
    devFirstBuy: string;
    devBought: string;
    devSold: string;
    devSellCount: number;
    devLastSellTs: string | null;
    devBalance: string;
    devTransferredOut: string;
    top10: string;
    circulating: string;
    verifiedHeld: string;
    verifiedHolders: number;
    holdersCount: number;
};

/** part / whole in basis points, floored; null when whole is 0 (no share to show). */
export function ratioBps(part: bigint, whole: bigint): bigint | null {
    if (whole <= 0n) return null;
    return (part * 10_000n) / whole;
}

/** 240 -> "2.4%", 1234 -> "12.34%", 0 -> "0%" (two decimals at most, trailing zeros dropped). */
export function pctText(bps: bigint): string {
    const whole = bps / 100n;
    const frac = (bps % 100n).toString().padStart(2, "0").replace(/0+$/, "");
    return `${whole}${frac ? "." + frac : ""}%`;
}

export type TrustView = {
    /** null: no Dev buy in the launch tx ("None"). */
    devFirstBuyBps: bigint | null;
    devHoldsBps: bigint;
    /** null: the Dev never sold ("None"). soldOfBoughtBps null when the Dev never bought. */
    devSells: {count: number; soldOfBoughtBps: bigint | null; lastTs: number | null} | null;
    /** null: nothing sent out (the line is hidden). */
    devOutBps: bigint | null;
    /** null when nothing circulates ("–"). */
    top10Bps: bigint | null;
    verifiedBps: bigint | null;
    verifiedHolders: number;
    holdersCount: number;
};

export function trustView(s: ServerSignals): TrustView {
    const firstBuy = BigInt(s.devFirstBuy);
    const bought = BigInt(s.devBought);
    const sold = BigInt(s.devSold);
    const out = BigInt(s.devTransferredOut);
    const circulating = BigInt(s.circulating);
    return {
        devFirstBuyBps: firstBuy > 0n ? ratioBps(firstBuy, TOTAL_SUPPLY) : null,
        devHoldsBps: ratioBps(BigInt(s.devBalance), TOTAL_SUPPLY) ?? 0n,
        devSells:
            s.devSellCount > 0
                ? {count: s.devSellCount, soldOfBoughtBps: ratioBps(sold, bought), lastTs: s.devLastSellTs === null ? null : Number(s.devLastSellTs)}
                : null,
        devOutBps: out > 0n ? ratioBps(out, TOTAL_SUPPLY) : null,
        top10Bps: ratioBps(BigInt(s.top10), circulating),
        verifiedBps: ratioBps(BigInt(s.verifiedHeld), circulating),
        verifiedHolders: s.verifiedHolders,
        holdersCount: s.holdersCount,
    };
}

// ---------------------------------------------------------------------------------------------
// Chart markers
// ---------------------------------------------------------------------------------------------

export type MarkerTrade = {ts: number; side: "buy" | "sell"; who: "dev" | "me"};
export type CandleMarks = {devBuy: boolean; devSell: boolean; myBuy: boolean; mySell: boolean};

/** Trades -> marks per candle start time (`interval` seconds). One mark per direction and per
 *  owner in a candle, however many trades fall in it; trades outside the shown candles are dropped. */
export function marksByCandle(trades: readonly MarkerTrade[], candleTimes: readonly number[], interval: number): Map<number, CandleMarks> {
    const shown = new Set(candleTimes);
    const out = new Map<number, CandleMarks>();
    for (const t of trades) {
        const bucket = Math.floor(t.ts / interval) * interval;
        if (!shown.has(bucket)) continue;
        const m = out.get(bucket) ?? {devBuy: false, devSell: false, myBuy: false, mySell: false};
        if (t.who === "dev") {
            if (t.side === "buy") m.devBuy = true;
            else m.devSell = true;
        } else if (t.side === "buy") m.myBuy = true;
        else m.mySell = true;
        out.set(bucket, m);
    }
    return out;
}

/** Which mark sources the chart draws. A connected wallet that is the Dev gets one "D" per trade
 *  (its trades are the Dev's), drawn while either toggle is on; otherwise Dev marks follow the
 *  "Dev trades" toggle and B / S marks the "My trades" toggle (with a wallet connected). */
export function markSources(p: {dev: string | undefined; me: string | undefined; showDev: boolean; showMine: boolean}): {dev: boolean; mine: boolean} {
    const meIsDev = !!p.me && !!p.dev && p.me.toLowerCase() === p.dev.toLowerCase();
    if (meIsDev) return {dev: p.showDev || p.showMine, mine: false};
    return {dev: p.showDev && !!p.dev, mine: p.showMine && !!p.me};
}
