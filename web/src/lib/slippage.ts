// Slippage tolerance, price impact and the re-quote guard. Pure and bigint only (no floats).
// The quote already includes the order's own price impact; the tolerance only covers what other
// trades move between the quote and execution.

export const WINDOW_SEC = 600;
export const MULTIPLIER = 2n;
export const MIN_BPS = 100;
export const MAX_BPS = 1500;
export const BPS = 10_000n;
const WAD = 10n ** 18n;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const abs = (x: bigint) => (x < 0n ? -x : x);

export type PricePoint = {ts: number; priceWad: bigint};

/** clamp(2 * M, 1%, 15%) where M is the largest step |p2 / p1 - 1| between consecutive trades in
 *  the last WINDOW_SEC (the last trade before the window is the first reference). Rounded up. */
export function autoSlippageBps(trades: readonly PricePoint[], nowTs: number): number {
    const start = nowTs - WINDOW_SEC;
    const sorted = trades.filter((t) => t.priceWad > 0n).map((t, i) => ({...t, i})).sort((a, b) => a.ts - b.ts || a.i - b.i);
    const inWindow = sorted.filter((t) => t.ts >= start && t.ts <= nowTs);
    const before = sorted.filter((t) => t.ts < start).at(-1);
    const seq = before ? [before, ...inWindow] : inWindow;
    if (seq.length < 2) return MIN_BPS;
    let m = 0n;
    for (let k = 1; k < seq.length; k++) {
        const p1 = seq[k - 1].priceWad;
        const step = ceilDiv(abs(seq[k].priceWad - p1) * BPS, p1);
        if (step > m) m = step;
    }
    const bps = m * MULTIPLIER;
    return Number(bps < BigInt(MIN_BPS) ? BigInt(MIN_BPS) : bps > BigInt(MAX_BPS) ? BigInt(MAX_BPS) : bps);
}

// ---------------------------------------------------------------------------------------------
// Preference (auto / presets / custom) and storage
// ---------------------------------------------------------------------------------------------

export const PRESETS = [100, 300, 500] as const;
export type SlippagePref = {mode: "auto"} | {mode: "preset"; bps: (typeof PRESETS)[number]} | {mode: "custom"; bps: number};
export const DEFAULT_PREF: SlippagePref = {mode: "auto"};
export const STORAGE_KEY = "mapae.slippage";
export const HIGH_WARN_BPS = 1500;

export type CustomParse = {ok: true; bps: number} | {ok: false; reason: "empty" | "format" | "range"};
/** "0.1" .. "50", at most one decimal. Returns bps (1% = 100). */
export function parseCustomSlippage(raw: string): CustomParse {
    const s = raw.trim();
    if (s === "") return {ok: false, reason: "empty"};
    if (!/^\d{1,2}(\.\d)?$/.test(s)) return {ok: false, reason: "format"};
    const [i, f = "0"] = s.split(".");
    const tenths = Number(i) * 10 + Number(f);
    if (tenths < 1 || tenths > 500) return {ok: false, reason: "range"};
    return {ok: true, bps: tenths * 10};
}

/** The custom field blocks trading while it is open with a non-empty value that does not parse
 *  (out of range or malformed). Empty keeps the previous setting and does not block. */
export function customSlippageBlocks(editing: boolean, raw: string): boolean {
    return editing && raw.trim() !== "" && !parseCustomSlippage(raw).ok;
}

export function decodePref(raw: string | null): SlippagePref {
    if (!raw) return DEFAULT_PREF;
    try {
        const p = JSON.parse(raw) as Partial<{mode: string; bps: number}>;
        if (p.mode === "auto") return DEFAULT_PREF;
        if (p.mode === "preset" && (PRESETS as readonly number[]).includes(p.bps as number)) return {mode: "preset", bps: p.bps as (typeof PRESETS)[number]};
        if (p.mode === "custom" && Number.isInteger(p.bps) && (p.bps as number) >= 10 && (p.bps as number) <= 5000 && (p.bps as number) % 10 === 0) {
            return {mode: "custom", bps: p.bps as number};
        }
    } catch {
        // broken value: back to auto
    }
    return DEFAULT_PREF;
}

let memoryPref: string | null = null;
export function loadPref(): SlippagePref {
    try {
        return decodePref(window.localStorage.getItem(STORAGE_KEY));
    } catch {
        return decodePref(memoryPref);
    }
}
export function savePref(p: SlippagePref): void {
    const v = JSON.stringify(p);
    memoryPref = v;
    try {
        window.localStorage.setItem(STORAGE_KEY, v);
    } catch {
        // memory only
    }
}

