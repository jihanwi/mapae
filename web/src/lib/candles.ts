// Pure candle chart geometry. Prices and volumes stay bigint (wad); they are turned into Number
// only as ratios for screen coordinates. Nothing here is used for amounts.
export type CandleIn = {t: string; o: string; h: string; l: string; c: string; v: string};
export type Candle = {t: number; o: bigint; h: bigint; l: bigint; c: bigint; v: bigint};

export const parseCandles = (xs: readonly CandleIn[]): Candle[] =>
    xs.map((x) => ({t: Number(x.t), o: BigInt(x.o), h: BigInt(x.h), l: BigInt(x.l), c: BigInt(x.c), v: BigInt(x.v)}));

/** Minimum horizontal room per candle (px). */
export const MIN_SLOT = 8;

/** How many of the newest candles fit in `width` (at least 1 when there is any candle). */
export function visibleCount(total: number, width: number, minSlot = MIN_SLOT): number {
    if (total === 0) return 0;
    return Math.max(1, Math.min(total, Math.floor(width / minSlot)));
}

/** Price range with 5% padding; a flat range is widened by 1% (or 1 wei) so it has height. */
export function priceRange(cs: readonly Candle[]): {lo: bigint; hi: bigint} {
    let lo = cs[0].l;
    let hi = cs[0].h;
    for (const c of cs) {
        if (c.l < lo) lo = c.l;
        if (c.h > hi) hi = c.h;
    }
    let pad = (hi - lo) / 20n;
    if (hi === lo) pad = hi / 100n > 0n ? hi / 100n : 1n;
    return {lo: lo - pad < 0n ? 0n : lo - pad, hi: hi + pad};
}

/** Ratio a/b as a Number in [0, 1] (screen use only). */
const ratio = (a: bigint, b: bigint) => (b === 0n ? 0 : Number((a * 1_000_000n) / b) / 1_000_000);

export type Bar = {x: number; w: number; wickTop: number; wickBottom: number; bodyTop: number; bodyH: number; up: boolean; volTop: number; volH: number; candle: Candle};
export type Layout = {bars: Bar[]; ticks: {y: number; price: bigint}[]; priceH: number; lo: bigint; hi: bigint};

/** Lay out the newest candles that fit: top `priceFrac` of the height for candles, the rest for volume. */
export function layoutCandles(all: readonly Candle[], width: number, height: number, priceFrac = 0.75, gapPx = 4): Layout {
    const n = visibleCount(all.length, width);
    const cs = all.slice(all.length - n);
    const priceH = Math.round(height * priceFrac);
    const volH = height - priceH - gapPx;
    if (n === 0) return {bars: [], ticks: [], priceH, lo: 0n, hi: 0n};
    const {lo, hi} = priceRange(cs);
    const span = hi - lo;
    const y = (p: bigint) => priceH * (1 - ratio(p - lo, span));
    let maxV = 0n;
    for (const c of cs) if (c.v > maxV) maxV = c.v;
    const slot = width / n;
    const w = Math.max(1, Math.min(slot * 0.6, 14));
    const bars = cs.map((c, i): Bar => {
        const top = y(c.o > c.c ? c.o : c.c);
        const bottom = y(c.o > c.c ? c.c : c.o);
        const vh = Math.max(maxV > 0n && c.v > 0n ? 1 : 0, volH * ratio(c.v, maxV));
        return {
            x: slot * (i + 0.5),
            w,
            wickTop: y(c.h),
            wickBottom: y(c.l),
            bodyTop: c.o === c.c ? top - 0.5 : top,
            bodyH: c.o === c.c ? 1 : Math.max(1, bottom - top),
            up: c.c >= c.o,
            volTop: height - vh,
            volH: vh,
            candle: c,
        };
    });
    const ticks = [0n, 1n, 2n, 3n].map((k) => {
        const price = lo + (span * k) / 3n;
        return {y: y(price), price};
    });
    return {bars, ticks, priceH, lo, hi};
}

/** Index of the visible candle under x (clamped). */
export function barIndexAt(x: number, width: number, n: number): number {
    if (n <= 0) return -1;
    return Math.min(n - 1, Math.max(0, Math.floor(x / (width / n))));
}
