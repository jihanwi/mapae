import {describe, expect, it} from "vitest";
import {redeemSections, redeemTabVisible} from "./redeemTab";
import {ko} from "../copy/ko";

describe("redeem tab visibility (decision 55)", () => {
    it("hidden before the reads finish, shown when they fail", () => {
        expect(redeemTabVisible({status: "loading"})).toBe(false);
        expect(redeemTabVisible({status: "error"})).toBe(true);
        expect(redeemTabVisible({status: "done", sponsors: 0, items: undefined, itemsError: true})).toBe(true);
    });
    it("shown with redeem items or with a sponsorship only; hidden with neither", () => {
        expect(redeemTabVisible({status: "done", sponsors: 0, items: 2, itemsError: false})).toBe(true);
        expect(redeemTabVisible({status: "done", sponsors: 1, items: undefined, itemsError: false})).toBe(true);
        expect(redeemTabVisible({status: "done", sponsors: 0, items: undefined, itemsError: false})).toBe(false);
        expect(redeemTabVisible({status: "done", sponsors: 0, items: 0, itemsError: false})).toBe(false);
    });
    it("page sections per offering", () => {
        expect(redeemSections({items: 3, sponsorship: true})).toEqual({catalog: true, sponsor: true, empty: false});
        expect(redeemSections({items: 0, sponsorship: true})).toEqual({catalog: false, sponsor: true, empty: false});
        expect(redeemSections({items: 0, sponsorship: false})).toEqual({catalog: false, sponsor: false, empty: true});
        expect(redeemSections({items: undefined, sponsorship: false})).toEqual({catalog: false, sponsor: false, empty: false});
    });
});

describe("offering copy is issuer-neutral (decision 55)", () => {
    // every value (functions called with sample arguments) of the keys the offering screens use
    const texts = (v: unknown): string[] => {
        if (typeof v === "string") return [v];
        if (typeof v === "function") return [String((v as (...a: string[]) => unknown)("1", "2"))];
        if (v && typeof v === "object") return Object.values(v).flatMap(texts);
        return [];
    };
    const scope = {heroTitle: ko.heroTitle, heroSub: ko.heroSub, nav: [ko.nav.offeringList, ko.nav.membership, ko.nav.redeem, ko.nav.trade], home: ko.home, badge: ko.badge, offering: ko.offering, membership: ko.membership, redeem: ko.redeem, trade: ko.trade, logs: ko.logs, terms: ko.terms, disclosure: ko.disclosure, offeringCreate: ko.offeringCreate};
    it.each(["크리에이터", "팬", "멤버십", "회원권"])("no %s", (word) => {
        expect(texts(scope).filter((t) => t.includes(word))).toEqual([]);
    });
    it("no 장 as a unit", () => {
        expect(texts(scope).filter((t) => /\d장|\/장|장 |^장$|장\)/.test(t))).toEqual([]);
    });
    it("the confirmed title and subtitle", () => {
        expect(ko.heroTitle).toBe("같은 가격, 같은 기회로 받는 공모");
        expect(ko.heroSub).toBe("정가 응모 · 균등 배정과 추첨 · 미달 시 환불 또는 부분 발행 · 유동성 영구 잠금");
    });
});