export const effectiveBps = (p: SlippagePref, autoBps: number) => (p.mode === "auto" ? autoBps : p.bps);

/** Minimum output for a quote and a tolerance, rounded down. */
export const minOut = (quote: bigint, bps: number) => (quote * (BPS - BigInt(bps))) / BPS;

/** "2.4" style percent label for bps (one decimal, rounded up so it never understates). */
export function pctOneDecimal(bps: number): string {
    const tenths = Math.ceil(bps / 10);
    return tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

// ---------------------------------------------------------------------------------------------
// Price impact (fees excluded: the average is the pure curve/pool price of the order)
// ---------------------------------------------------------------------------------------------

/** Average price in wad (quote per token). */
export const avgPriceWad = (quote: bigint, tokens: bigint) => (tokens === 0n ? 0n : (quote * WAD) / tokens);

/** Buy: avg / spot - 1. Sell: 1 - avg / spot. In bps, rounded up, never below 0. */
export function priceImpactBps(side: "buy" | "sell", spotWad: bigint, avgWad: bigint): bigint {
    if (spotWad <= 0n || avgWad <= 0n) return 0n;
    const diff = side === "buy" ? avgWad - spotWad : spotWad - avgWad;
    return diff <= 0n ? 0n : ceilDiv(diff * BPS, spotWad);
}
export const IMPACT_WARN_BPS = 1000n;

/** "x.xx" percent for bps. */
export const pctTwoDecimals = (bps: bigint) => `${bps / 100n}.${(bps % 100n).toString().padStart(2, "0")}`;

/** Curve buy: net quote into the curve = quoteSpent - fees. Curve sell: gross out = quoteOut + fees. */
export const curveBuyAvg = (quoteSpent: bigint, fees: bigint, tokensOut: bigint) => avgPriceWad(quoteSpent - fees, tokensOut);
export const curveSellAvg = (quoteOut: bigint, fees: bigint, tokenIn: bigint) => avgPriceWad(quoteOut + fees, tokenIn);

/** Pool (x * y = k) impact without fees. Buy with net quote x: x / reserveQuote.
 *  Sell token y: y / (reserveToken + y). */
export function poolImpactBps(side: "buy" | "sell", amountIn: bigint, reserveQuote: bigint, reserveToken: bigint, feeBps: bigint): bigint {
    if (reserveQuote <= 0n || reserveToken <= 0n || amountIn <= 0n) return 0n;
    if (side === "buy") {
        const x = (amountIn * (BPS - feeBps)) / BPS;
        return ceilDiv(x * BPS, reserveQuote);
    }
    return ceilDiv(amountIn * BPS, reserveToken + amountIn);
}

// ---------------------------------------------------------------------------------------------
// Re-quote guard (state machine)
// ---------------------------------------------------------------------------------------------

/** Fresh on-chain quote vs the quote the user saw: within tolerance -> proceed with a minimum
 *  based on the fresh quote; worse than the tolerance allows -> ask the user. */
export function requoteDecision(seen: bigint, fresh: bigint, bps: number): {kind: "proceed"; min: bigint} | {kind: "confirm"} {
    return fresh < minOut(seen, bps) ? {kind: "confirm"} : {kind: "proceed", min: minOut(fresh, bps)};
}

export type GuardState = {kind: "idle"} | {kind: "moved"; fresh: bigint} | {kind: "sentFailed"};
export type GuardEvent =
    | {type: "requoted"; seen: bigint; fresh: bigint; bps: number}
    | {type: "simulateFailed"; reason: "InsufficientOutput" | "other"; fresh: bigint}
    | {type: "sentFailed"; reason: "InsufficientOutput" | "other"}
    | {type: "reset"};

export function guardReducer(s: GuardState, e: GuardEvent): GuardState {
    switch (e.type) {
        case "requoted":
            return requoteDecision(e.seen, e.fresh, e.bps).kind === "confirm" ? {kind: "moved", fresh: e.fresh} : {kind: "idle"};
        case "simulateFailed":
            // other reasons go through the existing error handling (toast), not this panel
            return e.reason === "InsufficientOutput" ? {kind: "moved", fresh: e.fresh} : s;
        case "sentFailed":
            return e.reason === "InsufficientOutput" ? {kind: "sentFailed"} : s;
        case "reset":
            return {kind: "idle"};
    }
}

/** design-token-page: the collapsed slippage line, "Auto 1%" or "1%": whether the setting is auto
 *  and the effective percent (one decimal at most). */
export function slipSummary(pref: SlippagePref, autoBps: number): {auto: boolean; pct: string} {
    return {auto: pref.mode === "auto", pct: pctOneDecimal(effectiveBps(pref, autoBps))};
}
