import {describe, expect, it} from "vitest";
import {barIndexAt, Candle, layoutCandles, parseCandles, priceRange, visibleCount} from "./candles";

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
        expect(priceRange([c(0, 100n, 200n, 100n, 150n, 1n)])).toEqual({lo: 95n, hi: 205n});
        expect(priceRange([c(0, E18, E18, E18, E18, 1n)])).toEqual({lo: E18 - E18 / 100n, hi: E18 + E18 / 100n});
        expect(priceRange([c(0, 5n, 5n, 5n, 5n, 1n)])).toEqual({lo: 4n, hi: 6n});
    });
    it("lays out up/down bodies, wicks and volume", () => {
        const cs = [c(0, 100n, 200n, 100n, 200n, 10n), c(300, 200n, 200n, 100n, 100n, 5n), c(600, 150n, 150n, 150n, 150n, 0n)];
        const L = layoutCandles(cs, 300, 200);
        expect(L.priceH).toBe(150);
        expect(L.bars.map((b) => b.up)).toEqual([true, false, true]);
        expect(L.bars.map((b) => b.x)).toEqual([50, 150, 250]);
        // highest wick is near the top, lowest near the bottom of the price area
        expect(L.bars[0].wickTop).toBeLessThan(L.bars[0].wickBottom);
        expect(L.bars[0].wickTop).toBeGreaterThan(0);
        expect(L.bars[0].wickBottom).toBeLessThan(150);
        // o == c gets a 1px body
        expect(L.bars[2].bodyH).toBe(1);
        // volume scales to the largest bar; zero volume has no bar
        expect(L.bars[0].volH).toBeCloseTo(200 - 150 - 4);
        expect(L.bars[1].volH).toBeCloseTo((200 - 150 - 4) / 2);
        expect(L.bars[2].volH).toBe(0);
        expect(L.ticks).toHaveLength(4);
        expect(L.ticks[0].price).toBe(L.lo);
        expect(L.ticks[3].price).toBe(L.hi);
    });
    it("draws only the newest candles that fit", () => {
        const cs = Array.from({length: 100}, (_, i) => c(i * 300, 10n, 12n, 9n, 11n, 1n));
        const L = layoutCandles(cs, 80, 100);
        expect(L.bars).toHaveLength(10);
        expect(L.bars[9].candle.t).toBe(99 * 300);
    });
    it("draws a single candle and nothing for none", () => {
        expect(layoutCandles([c(0, 1n, 2n, 1n, 2n, 1n)], 300, 200).bars).toHaveLength(1);
        expect(layoutCandles([], 300, 200).bars).toEqual([]);
    });
    it("maps x to the candle index", () => {
        expect(barIndexAt(0, 300, 3)).toBe(0);
        expect(barIndexAt(149, 300, 3)).toBe(1);
        expect(barIndexAt(999, 300, 3)).toBe(2);
        expect(barIndexAt(-5, 300, 3)).toBe(0);
        expect(barIndexAt(10, 300, 0)).toBe(-1);
    });
});
