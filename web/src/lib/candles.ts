// Pure candle chart geometry. Prices and volumes stay bigint (wad); they are turned into Number
// only as ratios for screen coordinates. Nothing here is used for amounts.
export type CandleIn = {t: string; o: string; h: string; l: string; c: string; v: string};
export type Candle = {t: number; o: bigint; h: bigint; l: bigint; c: bigint; v: bigint};

export const parseCandles = (xs: readonly CandleIn[]): Candle[] =>
    xs.map((x) => ({t: Number(x.t), o: BigInt(x.o), h: BigInt(x.h), l: BigInt(x.l), c: BigInt(x.c), v: BigInt(x.v)}));

/** Minimum horizontal room per candle in the default view (px). */
export const MIN_SLOT = 8;
/** Zoom limits for one candle slot (px), and the default view's upper bound. */
export const SLOT_MIN = 3;
export const SLOT_MAX = 48;
export const SLOT_DEFAULT_MAX = 18;
/** Empty space right of the newest candle (px). */
export const RIGHT_PAD = 12;

/** How many of the newest candles fit in `width` at MIN_SLOT (at least 1 when there is any candle). */
export function visibleCount(total: number, width: number, minSlot = MIN_SLOT): number {
    if (total === 0) return 0;
    return Math.max(1, Math.min(total, Math.floor(width / minSlot)));
}

/** What part of the series is on screen: `slot` px per candle, `offset` newest candles hidden
 *  past the right edge (0 = the newest candle is visible). */
export type View = {slot: number; offset: number};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Candles that fit right of the left edge at `slot` px. */
export const capacity = (width: number, slot: number) => Math.max(0, Math.floor((width - RIGHT_PAD) / slot));

/** Upper bound for `offset`: never hide the newest candles to open empty space on the left.
 *  When every candle fits (total <= capacity) the offset is always 0; otherwise panning stops
 *  when the oldest candle reaches the left edge. */
export const maxOffset = (total: number, width: number, slot: number) => Math.max(0, total - capacity(width, slot));

const clampOffset = (o: number, total: number, width: number, slot: number) => clamp(Math.round(o), 0, maxOffset(total, width, slot));

/** Default view: fill the width, but never wider than SLOT_DEFAULT_MAX or narrower than MIN_SLOT. */
export function defaultView(total: number, width: number): View {
    return {slot: total === 0 ? SLOT_DEFAULT_MAX : clamp(width / total, MIN_SLOT, SLOT_DEFAULT_MAX), offset: 0};
}

/** Keep a view inside the series (after the data or the width changed). */
export function fitView(v: View, total: number, width: number): View {
    const slot = clamp(v.slot, SLOT_MIN, SLOT_MAX);
    return {slot, offset: clampOffset(v.offset, total, width, slot)};
}

/** Candles from the newest (offset-adjusted) at screen x: fractional, 0 = centre of the rightmost slot. */
const slotsFromRight = (x: number, width: number, slot: number) => (width - RIGHT_PAD - x) / slot - 0.5;

/** Zoom by `factor` keeping the candle under `cursorX` under the cursor. */
export function zoomAt(view: View, factor: number, cursorX: number, width: number, total: number): View {
    const slot = clamp(view.slot * factor, SLOT_MIN, SLOT_MAX);
    const k = slotsFromRight(cursorX, width, view.slot) + view.offset;
    return {slot, offset: clampOffset(k - slotsFromRight(cursorX, width, slot), total, width, slot)};
}

/** Pan by a drag of `dxPx`: dragging right (dx > 0) reveals older candles. */
export function panBy(view: View, dxPx: number, total: number, width: number): View {
    return {slot: view.slot, offset: clampOffset(view.offset + dxPx / view.slot, total, width, view.slot)};
}

/** Price range with 8% padding above and below; a flat range is widened by 1% (or 1 wei). */
export function priceRange(cs: readonly Candle[]): {lo: bigint; hi: bigint} {
    let lo = cs[0].l;
    let hi = cs[0].h;
    for (const c of cs) {
        if (c.l < lo) lo = c.l;
        if (c.h > hi) hi = c.h;
    }
    let pad = ((hi - lo) * 8n) / 100n;
    if (hi === lo) pad = hi / 100n > 0n ? hi / 100n : 1n;
    return {lo: lo - pad < 0n ? 0n : lo - pad, hi: hi + pad};
}

/** Ratio a/b as a Number in [0, 1] (screen use only). */
const ratio = (a: bigint, b: bigint) => (b === 0n ? 0 : Number((a * 1_000_000n) / b) / 1_000_000);

export type Bar = {x: number; w: number; wickTop: number; wickBottom: number; bodyTop: number; bodyH: number; up: boolean; volTop: number; volH: number; candle: Candle};
export type Layout = {bars: Bar[]; ticks: {y: number; price: bigint}[]; priceH: number; lo: bigint; hi: bigint; slot: number};

