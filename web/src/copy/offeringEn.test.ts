// W-T41 (decision 60): the offering section in Korean and English.
import {describe, expect, it} from "vitest";
import enSrc from "./en.ts?raw";
import {ko} from "./ko";
import {en} from "./en";
import {fmtCount, fmtWhen, countdown} from "../lib/format";
import {spanText} from "../lib/proceedsText";
import {commitBlock} from "../lib/commitGuard";
import {checkCreate, DEFAULT_FORM, type ChainBounds} from "../lib/createOffering";
import {allocationText} from "../components/ChainTerms";

const HANGUL = /[가-힣ㄱ-ㆎ]/;

/** Offering-section groups of the dictionaries. */
const OFFERING_KEYS = ["heroTitle", "heroSub", "onboarding", "home", "badge", "offering", "membership", "redeem", "trade", "logs", "terms", "disclosure", "offeringCreate", "refund", "hints", "errors"] as const;

/** Every string a dictionary value can produce: strings as they are, functions called with sample arguments. */
function texts(v: unknown): string[] {
    if (typeof v === "string") return [v];
    if (typeof v === "bigint" || typeof v === "number" || typeof v === "boolean" || v === null || v === undefined) return [];
    if (typeof v === "function") {
        const args = Array.from({length: v.length}, (_, i) => (i === 0 ? "12" : i === 1 ? "3" : i === 2 ? "1" : "4"));
        const out = (v as (...a: unknown[]) => unknown)(...args);
        const withFlag = v.length === 3 ? (v as (...a: unknown[]) => unknown)("12", "3", true) : undefined;
        return [...texts(out), ...texts(withFlag)];
    }
    if (Array.isArray(v)) return v.flatMap(texts);
    return Object.values(v as Record<string, unknown>).flatMap(texts);
}

/** Shape of a dictionary: key paths with the type, and the parameter count of functions. */
function shape(v: unknown, path = ""): string[] {
    if (typeof v === "function") return [`${path}:fn${v.length}`];
    if (Array.isArray(v)) return [`${path}:array${v.length}`];
    if (v !== null && typeof v === "object") return Object.keys(v).sort().flatMap((k) => shape((v as Record<string, unknown>)[k], `${path}.${k}`));
    return [`${path}:${typeof v}`];
}

describe("ko and en have the same keys (W-T41)", () => {
    it("same key paths, same value kinds, same function arity", () => {
        expect(shape(en)).toEqual(shape(ko));
    });
    it("no English group points at the Korean one", () => {
        for (const k of OFFERING_KEYS) expect((en as Record<string, unknown>)[k], k).not.toBe((ko as Record<string, unknown>)[k]);
        expect(enSrc.replace(/\/\/[^\n]*/g, "")).not.toMatch(/\bko\./);
    });
});

describe("English offering copy (W-T41)", () => {
    const all = OFFERING_KEYS.flatMap((k) => texts((en as Record<string, unknown>)[k]));
    it("has no Hangul", () => {
        for (const s of all) expect(s, s).not.toMatch(HANGUL);
    });
    it("has no return-expectation words, no em dash", () => {
        for (const s of all) {
            for (const w of [/invest/i, /profit/i, /\breturns?\b/i, /\byield/i, /guarantee/i, /\bearn/i, /upside/i, /\bmoon/i, /—/, /\bshares?\b/i]) expect(s, `${w} in "${s}"`).not.toMatch(w);
        }
    });
    it("W-T42: toasts use \" · \" in English and keep \" — \" in Korean; tx copy has no em dash", () => {
        expect(en.tx.sep).toBe(" · ");
        expect(ko.tx.sep).toBe(" — ");
        for (const s of texts(en.tx)) expect(s, s).not.toMatch(/—/);
        expect(`${en.offering.commitLabel}${en.tx.sep}${en.tx.pendingTx}`).toBe("Commit · Waiting for confirmation…");
        expect(`${ko.offering.commitLabel}${ko.tx.sep}${ko.tx.pendingTx}`).toBe("응모 — 처리하는 중…");
    });
    it("W-T42: the first sentence of an offering", () => {
        expect(en.offering.about("Nodl", "50,000")).toMatch(/^An offering of the Nodl token\./);
        expect(en.offering.about(null, "50,000")).toMatch(/^An offering of this token\./);
    });
    it("uses the fixed sentences", () => {
        expect(en.heroTitle).toBe("One price. The same chance for everyone.");
        expect(en.disclosure.note).toBe("Written by the issuer. The platform has not verified it.");
        expect(en.terms.title).toBe("Terms fixed on chain");
        expect(en.disclosure.title).toBe("Written by the issuer");
        expect(en.refund.startCta).toBe("Start refunds");
        expect(en.refund.claimLabel).toBe("Claim refund");
        expect(en.terms.refundAll).toBe("Full refund");
        expect(en.offeringCreate.refundPartial).toBe("Issue only what was sold");
        expect(en.badge.ended).toBe("Closed · awaiting settlement");
        expect(en.disclosure.addenda).toBe("Addenda");
    });
    it("English plurals", () => {
        expect(en.home.participants(1)).toBe("1 participant");
        expect(en.home.participants(3)).toBe("3 participants");
        expect(en.offering.days("1")).toBe("1 day");
        expect(en.offering.days("30")).toBe("30 days");
        expect(en.offering.hours("12")).toBe("12 hours");
    });
});

