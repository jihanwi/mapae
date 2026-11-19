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

describe("English flow plurals", () => {
    it("uses the singular only for 1", () => {
        expect(en.tokenPage.buys(1)).toBe("1 buy");
        expect(en.tokenPage.sells(2)).toBe("2 sells");
        expect(en.tokenPage.verifiedBuyers(1)).toBe("1 verified buyer");
        expect(en.tokenPage.verifiedSellers(0)).toBe("0 verified sellers");
        expect(en.tokenPage.devLaunched(1)).toBe("1 token launched by this Dev");
        expect(en.tokenPage.devLaunched(3)).toBe("3 tokens launched by this Dev");
    });
});

describe("English v3 copy guardrails", () => {
    const v3 = JSON.stringify([en.common, en.nav, en.curve, en.create, en.onboardingV3, en.tx, en.errorsV3, en.route404, en.feed, en.meta, en.chain, en.social, en.nickname, en.tradeGuard, en.priority,
        // W-T41: the offering section too (functions are checked with sample arguments in offeringEn.test.ts)
        en.heroTitle, en.heroSub, en.onboarding, en.home, en.badge, en.offering, en.membership, en.redeem, en.trade, en.logs, en.terms, en.disclosure, en.offeringCreate, en.refund, en.hints, en.errors], (_, v) => (typeof v === "bigint" ? String(v) : v));
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
            JSON.stringify(d.meta),
            JSON.stringify(d.chain),
            JSON.stringify(d.social),
            JSON.stringify(d.nickname),
            JSON.stringify(d.tradeGuard),
            JSON.stringify(d.priority),
            d.priority.banner("09:59"),
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
        // W-T61: "예정" / "Upcoming" after "신규" / "New"
        expect(Object.values(ko.feed.tabs)).toEqual(["최근 거래", "인기", "시가총액", "졸업 임박", "신규", "예정", "졸업"]);
        expect(Object.values(en.feed.tabs)).toEqual(["Latest", "Popular", "Market cap", "Almost graduated", "New", "Upcoming", "Graduated"]);
        expect(en.feed.window(1)).toBe("Based on about the last 1 hour");
    });
});

describe("design-home copy", () => {
    it("the brass accent is part of each tagline", () => {
        for (const c of [ko, en]) expect(c.homeRows.tagline).toContain(c.homeRows.taglineAccent);
    });
    it("the intro lines carry the priority window and the holding cap", () => {
        expect(ko.homeRows.intro[0]).toMatch(/^개설 후 \d+분은 실명 지갑만 살 수 있고, 한 지갑이 [\d.]+%를 넘게 가질 수 없어요$/);
        expect(en.homeRows.intro[0]).toMatch(/^First \d+ minutes: verified wallets only, and no wallet can hold more than [\d.]+%\.$/);
    });
});