/** Minimum space between the price area and the volume area (px). */
export const AREA_GAP = 8;

/** Lay out the candles of `view` (default view when omitted), anchored to the right edge:
 *  the k-th visible candle from the newest has its centre at width - RIGHT_PAD - slot * (k + 0.5).
 *  Candles whose centre would fall left of slot / 2 are not drawn. Bodies are 70% of the slot,
 *  so the gap between neighbours is always 30% of it. Top `priceFrac` of the height is the price
 *  area, the rest (after `gapPx`) the volume area; both scale to the visible candles only. */
/** Market cap candles: every price times the 1,000,000,000 total supply (prices are quote wei per
 *  whole token, so the result is quote wei). Volume is unchanged. A positive factor keeps every
 *  open / high / low / close ordering, so the candles keep their shape. */
export const TOKEN_SUPPLY_WHOLE = 1_000_000_000n;
export function toMarketCap(cs: readonly Candle[]): Candle[] {
    const k = TOKEN_SUPPLY_WHOLE;
    return cs.map((c) => ({...c, o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k}));
}

/** Log price axis: [ln lo, ln hi] with 8% padding in log space (a flat range is widened by 1%). */
function logRange(cs: readonly Candle[]): {a: number; b: number} {
    let lo = Infinity;
    let hi = 0;
    for (const c of cs) {
        const l = Number(c.l);
        const h = Number(c.h);
        if (l > 0 && l < lo) lo = l;
        if (h > hi) hi = h;
    }
    if (!(lo > 0) || !(hi > 0)) return {a: 0, b: 1};
    let a = Math.log(lo);
    let b = Math.log(hi);
    if (b - a < 1e-12) {
        a -= Math.log(1.01);
        b += Math.log(1.01);
    } else {
        const pad = (b - a) * 0.08;
        a -= pad;
        b += pad;
    }
    return {a, b};
}

/** y of a price on a log axis of height h over [a, b] = [ln lo, ln hi] (larger values higher). */
export function logY(p: bigint, a: number, b: number, h: number): number {
    const v = Number(p);
    const lv = v > 0 ? Math.log(v) : a;
    return h * (1 - (lv - a) / (b - a));
}