describe("Korean offering copy is unchanged and clean (W-T41)", () => {
    const all = OFFERING_KEYS.flatMap((k) => texts((ko as Record<string, unknown>)[k]));
    it("has no return-expectation words", () => {
        for (const s of all) for (const w of [/수익/, /오른다/, /급등/, /투자/, /대박/]) expect(s, `${w} in "${s}"`).not.toMatch(w);
    });
    it("strings moved out of the screens keep their exact Korean text", () => {
        expect(ko.offering.backLink).toBe("← 공모 목록");
        expect(ko.offering.untilDeadline("05:00:00")).toBe("마감까지 05:00:00");
        expect(ko.offering.totalPrefix + "1,000" + ko.offering.targetPart("5,000")).toBe("총 응모 1,000 / 목표 5,000 KRWs");
        expect(ko.offering.cancelLocked).toBe("취소 잠김 — 마감 2시간 전");
        expect(ko.offering.claimWith("10", ko.offering.unit, true)).toBe("배정 받기 — 10개 + 환불");
        expect(ko.offering.perToken("1,000")).toBe("1,000 KRWs / 개");
        expect(ko.refund.partialModeNote).toBe("미달 시 판매분만 발행되고 나머지는 소각돼요.");
        expect(ko.redeem.ctaWithCost("리딤하기", ko.redeem.cost("10"))).toBe("리딤하기 — 10개 소각");
        expect(ko.trade.slippage).toBe("슬리피지 1%");
        expect(ko.onboarding.done("① 테스트 KRWs 받기")).toBe("① 테스트 KRWs 받기 완료");
        expect(ko.offeringCreate.sponsorBurn("30")).toBe("소각 30%");
    });
});

describe("no Hangul literals in the offering screens (W-T41)", () => {
    const SOURCES = import.meta.glob(
        ["../components/ChainTerms.tsx", "../components/DisclosureForm.tsx", "../components/DisclosureSection.tsx", "../components/LogStateNote.tsx",
            "../components/ProceedsPanel.tsx", "../components/RefundPanel.tsx", "../components/PriceChart.tsx",
            "../pages/Home.tsx", "../pages/Membership.tsx", "../pages/Offering.tsx", "../pages/OfferingNew.tsx", "../pages/Redeem.tsx", "../pages/Trade.tsx", "../App.tsx",
            "../lib/commitGuard.ts", "../lib/createOffering.ts", "../lib/proceedsText.ts"],
        {query: "?raw", import: "default", eager: true}
    ) as Record<string, string>;
    const FILES = [
        "components/ChainTerms.tsx", "components/DisclosureForm.tsx", "components/DisclosureSection.tsx", "components/LogStateNote.tsx",
        "components/ProceedsPanel.tsx", "components/RefundPanel.tsx", "components/PriceChart.tsx",
        "pages/Home.tsx", "pages/Membership.tsx", "pages/Offering.tsx", "pages/OfferingNew.tsx", "pages/Redeem.tsx", "pages/Trade.tsx", "App.tsx",
        "lib/commitGuard.ts", "lib/createOffering.ts", "lib/proceedsText.ts",
    ];
    it("every string and JSX text comes from the dictionaries (comments excepted)", () => {
        expect(Object.keys(SOURCES)).toHaveLength(FILES.length);
        for (const f of FILES) {
            const src = SOURCES[`../${f}`].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
            const lines = src.split("\n").filter((l: string) => HANGUL.test(l));
            expect(lines, f).toEqual([]);
        }
    });
    it("no screen file imports the fixed Korean dictionary", () => {
        for (const f of FILES) expect(SOURCES[`../${f}`], f).not.toMatch(/import \{[^}]*\bcopy\b[^}]*\} from "\.\.?\/copy"/);
    });
});

