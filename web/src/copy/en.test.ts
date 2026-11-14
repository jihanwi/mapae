import {describe, expect, it} from "vitest";
import {en} from "./en";
import {ko} from "./ko";

describe("English plurals", () => {
    it("verifiedTraders uses singular only for 1", () => {
        expect(en.curve.verifiedTraders(0)).toBe("0 verified traders");
        expect(en.curve.verifiedTraders(1)).toBe("1 verified trader");
        expect(en.curve.verifiedTraders(12)).toBe("12 verified traders");
    });
});

describe("English v3 copy guardrails", () => {
    const v3 = JSON.stringify([en.common, en.nav, en.curve, en.create, en.onboardingV3, en.tx, en.errorsV3, en.route404, en.feed]);
    it("has no return-expectation or safety-claim words and no em dash", () => {
        for (const w of [/profit/i, /returns/i, /invest/i, /pump/i, /\bmoon/i, /\bgem\b/i, /\balpha\b/i, /\bsafe\b/i, /guarantee/i, /rug-proof/i, /—/, /!/]) {
            expect(v3, String(w)).not.toMatch(w);
        }
    });
    it("uses the fixed panel wording", () => {
        expect(en.curve.fixedPanel).toBe("No Dev allocation · No further minting · Liquidity locked forever");
    });
});

describe("feed copy guardrails", () => {
    it("Korean and English feed strings avoid hype and return language", () => {
        const samples = (d: typeof en) => [
            JSON.stringify(d.feed),
            d.feed.window(3),
            d.feed.recentLine(2, "1,000", "KRWs"),
            d.feed.noTrades(3),
            d.feed.tickerLine("0x12ab…cd34", "HRN", "3,333 KRWs", d.feed.buy, d.feed.ago.min(2)),
        ].join(" ");
        const all = samples(en) + " " + samples(ko);
        for (const w of [/수익/, /오른다/, /급등/, /투자/, /대박/, /합니다/, /됩니다/, /profit/i, /invest/i, /pump/i, /\bmoon/i, /\bgem/i, /—/]) {
            expect(all, String(w)).not.toMatch(w);
        }
    });
    it("tab names match the spec", () => {
        expect(Object.values(ko.feed.tabs)).toEqual(["방금 거래", "인기", "시가총액", "졸업 임박", "신규", "졸업"]);
        expect(Object.values(en.feed.tabs)).toEqual(["Latest", "Popular", "Market cap", "Almost graduated", "New", "Graduated"]);
        expect(en.feed.window(1)).toBe("Based on about the last 1 hour");
    });
});
