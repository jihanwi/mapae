// Shared test vectors for the moving-average fold (used by the API and the browser tests).
import type {PositionState, TradeStep} from "./positions";

const E18 = 10n ** 18n;
export const W = (n: number) => BigInt(n) * E18;
const buy = (q: number, t: number): TradeStep => ({side: "buy", quoteAmount: W(q), tokenAmount: W(t)});
const sell = (q: number, t: number): TradeStep => ({side: "sell", quoteAmount: W(q), tokenAmount: W(t)});

export type Vector = {name: string; steps: TradeStep[]; want: Pick<PositionState, "cost" | "tracked" | "realized">};

export const VECTORS: Vector[] = [
    {name: "buy 10 for 100, sell 5 for 80", steps: [buy(100, 10), sell(80, 5)], want: {realized: W(30), cost: W(50), tracked: W(5)}},
    // the point of the change: a later buy leaves the settled P&L alone
    {name: "then buy 5 more for 100", steps: [buy(100, 10), sell(80, 5), buy(100, 5)], want: {realized: W(30), cost: W(150), tracked: W(10)}},
    {name: "sell everything", steps: [buy(100, 10), sell(80, 5), buy(100, 5), sell(200, 10)], want: {realized: W(80), cost: 0n, tracked: 0n}},
    // tracked 5, sell 8 for 160: s = 5 at 20 each (100) against cost 50; the other 3 are left out
    {name: "sell more than tracked", steps: [buy(100, 10), sell(80, 5), sell(160, 8)], want: {realized: W(30) + W(100) - W(50), cost: 0n, tracked: 0n}},
    {name: "sell without any buy", steps: [sell(50, 5)], want: {realized: 0n, cost: 0n, tracked: 0n}},
    // order matters: selling first (no cost) then buying differs from buying first
    {name: "order: sell then buy", steps: [sell(50, 5), buy(100, 10)], want: {realized: 0n, cost: W(100), tracked: W(10)}},
    {name: "order: buy then sell", steps: [buy(100, 10), sell(50, 5)], want: {realized: 0n, cost: W(50), tracked: W(5)}},
    {name: "loss", steps: [buy(100, 10), sell(20, 5)], want: {realized: -W(30), cost: W(50), tracked: W(5)}},
];