export function layoutCandles(all: readonly Candle[], width: number, height: number, view?: View, priceFrac = 0.75, gapPx = AREA_GAP, log = false): Layout {
    const v = fitView(view ?? defaultView(all.length, width), all.length, width);
    const slot = v.slot;
    const priceH = Math.round(height * priceFrac);
    const volH = height - priceH - gapPx;
    const fit = Math.max(0, Math.floor((width - RIGHT_PAD - slot / 2) / slot + 0.5));
    const end = all.length - v.offset;
    const cs = all.slice(Math.max(0, end - fit), end);
    if (cs.length === 0) return {bars: [], ticks: [], priceH, lo: 0n, hi: 0n, slot};
    let {lo, hi} = priceRange(cs);
    const span = hi - lo;
    let y = (p: bigint) => priceH * (1 - ratio(p - lo, span));
    let ticks: {y: number; price: bigint}[] = [0n, 1n, 2n, 3n].map((k) => {
        const price = lo + (span * k) / 3n;
        return {y: y(price), price};
    });
    if (log) {
        // log axis: heights and ticks from ln(price); equal ratios get equal heights
        const {a, b} = logRange(cs);
        y = (p: bigint) => logY(p, a, b, priceH);
        lo = BigInt(Math.max(0, Math.round(Math.exp(a))));
        hi = BigInt(Math.round(Math.exp(b)));
        ticks = [0, 1, 2, 3].map((k) => {
            const price = BigInt(Math.max(1, Math.round(Math.exp(a + ((b - a) * k) / 3))));
            return {y: y(price), price};
        });
    }
    let maxV = 0n;
    for (const c of cs) if (c.v > maxV) maxV = c.v;
    const w = clamp(slot * 0.7, 1, 28);
    const n = cs.length;
    const bars = cs
        .map((c, i): Bar => {
            const k = n - 1 - i;
            const top = y(c.o > c.c ? c.o : c.c);
            const bottom = y(c.o > c.c ? c.c : c.o);
            const vh = Math.max(maxV > 0n && c.v > 0n ? 1 : 0, volH * ratio(c.v, maxV));
            return {
                x: width - RIGHT_PAD - slot * (k + 0.5),
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
        })
        .filter((b) => b.x >= slot / 2);
    return {bars, ticks, priceH, lo, hi, slot};
}

/** Estimated width of a time label under the chart (px, 11 px tabular text). */
/** Room for the widest label ("11월 15일 오후 04:50", "Nov 15, 04:50 PM") at 11 px. */
export const TIME_LABEL_W = 128;

export type TimeLabel = {bar: "first" | "last"; left: number; align: "left" | "center" | "right"};

/** Time labels under the first and last visible candles, each centred on its candle and kept
 *  inside [0, plotW]. A label pushed against the left edge is left-aligned, against the right edge
 *  right-aligned, so its text is never cut. If they would overlap only the last one is kept; one
 *  candle -> one label. */
export function timeLabels(bars: readonly Bar[], plotW: number, labelW = TIME_LABEL_W): TimeLabel[] {
    if (bars.length === 0) return [];
    const maxLeft = Math.max(0, plotW - labelW);
    const place = (bar: TimeLabel["bar"], x: number): TimeLabel => {
        const want = x - labelW / 2;
        if (want <= 0) return {bar, left: 0, align: "left"};
        if (want >= maxLeft) return {bar, left: maxLeft, align: "right"};
        return {bar, left: want, align: "center"};
    };
    const last = place("last", bars[bars.length - 1].x);
    if (bars.length === 1) return [last];
    const first = place("first", bars[0].x);
    return last.left - first.left < labelW ? [last] : [first, last];
}

/** Index (in `bars`) of the candle nearest to x; -1 when there is none or x is a full slot or
 *  more left of the leftmost candle. `slot` defaults to the spacing of the bars. */
export function barIndexAt(x: number, bars: readonly Bar[], slot?: number): number {
    if (bars.length === 0) return -1;
    const s = slot ?? (bars.length > 1 ? bars[1].x - bars[0].x : bars[0].w / 0.7);
    if (x <= bars[0].x - s) return -1;
    let best = 0;
    for (let i = 1; i < bars.length; i++) if (Math.abs(bars[i].x - x) < Math.abs(bars[best].x - x)) best = i;
    return best;
}

// ---------------------------------------------------------------------------------------------
// Live merge and display adjustments
// ---------------------------------------------------------------------------------------------

export const MAX_CANDLES = 300;

/** A browser RPC trade of this curve (Buy, Sell or Swapped), with its interpolated time and its
 *  price under the server's definition (activity.tradePriceWad: curve trades = post-trade spot,
 *  pool trades = average executed price). */
export type LiveTrade = {block: bigint; logIndex: number; ts: number | undefined; quoteAmount: bigint; tokenAmount: bigint; priceWad: bigint};

/** Which browser trades to add on top of the server candles (the indexedBlock argument of
 *  mergeLiveCandles, or undefined = add none):
 *  - candle API down: null = every browser trade;
 *  - indexer position known: only trades after it;
 *  - position unknown (null or no summary) and no server candles: null = every browser trade
 *    (nothing on the server can be counted twice; e.g. just after a version switch);
 *  - position unknown but server candles exist: undefined = add none (they could be counted twice). */
export function liveFrom(p: {candlesOk: boolean; serverCount: number; indexedBlock: string | null | undefined}): bigint | null | undefined {
    if (!p.candlesOk) return null;
    if (p.indexedBlock !== null && p.indexedBlock !== undefined) return BigInt(p.indexedBlock);
    return p.serverCount === 0 ? null : undefined;
}

/** Server candles plus browser trades after indexedBlock, bucketed at `interval` seconds with the
 *  server's price definition (LiveTrade.priceWad, see activity.tradePriceWad). A trade at or below indexedBlock is
 *  already in the server candles and is skipped; with no server index (null) every trade counts.
 *  A trade in an existing bucket updates its h, l, c and v; otherwise it opens a new bucket. */
export function mergeLiveCandles(server: readonly Candle[], live: readonly LiveTrade[], indexedBlock: bigint | null, interval: number): Candle[] {
    const byT = new Map<number, Candle>(server.map((c) => [c.t, {...c}]));
    const fresh = live
        .filter((x) => (indexedBlock === null || x.block > indexedBlock) && x.tokenAmount > 0n && x.ts !== undefined)
        .sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
    for (const x of fresh) {
        const price = x.priceWad;
        const t = Math.floor((x.ts as number) / interval) * interval;
        const c = byT.get(t);
        if (c) {
            if (price > c.h) c.h = price;
            if (price < c.l) c.l = price;
            c.c = price;
            c.v += x.quoteAmount;
        } else {
            byT.set(t, {t, o: price, h: price, l: price, c: price, v: x.quoteAmount});
        }
    }
    return [...byT.values()].sort((a, b) => a.t - b.t).slice(-MAX_CANDLES);
}

/** Display only: from the second candle on, open = previous close (h and l widened to include it). */
export function connectOpens(cs: readonly Candle[]): Candle[] {
    return cs.map((c, i) => {
        if (i === 0) return c;
        const o = cs[i - 1].c;
        return {...c, o, h: c.h > o ? c.h : o, l: c.l < o ? c.l : o};
    });
}
