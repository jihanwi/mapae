import {describe, expect, it} from "vitest";
import type {Trade} from "./activity";
import {addTrades, Amounts, holdingValue, mergeBrowserTrades, pnl, Position, splitHoldings, totals, ZERO_AMOUNTS} from "./wallet";

const E18 = 10n ** 18n;
const T = (n: number) => BigInt(n) * E18; // whole tokens / whole quote
const P = (n: number) => BigInt(n) * E18; // price per whole token
const amt = (buyQuote: number, buyTokens: number, sellQuote = 0, sellTokens = 0): Amounts => ({buyQuote: T(buyQuote), buyTokens: T(buyTokens), sellQuote: T(sellQuote), sellTokens: T(sellTokens)});

type A = `0x${string}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as A;
const W = addr(0xaa);
const C1 = addr(0xc1);
const C2 = addr(0xc2);
function trade(curve: A, side: "buy" | "sell", quote: number, tokens: number, block: number, trader: A = W): Trade {
    return {curve, venue: "curve", side, trader, isDev: false, verified: null, tokenAmount: T(tokens), quoteAmount: T(quote), volume: T(quote), block: BigInt(block), logIndex: 0, tx: `0x${block.toString(16).padStart(64, "0")}`};
}

describe("pnl", () => {
    it("bought 10 for 100, price now 20: unrealized +100 (+100%)", () => {
        const r = pnl(amt(100, 10), T(10), P(20));
        expect(r).toEqual({realized: 0n, unrealized: T(100), unrealizedBps: 10_000n, cost: T(100)});
    });
    it("bought 10 for 100, sold 5 for 80: realized +30, the 5 left cost 50", () => {
        const r = pnl(amt(100, 10, 80, 5), T(5), P(10));
        expect(r.realized).toBe(T(30));
        expect(r.cost).toBe(T(50));
        expect(r.unrealized).toBe(0n);
    });
    it("sold everything: unrealized 0, realized only", () => {
        const r = pnl(amt(100, 10, 150, 10), 0n, P(20));
        expect(r.realized).toBe(T(50));
        expect(r.unrealized).toBe(0n);
        expect(r.cost).toBe(0n);
        expect(r.unrealizedBps).toBeUndefined();
    });
    it("holding more than bought (received by transfer): only the bought quantity counts", () => {
        const r = pnl(amt(100, 10), T(25), P(20));
        expect(r.cost).toBe(T(100));
        expect(r.unrealized).toBe(T(100)); // 10 * 20 - 100, the 15 received are left out
    });
    it("never bought (transfer only): undefined", () => {
        expect(pnl(ZERO_AMOUNTS, T(5), P(20))).toEqual({realized: undefined, unrealized: undefined, unrealizedBps: undefined, cost: undefined});
    });
    it("sold more than bought (sold received tokens): only the bought quantity counts as sold", () => {
        // bought 10 for 100, sold 20 for 400 -> 10 counted at the average sell price 20
        const r = pnl(amt(100, 10, 400, 20), 0n, P(20));
        expect(r.realized).toBe(T(100)); // 400 * 10/20 - 100
        expect(r.cost).toBe(0n);
    });
    it("a loss is negative", () => {
        const r = pnl(amt(100, 10), T(10), P(4));
        expect(r.unrealized).toBe(-T(60));
        expect(r.unrealizedBps).toBe(-6000n);
        expect(pnl(amt(100, 10, 30, 5), T(5), P(10)).realized).toBe(-T(20));
    });
    it("no price: unrealized undefined, realized still known", () => {
        const r = pnl(amt(100, 10, 80, 5), T(5), undefined);
        expect(r.unrealized).toBeUndefined();
        expect(r.realized).toBe(T(30));
    });
});

describe("holdingValue", () => {
    it("balance times price, undefined without a price", () => {
        expect(holdingValue(T(3), P(7))).toBe(T(21));
        expect(holdingValue(T(3), undefined)).toBeUndefined();
    });
});

describe("totals", () => {
    it("sums per unit and never across units; missing values are skipped", () => {
        const m = totals([
            {unit: "KRWs", realized: T(30), unrealized: T(100), value: T(200)},
            {unit: "KRWs", realized: -T(10), unrealized: undefined, value: T(50)},
            {unit: "ETH", realized: undefined, unrealized: -T(1), value: T(2)},
        ]);
        expect(m.get("KRWs")).toEqual({realized: T(20), unrealized: T(100), value: T(250)});
        expect(m.get("ETH")).toEqual({realized: undefined, unrealized: -T(1), value: T(2)});
        expect(totals([{unit: "KRWs"}]).get("ETH")).toBeUndefined();
    });
});

describe("addTrades and the indexedBlock boundary", () => {
    it("adds only trades after indexedBlock", () => {
        const base = amt(100, 10);
        const out = addTrades(base, [trade(C1, "buy", 50, 5, 100), trade(C1, "buy", 20, 2, 101), trade(C1, "sell", 30, 3, 102)], 100n);
        expect(out).toEqual({buyQuote: T(120), buyTokens: T(12), sellQuote: T(30), sellTokens: T(3)});
        expect(base).toEqual(amt(100, 10)); // input untouched
    });
    it("merges per curve, adds a new line for an unseen curve, ignores other wallets and old blocks", () => {
        const server: Position[] = [{curve: C1, token: addr(0x71), name: "One", symbol: "ONE", ...amt(100, 10)}];
        const trades = [trade(C1, "buy", 10, 1, 51), trade(C1, "buy", 999, 99, 50), trade(C2, "buy", 5, 5, 60), trade(C2, "buy", 7, 7, 61, addr(0xbb))];
        const info = (c: A) => (c === C2 ? {token: addr(0x72), name: "Two", symbol: "TWO"} : undefined);
        const out = mergeBrowserTrades(server, trades, W.toUpperCase().replace("0X", "0x"), 50n, info);
        expect(out.find((p) => p.curve === C1)).toMatchObject(amt(110, 11));
        expect(out.find((p) => p.curve === C2)).toMatchObject({symbol: "TWO", ...amt(5, 5)});
    });
    it("no indexedBlock (no server): browser trades are not added", () => {
        const server: Position[] = [{curve: C1, token: addr(0x71), name: "One", symbol: "ONE", ...amt(100, 10)}];
        expect(mergeBrowserTrades(server, [trade(C1, "buy", 10, 1, 99)], W, null, () => undefined)).toEqual(server);
    });
});

describe("splitHoldings", () => {
    it("holding: KRWs then ETH, by value with unknown last; sold out by |realized|", () => {
        const rows = [
            {id: "e1", unit: "ETH" as const, balance: 1n, value: T(5), traded: true},
            {id: "k1", unit: "KRWs" as const, balance: 1n, value: T(10), traded: true},
            {id: "k2", unit: "KRWs" as const, balance: 1n, value: undefined, traded: true},
            {id: "k3", unit: "KRWs" as const, balance: 1n, value: T(50), traded: false},
            {id: "s1", unit: "KRWs" as const, balance: 0n, realized: T(5), traded: true},
            {id: "s2", unit: "ETH" as const, balance: 0n, realized: -T(9), traded: true},
            {id: "x", unit: "KRWs" as const, balance: 0n, traded: false},
        ];
        const {holding, soldOut} = splitHoldings(rows);
        expect(holding.map((r) => r.id)).toEqual(["k3", "k1", "k2", "e1"]);
        expect(soldOut.map((r) => r.id)).toEqual(["s2", "s1"]);
    });
});