describe("date and number helpers follow the language (W-T41)", () => {
    const ms = Date.UTC(2026, 10, 17, 6, 30);
    it("dates: en-US and ko-KR", () => {
        expect(fmtWhen(ms, "en-US")).toMatch(/^November 17/);
        expect(fmtWhen(ms, "ko-KR")).toMatch(/^11월 17일/);
        expect(fmtWhen(ms, "en-US", true)).toMatch(/2026/);
        expect(fmtWhen(ms, "ko-KR", true)).toMatch(/^2026년 11월 17일/);
    });
    it("counts: comma grouping in both", () => {
        expect(fmtCount(1095, "en-US")).toBe("1,095");
        expect(fmtCount(1095n, "ko-KR")).toBe("1,095");
    });
    it("countdown: the closed label is the language's", () => {
        expect(countdown(1n, Date.now())).toBe("마감");
        expect(countdown(1n, Date.now(), en.offering.deadline)).toBe("Closed");
    });
});

describe("pure modules in both languages (W-T41)", () => {
    it("spanText", () => {
        expect(spanText(1095 * 86_400)).toBe("1,095일");
        expect(spanText(1095 * 86_400, en)).toBe("1,095 days");
        expect(spanText(3600 * 5, en)).toBe("5 hours");
    });
    it("allocationText", () => {
        expect(allocationText(6000, 2000, 2000)).toBe("판매 60% · 발행자 20% · 유동성 12% · 소각 8%");
        expect(allocationText(6000, 2000, 2000, en)).toBe("Sale 60% · Issuer 20% · Liquidity 12% · Burn 8%");
    });
    it("commitBlock", () => {
        const base = {account: undefined, creator: "0x1", verified: true, settled: false, refunding: false, deadlineSec: 10n ** 12n, nowMs: 0, amount: 1n, myCommitted: 0n, minCommit: 0n, walletLimit: 0n, balance: 10n};
        expect(commitBlock(base)).toBe(ko.hints.connectWallet);
        expect(commitBlock(base, en)).toBe("Connect a wallet.");
        expect(commitBlock({...base, account: "0x1"}, en)).toBe(en.offering.issuerCannotCommit);
    });
    it("checkCreate", () => {
        const E = 10n ** 18n;
        const B: ChainBounds = {
            guide: {minPrice: 1000n * E, maxPrice: 100_000n * E, minRaise: 5_000_000n * E, maxRaise: 500_000_000n * E, minWalletLimitBps: 10, maxWalletLimitBps: 3000},
            band: {maxUpfrontBps: 3000, minLockDuration: 3600n, maxLockDuration: 94_608_000n, maxLockCliff: 15_552_000n},
            minRaise: 500_000n * E, swapRoyaltyBps: 60, swapBurnBps: 30, offeringFeeBps: 0, maxNameBytes: 32,
        };
        const f = {...DEFAULT_FORM, name: "노들 프로토콜", symbol: "nodl", price: "1,000", raiseTarget: "50000000", walletLimit: "5000000", minCommit: "10000", durationHours: "11"};
        expect(checkCreate(f, B).errors.durationHours).toBe("12시간부터 48시간까지 입력할 수 있어요");
        expect(checkCreate(f, B, en).errors.durationHours).toBe("Enter a value from 12 hours to 48 hours.");
        expect(checkCreate({...f, durationHours: "12", name: ""}, B, en).errors.name).toBe("Required.");
    });
});

describe("W-T46: Korean offering copy uses 해요체 and the unit 개", () => {
    const all = OFFERING_KEYS.flatMap((k) => texts((ko as Record<string, unknown>)[k]));
    it("no unit 장 / 장수", () => {
        for (const s of all) {
            expect(s, s).not.toMatch(/ 장(?![가-힣])/);
            expect(s, s).not.toMatch(/장수/);
        }
        expect(ko.offering.allocUnit).toBe(" 개");
        expect(ko.offering.totalSupplyLine("46")).toBe("총공급 46개, 정산 때 확정, 추가 발행 불가");
    });
    it("no 합쇼체 endings", () => {
        for (const s of all) expect(s, s).not.toMatch(/(습니다|합니다|됩니다)/);
    });
});

describe("W-T46: one spelling per wallet in mixed lists", () => {
    it("displayAddr gives the same text for lowercase and checksummed input", async () => {
        const {displayAddr} = await import("../lib/format");
        expect(displayAddr("0x45d52d167d22970f69dcd127dfc38d875a29efb0")).toBe("0x45D5…EFb0");
        expect(displayAddr("0x45D52d167d22970f69dCd127dFc38D875A29EFb0")).toBe("0x45D5…EFb0");
        expect(displayAddr("nope")).toBe("nope…nope");
    });
});
