import {describe, expect, it} from "vitest";
import {CURVE_SUPPLY, spotPrice, VIRTUAL_TOKEN_RESERVE, WAD} from "./curveMath";
import type {ServerSummary} from "./chainMerge";
import {changeBps, changeLabel, changeOf, currentPrice, exactAddressHit, featured, HOME_TABS, HomeCurve, homeTab, leftToGraduate, openingPrice, refPrice, searchCurves, upcomingCount} from "./homeList";

type A = `0x${string}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as A;
const VQ = 2_000_000n * WAD;

function curve(i: number, over: Partial<HomeCurve> = {}): HomeCurve {
    return {
        address: addr(0xc0 + i),
        token: addr(0x70 + i),
        pool: addr(0),
        dev: addr(0xde),
        index: i,
        graduated: false,
        virtualQuote: VQ,
        r: 0n,
        s: 0n,
        name: `Token ${i}`,
        symbol: `T${i}`,
        totalFeeBps: 100,
        ...over,
    };
}
const server = (curves: ServerSummary["curves"]): ServerSummary => ({indexedBlock: "1", indexedTs: "1", window: 86400, curves});
const row = (refPriceWad: string | null) => ({trades24h: 1, traders24h: 1, volume24h: "1", volume24hExDev: "1", lastTradeTs: "1", lastPriceWad: "1", refPriceWad});

describe("prices", () => {
    it("current price: curve spot before graduation, pool spot after", () => {
        const c = curve(1, {r: 10n * WAD, s: 1000n * WAD});
        expect(currentPrice(c)).toBe(spotPrice(VQ, 10n * WAD, 1000n * WAD));
        expect(currentPrice(curve(1, {graduated: true, poolSpot: 123n}))).toBe(123n);
        expect(currentPrice(curve(1, {graduated: true}))).toBeUndefined();
    });
    it("opening price is the spot with nothing sold", () => {
        expect(openingPrice(curve(1, {r: 5n, s: 5n}))).toBe((VQ * WAD) / VIRTUAL_TOKEN_RESERVE);
    });
    it("changeBps: up, down, flat and undefined for a missing or zero reference", () => {
        expect(changeBps(150n, 100n)).toBe(5000n);
        expect(changeBps(50n, 100n)).toBe(-5000n);
        expect(changeBps(100n, 100n)).toBe(0n);
        expect(changeBps(100n, 0n)).toBeUndefined();
        expect(changeBps(undefined, 100n)).toBeUndefined();
        expect(changeBps(100n, undefined)).toBeUndefined();
    });
    it("reference: server refPriceWad, else the opening price, nothing without a server answer", () => {
        const c = curve(1);
        // server keys are lowercase; the curve address may come checksummed
        const up = {...c, address: c.address.toUpperCase().replace("0X", "0x") as A};
        expect(refPrice(up, server({[c.address]: row("777")}))).toBe(777n);
        expect(refPrice(c, server({[c.address]: row(null)}))).toBe(openingPrice(c));
        expect(refPrice(c, server({}))).toBe(openingPrice(c));
        expect(refPrice(c, undefined)).toBeUndefined();
        expect(changeOf(c, undefined)).toBeUndefined();
        expect(changeOf(c, server({}))).toBe(0n);
    });
    it("graduated row without a pool spot has no change", () => {
        expect(changeOf(curve(1, {graduated: true}), server({}))).toBeUndefined();
    });
    it("left to graduate is 0 when sold out", () => {
        expect(leftToGraduate(curve(1, {s: CURVE_SUPPLY}))).toBe(0n);
        expect(leftToGraduate(curve(1))).toBeGreaterThan(0n);
    });
});

describe("changeLabel", () => {
    it("one decimal with a sign; zero is flat", () => {
        expect(changeLabel(1234n, "en-US")).toEqual({text: "+12.3%", tone: "up"});
        expect(changeLabel(-455n, "en-US")).toEqual({text: "-4.6%", tone: "down"});
        expect(changeLabel(0n, "en-US")).toEqual({text: "0.0%", tone: "flat"});
        expect(changeLabel(4n, "en-US")).toEqual({text: "0.0%", tone: "flat"});
        expect(changeLabel(5n, "en-US")).toEqual({text: "+0.1%", tone: "up"});
    });
    it("1000% and above: whole number with grouping", () => {
        expect(changeLabel(99_994n, "en-US").text).toBe("+999.9%");
        expect(changeLabel(100_000n, "en-US").text).toBe("+1,000%");
        expect(changeLabel(1_234_560n, "ko-KR").text).toBe("+12,346%");
    });
});

describe("search", () => {
    const list = [curve(1, {name: "Priority Horse", symbol: "PRI"}), curve(2, {name: "Hanji", symbol: "HNJ"}), curve(3, {name: "Brass", symbol: "BRS", graduated: true})];
    it("matches name or symbol anywhere, any case, trimmed; empty query keeps all", () => {
        expect(searchCurves(list, "  pri ").map((c) => c.symbol)).toEqual(["PRI"]);
        expect(searchCurves(list, "anj").map((c) => c.symbol)).toEqual(["HNJ"]);
        expect(searchCurves(list, "")).toHaveLength(3);
        expect(searchCurves(list, "   ")).toHaveLength(3);
        expect(searchCurves(list, "zzz")).toEqual([]);
    });
    it("matches curve or token address prefixes", () => {
        expect(searchCurves(list, "0x" + "0".repeat(38) + "c2").map((c) => c.symbol)).toEqual(["HNJ"]);
        expect(searchCurves(list, addr(0x73).slice(0, 42).toUpperCase().replace("0X", "0x")).map((c) => c.symbol)).toEqual(["BRS"]);
        expect(searchCurves(list, "0x00").length).toBe(3);
    });
    it("exactAddressHit: a full curve or token address in any case", () => {
        expect(exactAddressHit(list, addr(0xc1))?.symbol).toBe("PRI");
        expect(exactAddressHit(list, ` ${addr(0x72).toUpperCase().replace("0X", "0x")} `)?.symbol).toBe("HNJ");
        expect(exactAddressHit(list, addr(0x73))?.symbol).toBe("BRS"); // graduated entries are found too
        expect(exactAddressHit(list, addr(0x99))).toBeUndefined();
        expect(exactAddressHit(list, addr(0xc1).slice(0, 41))).toBeUndefined();
        expect(exactAddressHit(list, "PRI")).toBeUndefined();
    });
});

describe("featured", () => {
    it("picks the open entry closest to graduation and skips graduated ones", () => {
        const list = [curve(1, {r: 10n * WAD}), curve(2, {r: 500n * WAD}), curve(3, {graduated: true, r: 900n * WAD})];
        expect(featured(list, new Map())?.symbol).toBe("T2");
    });
    it("none when every entry graduated or the list is empty", () => {
        expect(featured([curve(1, {graduated: true})], new Map())).toBeUndefined();
        expect(featured([], new Map())).toBeUndefined();
    });
});

// ---- W-T16: server-first list ----
import {mergeCurveList, newOnChain, OVERLAY_MAX, overlayTargets, serverCurveInfo} from "./homeList";
import type {ServerListRow} from "./chainMerge";
import type {CurveInfo} from "../hooks/curves";

const WETH = addr(0xe7);
function listRow(i: number, over: Partial<ServerListRow> = {}): ServerListRow {
    return {
        curve: addr(0xc0 + i),
        token: addr(0x70 + i),
        dev: addr(0xde),
        quote: addr(0x99),
        virtualQuote: VQ.toString(),
        name: `Horse ${i}`,
        symbol: `H${i}`,
        createdTs: String(1_000 + i),
        priorityUntil: String(1_600 + i),
        startTime: String(1_000 + i),
        verifiedOnly: false,
        pool: null,
        r: (3n * WAD).toString(),
        s: (1000n * WAD).toString(),
        verifiedBuyers: 2,
        ...over,
    };
}
/** What useCurves builds from the chain reads for the matching curve state. */
function chainInfo(i: number, index: number, over: Partial<CurveInfo> = {}): CurveInfo {
    return {
        address: addr(0xc0 + i),
        token: addr(0x70 + i),
        quote: addr(0x99),
        dev: addr(0xde),
        r: 3n * WAD,
        s: 1000n * WAD,
        virtualQuote: VQ,
        graduated: false,
        verifiedBuyerCount: 2,
        pool: addr(0),
        totalFeeBps: 100,
        name: `Horse ${i}`,
        symbol: `H${i}`,
        isEth: false,
        index,
        priorityUntil: BigInt(1_600 + i),
        startTime: BigInt(1_000 + i),
        verifiedOnly: false,
        poolSpot: undefined,
        ...over,
    };
}
const strip = ({totalFeeBps: _f, source: _s, ...rest}: CurveInfo) => rest; // eslint-disable-line @typescript-eslint/no-unused-vars

describe("server-first list (W-T16)", () => {
    it("a server-only row equals the chain row for the same state (fee aside)", () => {
        const s = serverCurveInfo(listRow(1), 4, WETH);
        expect(s.source).toBe("server");
        expect(s.totalFeeBps).toBe(0);
        expect(strip(s)).toEqual(strip(chainInfo(1, 4)));
        // the market cap / price helpers read the same numbers
        expect(currentPrice(s)).toBe(currentPrice(chainInfo(1, 4)));
        // ETH pair and graduated row: pool kept, the summary's last price stands in for the pool spot
        const g = serverCurveInfo(listRow(2, {quote: WETH, pool: addr(0xb1)}), 0, WETH, "123");
        expect(g).toMatchObject({isEth: true, graduated: true, pool: addr(0xb1), poolSpot: 123n});
    });
    it("server rows render alone; chain reads replace the rows they cover", () => {
        const server = [listRow(3), listRow(2), listRow(1)];
        const alone = mergeCurveList({server, chainAddrs: undefined, chain: new Map(), weth: WETH});
        expect(alone.map((c) => c.address)).toEqual([addr(0xc3), addr(0xc2), addr(0xc1)]);
        expect(alone.map((c) => c.index)).toEqual([2, 1, 0]);
        expect(alone.every((c) => c.source === "server")).toBe(true);
        const live = chainInfo(2, 1, {r: 9n * WAD});
        const over = mergeCurveList({server, chainAddrs: [addr(0xc1), addr(0xc2), addr(0xc3)], chain: new Map([[addr(0xc2), live]]), weth: WETH});
        expect(over[1]).toBe(live);
        expect(over[0].source).toBe("server");
    });
    it("a curve on the chain but not in the server list is added at the top", () => {
        const server = [listRow(2), listRow(1)];
        const chainAddrs = [addr(0xc1), addr(0xc2), addr(0xc3)];
        expect(newOnChain(chainAddrs, server)).toEqual([addr(0xc3)]);
        const fresh = chainInfo(3, 2);
        const out = mergeCurveList({server, chainAddrs, chain: new Map([[addr(0xc3), fresh]]), weth: WETH});
        expect(out.map((c) => c.address)).toEqual([addr(0xc3), addr(0xc2), addr(0xc1)]);
        expect(out.map((c) => c.index)).toEqual([2, 1, 0]);
    });
    it("without a server list the chain rows are the list (newest first)", () => {
        const out = mergeCurveList({server: undefined, chainAddrs: [addr(0xc1), addr(0xc2)], chain: new Map([[addr(0xc1), chainInfo(1, 0)], [addr(0xc2), chainInfo(2, 1)]]), weth: WETH});
        expect(out.map((c) => c.index)).toEqual([1, 0]);
    });
    it("the chain overlays at most 30 visible rows (plus new curves), deduped", () => {
        const visible = Array.from({length: 100}, (_, i) => addr(0x1000 + i));
        const t = overlayTargets([addr(0x9999)], [visible[0], ...visible]);
        expect(OVERLAY_MAX).toBe(30);
        expect(t).toHaveLength(1 + 30);
        expect(t[0]).toBe(addr(0x9999));
        expect(new Set(t).size).toBe(t.length);
        expect(overlayTargets([], visible)).toEqual(visible.slice(0, 30));
    });
});

describe("upcoming tab (W-T61)", () => {
    const NOW = 10_000;
    // 1, 2: trading; 3, 4: scheduled (4 opens first); 5: graduated
    const list = [
        curve(1, {startTime: 100n, r: 10n ** 18n}),
        curve(2, {startTime: 200n}),
        curve(3, {startTime: BigInt(NOW + 7200)}),
        curve(4, {startTime: BigInt(NOW + 60)}),
        curve(5, {startTime: 300n, graduated: true}),
    ];
    const ids = (cs: HomeCurve[]) => cs.map((c) => c.index);
    it("sits right after new", () => {
        expect(HOME_TABS.indexOf("upcoming")).toBe(HOME_TABS.indexOf("new") + 1);
    });
    it("lists only curves not open yet, nearest start first", () => {
        expect(ids(homeTab("upcoming", list, new Map(), new Map(), NOW))).toEqual([4, 3]);
        expect(upcomingCount(list, NOW)).toBe(2);
    });
    it("new keeps them (newest first); the trading tabs leave them out", () => {
        expect(ids(homeTab("new", list, new Map(), new Map(), NOW))).toEqual([5, 4, 3, 2, 1]);
        for (const t of ["latest", "popular", "mcap", "almost", "graduated"] as const) {
            expect(ids(homeTab(t, list, new Map(), new Map(), NOW)).some((i) => i === 3 || i === 4)).toBe(false);
        }
        expect(ids(homeTab("latest", list, new Map(), new Map(), NOW))).toEqual([5, 2, 1]);
    });
    it("a curve leaves upcoming once its start passes", () => {
        expect(ids(homeTab("upcoming", list, new Map(), new Map(), NOW + 60))).toEqual([3]);
        expect(ids(homeTab("latest", list, new Map(), new Map(), NOW + 60))).toContain(4);
    });
    it("featured skips curves that have not opened", () => {
        const only = [curve(4, {startTime: BigInt(NOW + 60), r: 10n ** 20n}), curve(2, {startTime: 200n})];
        expect(featured(only, new Map(), NOW)?.index).toBe(2);
    });
});
