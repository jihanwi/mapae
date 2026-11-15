import {describe, expect, it} from "vitest";
import {AREA_GAP, barIndexAt, Candle, connectOpens, defaultView, layoutCandles, LiveTrade, mergeLiveCandles, MIN_SLOT, panBy, parseCandles, priceRange, RIGHT_PAD, SLOT_DEFAULT_MAX, SLOT_MAX, SLOT_MIN, View, visibleCount, zoomAt} from "./candles";

const E18 = 10n ** 18n;
const c = (t: number, o: bigint, h: bigint, l: bigint, cl: bigint, v: bigint): Candle => ({t, o, h, l, c: cl, v});

describe("candles", () => {
    it("parses API rows into bigints", () => {
        expect(parseCandles([{t: "300", o: "1", h: "3", l: "1", c: "2", v: "10"}])).toEqual([{t: 300, o: 1n, h: 3n, l: 1n, c: 2n, v: 10n}]);
    });
    it("fits the newest candles in the width, at least one", () => {
        expect(visibleCount(0, 400)).toBe(0);
        expect(visibleCount(1, 400)).toBe(1);
        expect(visibleCount(300, 400)).toBe(50);
        expect(visibleCount(10, 400)).toBe(10);
        expect(visibleCount(5, 3)).toBe(1);
    });
    it("pads the price range and widens a flat one", () => {
        expect(priceRange([c(0, 100n, 200n, 100n, 150n, 1n)])).toEqual({lo: 92n, hi: 208n});
        expect(priceRange([c(0, E18, E18, E18, E18, 1n)])).toEqual({lo: E18 - E18 / 100n, hi: E18 + E18 / 100n});
        expect(priceRange([c(0, 5n, 5n, 5n, 5n, 1n)])).toEqual({lo: 4n, hi: 6n});
    });
    it("lays out up/down bodies, wicks and volume", () => {
        const cs = [c(0, 100n, 200n, 100n, 200n, 10n), c(300, 200n, 200n, 100n, 100n, 5n), c(600, 150n, 150n, 150n, 150n, 0n)];
        const L = layoutCandles(cs, 300, 200);
        expect(L.priceH).toBe(150);
        expect(L.bars.map((b) => b.up)).toEqual([true, false, true]);
        // right-anchored at the default slot (300 / 3 > 18, so 18 px)
        expect(L.bars.map((b) => b.x)).toEqual([300 - RIGHT_PAD - 18 * 2.5, 300 - RIGHT_PAD - 18 * 1.5, 300 - RIGHT_PAD - 18 * 0.5]);
        // highest wick is near the top, lowest near the bottom of the price area
        expect(L.bars[0].wickTop).toBeLessThan(L.bars[0].wickBottom);
        expect(L.bars[0].wickTop).toBeGreaterThan(0);
        expect(L.bars[0].wickBottom).toBeLessThan(150);
        // o == c gets a 1px body
        expect(L.bars[2].bodyH).toBe(1);
        // volume scales to the largest bar; zero volume has no bar
        expect(L.bars[0].volH).toBeCloseTo(200 - 150 - AREA_GAP);
        expect(L.bars[1].volH).toBeCloseTo((200 - 150 - AREA_GAP) / 2);
        expect(L.bars[2].volH).toBe(0);
        expect(L.ticks).toHaveLength(4);
        expect(L.ticks[0].price).toBe(L.lo);
        expect(L.ticks[3].price).toBe(L.hi);
    });
    it("draws only the newest candles that fit", () => {
        const cs = Array.from({length: 100}, (_, i) => c(i * 300, 10n, 12n, 9n, 11n, 1n));
        const L = layoutCandles(cs, 80, 100);
        // default slot = MIN_SLOT (8): floor((80 - 12) / 8) = 8 candles fit
        expect(L.bars).toHaveLength(8);
        expect(L.bars[7].candle.t).toBe(99 * 300);
    });
    it("draws a single candle and nothing for none", () => {
        expect(layoutCandles([c(0, 1n, 2n, 1n, 2n, 1n)], 300, 200).bars).toHaveLength(1);
        expect(layoutCandles([], 300, 200).bars).toEqual([]);
    });
    it("maps x to the nearest candle; -1 a full slot left of the first or when empty", () => {
        const cs = [c(0, 1n, 2n, 1n, 2n, 1n), c(300, 1n, 2n, 1n, 2n, 1n), c(600, 1n, 2n, 1n, 2n, 1n)];
        const L = layoutCandles(cs, 300, 200);
        const [a, b, cc] = L.bars.map((x) => x.x);
        expect(barIndexAt(a, L.bars, L.slot)).toBe(0);
        expect(barIndexAt(b + 1, L.bars, L.slot)).toBe(1);
        expect(barIndexAt(999, L.bars, L.slot)).toBe(2);
        expect(barIndexAt(cc, L.bars)).toBe(2); // slot inferred from spacing
        expect(barIndexAt(a - L.slot + 0.5, L.bars, L.slot)).toBe(0);
        expect(barIndexAt(a - L.slot, L.bars, L.slot)).toBe(-1);
        expect(barIndexAt(10, [], 18)).toBe(-1);
    });
});

