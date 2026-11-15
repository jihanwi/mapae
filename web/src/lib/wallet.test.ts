import {describe, expect, it} from "vitest";
import type {Trade} from "./activity";
import {applyTrade, EMPTY_POSITION, holdingValue, mergeBrowserTrades, pnl, Position, PositionState, signedPnl, splitHoldings, totals, walletAmount} from "./wallet";
import {VECTORS} from "../../api/_lib/positionVectors";

const E18 = 10n ** 18n;
const T = (n: number) => BigInt(n) * E18; // whole tokens / whole quote
const P = (n: number) => BigInt(n) * E18; // price per whole token

type A = `0x${string}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as A;
const W = addr(0xaa);
const C1 = addr(0xc1);
const C2 = addr(0xc2);
function trade(curve: A, side: "buy" | "sell", quote: number, tokens: number, block: number, trader: A = W): Trade {
    return {curve, venue: "curve", side, trader, isDev: false, verified: null, tokenAmount: T(tokens), quoteAmount: T(quote), volume: T(quote), block: BigInt(block), logIndex: 0, tx: `0x${block.toString(16).padStart(64, "0")}`};
}

const fold = (...steps: [("buy" | "sell"), number, number][]): PositionState =>
    steps.reduce((p, [side, q, t]) => applyTrade(p, {side, quoteAmount: T(q), tokenAmount: T(t)}), EMPTY_POSITION);

describe("moving-average fold (browser, same vectors as the server)", () => {
    for (const v of VECTORS) {
        it(v.name, () => {
            const s = v.steps.reduce(applyTrade, EMPTY_POSITION);
            expect({cost: s.cost, tracked: s.tracked, realized: s.realized}).toEqual(v.want);
        });
    }
});

describe("pnl", () => {
    it("bought 10 for 100, price now 20: unrealized +100 (+100%)", () => {
        expect(pnl(fold(["buy", 100, 10]), T(10), P(20))).toEqual({realized: 0n, unrealized: T(100), unrealizedBps: 10_000n, cost: T(100)});
    });
    it("a later buy keeps the settled realized P&L", () => {
        const before = pnl(fold(["buy", 100, 10], ["sell", 80, 5]), T(5), P(10));
        const after = pnl(fold(["buy", 100, 10], ["sell", 80, 5], ["buy", 100, 5]), T(10), P(10));
        expect(before.realized).toBe(T(30));
        expect(after.realized).toBe(T(30));
        expect(after.cost).toBe(T(150));
    });
    it("balance above tracked (received by transfer): heldCounted = tracked", () => {
        const r = pnl(fold(["buy", 100, 10]), T(25), P(20));
        expect(r.cost).toBe(T(100));
        expect(r.unrealized).toBe(T(100)); // 10 * 20 - 100
    });
    it("balance below tracked: cost is the held share", () => {
        expect(pnl(fold(["buy", 100, 10]), T(4), P(10)).cost).toBe(T(40));
    });
    it("sold everything: unrealized 0, cost 0, no percentage", () => {
        const r = pnl(fold(["buy", 100, 10], ["sell", 150, 10]), 0n, P(20));
        expect(r).toEqual({realized: T(50), unrealized: 0n, unrealizedBps: undefined, cost: 0n});
    });
    it("never bought: all undefined", () => {
        expect(pnl(fold(["sell", 50, 5]), T(5), P(20))).toEqual({realized: undefined, unrealized: undefined, unrealizedBps: undefined, cost: undefined});
    });
    it("a loss is negative", () => {
        const r = pnl(fold(["buy", 100, 10]), T(10), P(4));
        expect(r.unrealized).toBe(-T(60));
        expect(r.unrealizedBps).toBe(-6000n);
    });
    it("no price: unrealized undefined, realized known", () => {
        const r = pnl(fold(["buy", 100, 10], ["sell", 80, 5]), T(5), undefined);
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

describe("mergeBrowserTrades", () => {
    const one = (st: PositionState): Position => ({curve: C1, token: addr(0x71), name: "One", symbol: "ONE", ...st});
    it("applies only trades after indexedBlock, in (block, logIndex) order", () => {
        const server = [one(fold(["buy", 100, 10]))];
        // given out of order: the sell (block 52) must come after the buy (block 51)
        const trades = [trade(C1, "sell", 80, 5, 52), trade(C1, "buy", 999, 99, 50), trade(C1, "buy", 100, 10, 51)];
        const [p] = mergeBrowserTrades(server, trades, W, 50n, () => undefined);
        // 20 tokens for 200, then sell 5 at 16 against an average of 10
        expect({cost: p.cost, tracked: p.tracked, realized: p.realized}).toEqual({cost: T(150), tracked: T(15), realized: T(30)});
    });
    it("orders by logIndex within a block", () => {
        const a = {...trade(C1, "sell", 80, 5, 60), logIndex: 1};
        const b = {...trade(C1, "buy", 100, 10, 60), logIndex: 0};
        const [p] = mergeBrowserTrades([], [a, b], W, 50n, () => ({token: addr(0x71), name: "One", symbol: "ONE"}));
        expect(p.realized).toBe(T(30));
    });
    it("starts unseen curves from zero and ignores other wallets", () => {
        const info = (c: A) => (c === C2 ? {token: addr(0x72), name: "Two", symbol: "TWO"} : undefined);
        const out = mergeBrowserTrades([], [trade(C2, "buy", 5, 5, 60), trade(C2, "buy", 7, 7, 61, addr(0xbb))], W.toUpperCase().replace("0X", "0x"), 50n, info);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({symbol: "TWO", cost: T(5), tracked: T(5)});
    });
    it("no indexedBlock (no server): unchanged", () => {
        const server = [one(fold(["buy", 100, 10]))];
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

describe("wallet amounts and signed P&L", () => {
    const E = 10n ** 18n;
    it("ETH uses 4 significant digits, KRWs a whole number", () => {
        expect(walletAmount(4_700_000_000_000n, "ETH", "en-US")).toBe("0.0000047");
        expect(walletAmount(1234n * E + E / 3n, "KRWs", "en-US")).toBe("1,234");
        expect(walletAmount(3n * E / 1000n, "WETH", "en-US")).toBe("0.003");
    });
    it("a small ETH loss is shown with its digits, not as -0", () => {
        const r = signedPnl(-4_700_000_000_000n, "ETH", "en-US", -470n);
        expect(r).toEqual({text: "-0.0000047 ETH (-4.7%)", tone: "down"});
    });
    it("a value that displays as 0 has no sign and the flat tone", () => {
        expect(signedPnl(-(E / 3n), "KRWs", "en-US")).toEqual({text: "0 KRWs", tone: "flat"});
        expect(signedPnl(0n, "ETH", "en-US", 0n)).toEqual({text: "0 ETH (0.0%)", tone: "flat"});
        expect(signedPnl(-2n * E, "KRWs", "en-US", -4n).text).toBe("-2 KRWs (0.0%)");
        expect(signedPnl(5n * E, "KRWs", "en-US", 1234n)).toEqual({text: "+5 KRWs (+12.3%)", tone: "up"});
    });
});
