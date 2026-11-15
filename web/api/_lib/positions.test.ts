import {describe, expect, it} from "vitest";
import {applyTrade, EMPTY_POSITION, foldTrades, positionOut} from "./positions";
import {VECTORS, W} from "./positionVectors";

describe("moving-average fold (server)", () => {
    for (const v of VECTORS) {
        it(v.name, () => {
            const rows = v.steps.map((s) => ({curve: "0xc1", token: "0x71", name: "One", symbol: "ONE", side: s.side, quoteAmount: s.quoteAmount.toString(), tokenAmount: s.tokenAmount.toString()}));
            const [f] = foldTrades(rows);
            expect({cost: f.state.cost, tracked: f.state.tracked, realized: f.state.realized}).toEqual(v.want);
            // the same steps through applyTrade directly
            const s = v.steps.reduce(applyTrade, EMPTY_POSITION);
            expect({cost: s.cost, tracked: s.tracked, realized: s.realized}).toEqual(v.want);
        });
    }
    it("folds per curve and keeps the raw sums; wire form is strings", () => {
        const rows = [
            {curve: "0xc1", token: "0x71", name: "One", symbol: "ONE", side: "buy", quoteAmount: W(100).toString(), tokenAmount: W(10).toString()},
            {curve: "0xc2", token: "0x72", name: "Two", symbol: "TWO", side: "buy", quoteAmount: W(7).toString(), tokenAmount: W(7).toString()},
            {curve: "0xc1", token: "0x71", name: "One", symbol: "ONE", side: "sell", quoteAmount: W(20).toString(), tokenAmount: W(5).toString()},
        ];
        const out = foldTrades(rows).map(positionOut);
        expect(out.map((p) => p.curve)).toEqual(["0xc1", "0xc2"]);
        expect(out[0]).toMatchObject({realized: (-W(30)).toString(), cost: W(50).toString(), tracked: W(5).toString(), buyQuote: W(100).toString(), sellTokens: W(5).toString()});
    });
});