describe("price and volume areas", () => {
    it("the lowest candle's bottom stays above the volume area", () => {
        const cs = [c(0, 100n, 300n, 100n, 300n, 10n), c(300, 300n, 300n, 50n, 60n, 10n), c(600, 60n, 120n, 60n, 120n, 10n)];
        for (const h of [120, 200, 400]) {
            const L = layoutCandles(cs, 300, h);
            const volStart = h - Math.max(...L.bars.map((b) => b.volH));
            const lowest = Math.max(...L.bars.map((b) => Math.max(b.wickBottom, b.bodyTop + b.bodyH)));
            expect(lowest).toBeLessThan(volStart);
            expect(volStart - L.priceH).toBeGreaterThanOrEqual(AREA_GAP);
        }
    });
});

const live = (block: number, ts: number, quote: bigint, token: bigint, i = 0): LiveTrade => ({block: BigInt(block), logIndex: i, ts, quoteAmount: quote, tokenAmount: token});

describe("mergeLiveCandles", () => {
    it("builds candles from browser trades alone (no server candles)", () => {
        const m = mergeLiveCandles([], [live(10, 310, 2n, E18), live(11, 320, 3n, E18), live(12, 650, 1n, E18)], 5n, 300);
        expect(m).toEqual([c(300, 2n, 3n, 2n, 3n, 5n), c(600, 1n, 1n, 1n, 1n, 1n)]);
    });
    it("updates the last server bucket's h, l, c and v", () => {
        const server = [c(0, 5n, 6n, 4n, 5n, 10n), c(300, 5n, 5n, 5n, 5n, 10n)];
        const m = mergeLiveCandles(server, [live(101, 400, 9n, E18), live(102, 410, 2n, E18)], 100n, 300);
        expect(m[1]).toEqual(c(300, 5n, 9n, 2n, 2n, 21n));
        expect(m[0]).toEqual(server[0]);
    });
    it("adds a new bucket after the server's last one", () => {
        const m = mergeLiveCandles([c(0, 5n, 5n, 5n, 5n, 1n)], [live(101, 900, 7n, E18)], 100n, 300);
        expect(m.map((x) => x.t)).toEqual([0, 900]);
    });
    it("skips trades at or below indexedBlock (already in the server candles) and zero-token trades", () => {
        const server = [c(300, 5n, 5n, 5n, 5n, 1n)];
        const m = mergeLiveCandles(server, [live(100, 310, 99n, E18), live(90, 320, 99n, E18), live(101, 330, 1n, 0n)], 100n, 300);
        expect(m).toEqual(server);
    });
    it("uses quote * 1e18 / token as the price", () => {
        const m = mergeLiveCandles([], [live(1, 0, 3n * E18, 1000n * E18)], null, 300);
        expect(m[0].c).toBe((3n * E18) / 1000n);
    });
});

