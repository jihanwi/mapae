// Shared feed helpers: a ticking clock for relative times and trade amount formatting.
import {useEffect, useState} from "react";
import {Copy} from "../copy";
import {Trade} from "../lib/activity";
import {agoOf, fmt, fmtCeil} from "../lib/format";

/** Unix seconds, refreshed every `ms` so "3 min ago" labels move without new data. */
export function useNow(ms = 15_000): number {
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
    useEffect(() => {
        const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
        return () => clearInterval(id);
    }, [ms]);
    return now;
}

export function agoLabel(tr: Copy, nowSec: number, tsSec: number): string {
    const a = agoOf(nowSec, tsSec);
    return a.unit === "now" ? tr.feed.ago.now : tr.feed.ago[a.unit](a.n);
}

/** Pair asset unit of a trade: WETH for pool swaps of an ETH curve, else the curve's unit. */
export const tradeUnit = (t: Trade, isEth: boolean) => (isEth ? (t.venue === "pool" ? "WETH" : "ETH") : "KRWs");

/** Pair asset amount: paid on a buy (round up), received on a sell (round down). */
export function tradeAmount(t: Trade, isEth: boolean, locale: string): string {
    const dp = isEth ? 6 : 0;
    return t.side === "buy" ? fmtCeil(t.quoteAmount, dp, locale) : fmt(t.quoteAmount, dp, locale);
}

/** True when the user asked the OS for reduced motion. */
export function prefersReducedMotion(): boolean {
    try {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
        return false;
    }
}
