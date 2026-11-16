import {describe, expect, it} from "vitest";
import {marksByCandle, MarkerTrade, pctText, ratioBps, ServerSignals, trustView} from "./trustSignals";

const E18 = 10n ** 18n;
const tok = (n: number) => (BigInt(n) * E18).toString();
const base: ServerSignals = {
    devFirstBuy: "0",
    devBought: "0",
    devSold: "0",
    devSellCount: 0,
    devLastSellTs: null,
    devBalance: "0",
    devTransferredOut: "0",
    top10: "0",
    circulating: "0",
    verifiedHeld: "0",
    verifiedHolders: 0,
    holdersCount: 0,
};

describe("ratio and percent text", () => {
    it("floors to bps and is null without a whole", () => {
        expect(ratioBps(1n, 3n)).toBe(3333n);
        expect(ratioBps(5n, 0n)).toBeNull();
        expect(ratioBps(0n, 10n)).toBe(0n);
    });
    it("formats at most two decimals", () => {
        expect(pctText(240n)).toBe("2.4%");
        expect(pctText(1234n)).toBe("12.34%");
        expect(pctText(500n)).toBe("5%");
        expect(pctText(0n)).toBe("0%");
        expect(pctText(10_000n)).toBe("100%");
    });
});

describe("trust view", () => {
    it("nothing circulates and the Dev never bought: dashes and None", () => {
        const v = trustView(base);
        expect(v.devFirstBuyBps).toBeNull();
        expect(v.devSells).toBeNull();
        expect(v.devOutBps).toBeNull();
        expect(v.top10Bps).toBeNull();
        expect(v.verifiedBps).toBeNull();
        expect(v.devHoldsBps).toBe(0n);
    });
    it("before graduation: first buy share of the supply, Dev sells against Dev buys", () => {
        const v = trustView({
            ...base,
            devFirstBuy: tok(24_000_000), // 2.4% of 1e9
            devBought: tok(50_000_000),
            devSold: tok(20_000_000),
            devSellCount: 3,
            devLastSellTs: "1700000000",
            devBalance: tok(30_000_000),
            top10: tok(60_000_000),
            circulating: tok(100_000_000),
            verifiedHeld: tok(25_000_000),
            verifiedHolders: 4,
            holdersCount: 7, // fewer than 10 holders: top10 is everyone
        });
        expect(pctText(v.devFirstBuyBps!)).toBe("2.4%");
        expect(pctText(v.devHoldsBps)).toBe("3%");
        expect(v.devSells).toEqual({count: 3, soldOfBoughtBps: 4000n, lastTs: 1_700_000_000});
        expect(pctText(v.top10Bps!)).toBe("60%");
        expect(pctText(v.verifiedBps!)).toBe("25%");
        expect(v.devOutBps).toBeNull();
    });
    it("after graduation: transfers out show; a Dev that only sold (received tokens) has no buy base", () => {
        const v = trustView({...base, devSold: tok(1), devSellCount: 1, devLastSellTs: "5", devTransferredOut: tok(10_000_000), circulating: tok(1)});
        expect(pctText(v.devOutBps!)).toBe("1%");
        expect(v.devSells).toEqual({count: 1, soldOfBoughtBps: null, lastTs: 5});
    });
});

describe("chart marks per candle", () => {
    const t = (ts: number, side: "buy" | "sell", who: "dev" | "me"): MarkerTrade => ({ts, side, who});
    it("buckets by interval and keeps one mark per direction and owner", () => {
        const m = marksByCandle([t(310, "buy", "dev"), t(320, "buy", "dev"), t(599, "sell", "me"), t(650, "buy", "me")], [300, 600], 300);
        expect(m.get(300)).toEqual({devBuy: true, devSell: false, myBuy: false, mySell: true});
        expect(m.get(600)).toEqual({devBuy: false, devSell: false, myBuy: true, mySell: false});
    });
    it("1 h and 1 d candles", () => {
        expect(marksByCandle([t(7_199, "sell", "dev")], [3_600], 3_600).get(3_600)?.devSell).toBe(true);
        expect(marksByCandle([t(86_400 + 5, "buy", "me")], [86_400], 86_400).get(86_400)?.myBuy).toBe(true);
    });
    it("trades outside the shown candles are dropped", () => {
        const m = marksByCandle([t(10, "buy", "dev"), t(10_000, "sell", "me")], [300, 600], 300);
        expect(m.size).toBe(0);
    });
});