describe("connectOpens", () => {
    it("opens each candle at the previous close and widens h/l to include it", () => {
        const cs = [c(0, 10n, 12n, 9n, 11n, 1n), c(300, 20n, 22n, 19n, 21n, 1n), c(600, 5n, 6n, 4n, 5n, 1n)];
        expect(connectOpens(cs)).toEqual([c(0, 10n, 12n, 9n, 11n, 1n), c(300, 11n, 22n, 11n, 21n, 1n), c(600, 21n, 21n, 4n, 5n, 1n)]);
        expect(connectOpens([])).toEqual([]);
    });
});

const series = (n: number) => Array.from({length: n}, (_, i) => c(i * 300, 10n, 12n, 9n, 11n, 1n));
const centreOf = (L: ReturnType<typeof layoutCandles>, t: number) => L.bars.find((b) => b.candle.t === t)?.x;

describe("view: slot, zoom and pan", () => {
    it("3 candles in 800 px: neighbours 18 px apart, newest inside the right padding", () => {
        const L = layoutCandles(series(3), 800, 200);
        expect(L.slot).toBe(SLOT_DEFAULT_MAX);
        expect(L.bars[1].x - L.bars[0].x).toBe(18);
        expect(L.bars[2].x - L.bars[1].x).toBe(18);
        expect(L.bars[2].x).toBeLessThanOrEqual(800 - RIGHT_PAD);
        expect(L.bars[2].x).toBe(800 - RIGHT_PAD - 9);
        expect(L.bars[0].w).toBeCloseTo(18 * 0.7);
    });
    it("300 candles in 400 px: the default view keeps MIN_SLOT", () => {
        expect(defaultView(300, 400)).toEqual({slot: MIN_SLOT, offset: 0});
        expect(defaultView(0, 400)).toEqual({slot: SLOT_DEFAULT_MAX, offset: 0});
        const L = layoutCandles(series(300), 400, 200);
        expect(L.bars[1].x - L.bars[0].x).toBe(MIN_SLOT);
    });
    it("zoomAt stops at the limits", () => {
        let v: View = {slot: 40, offset: 0};
        for (let i = 0; i < 10; i++) v = zoomAt(v, 1.15, 200, 400, 300);
        expect(v.slot).toBe(SLOT_MAX);
        for (let i = 0; i < 40; i++) v = zoomAt(v, 1 / 1.15, 200, 400, 300);
        expect(v.slot).toBe(SLOT_MIN);
    });
    it("zoomAt keeps the candle under the cursor", () => {
        const all = series(300);
        const before: View = {slot: 10, offset: 20};
        const L0 = layoutCandles(all, 400, 200, before);
        const target = L0.bars[L0.bars.length - 15];
        // (factors chosen off exact half-slot ties: offset is rounded to whole candles)
        for (const f of [1.15, 1 / 1.15, 2, 3]) {
            const after = zoomAt(before, f, target.x, 400, all.length);
            const L1 = layoutCandles(all, 400, 200, after);
            const i = barIndexAt(target.x, L1.bars, L1.slot);
            expect(L1.bars[i].candle.t).toBe(target.candle.t);
        }
    });
    it("panBy reveals older candles to the right and stops at both ends", () => {
        const all = series(50);
        const v = panBy({slot: 10, offset: 0}, 30, all.length);
        expect(v.offset).toBe(3);
        const L = layoutCandles(all, 400, 200, v);
        expect(L.bars.at(-1)!.candle.t).toBe(46 * 300);
        expect(panBy({slot: 10, offset: 0}, -500, all.length).offset).toBe(0);
        expect(panBy({slot: 10, offset: 0}, 100_000, all.length).offset).toBe(49);
        expect(centreOf(layoutCandles(all, 400, 200, {slot: 10, offset: 49}), 0)).toBe(400 - RIGHT_PAD - 5);
    });
});
