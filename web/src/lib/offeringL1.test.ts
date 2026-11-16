// W-T32: the offering section on v3.2-L1. Guards for the address record, the ABI split between L0
// and L1, the removed v2 data and fixed numbers, and the copy rules of the new proceeds area.
import {describe, expect, it} from "vitest";
import {ADDR_L1} from "../contracts/addressesV3L1";
import {ADDR_V3} from "../contracts/addressesV3";
import {MapaeFactoryV3Abi} from "../contracts/abisV3";
import {MapaeFactoryL1Abi, OfferingL1Abi, ProceedsLockAbi} from "../contracts/abisV3L1";
import {ko} from "../copy/ko";
import {feeParts} from "../pages/Trade";
import HOOKS from "../hooks.ts?raw";
import HOME from "../pages/Home.tsx?raw";
import OFFERING from "../pages/Offering.tsx?raw";
import MEMBERSHIP from "../pages/Membership.tsx?raw";
import REDEEM from "../pages/Redeem.tsx?raw";
import TRADE from "../pages/Trade.tsx?raw";
import APP from "../App.tsx?raw";
import PROCEEDS from "../components/ProceedsPanel.tsx?raw";

const names = (abi: readonly {type: string; name?: string}[]) => abi.filter((x) => x.type === "function" || x.type === "event").map((x) => x.name);

describe("v3.2-L1 address record", () => {
    it("the deployed factory, block and reused contracts", () => {
        expect(ADDR_L1.mapaeFactory).toBe("0xa9CA0C10Cd6B6398679B578DCE192cb4cAA5bc71");
        expect(ADDR_L1.proceedsLockDeployer).toBe("0x755568f5BB314DD67c0ffB91Db491d1f63AA97C9");
        expect(ADDR_L1.deployBlock).toBe(41_489_012n);
        expect(ADDR_L1.dojangAnyOf).toBe("0x87326FbbF76e724bA2bA954dAc04c3B939999f84");
        expect(ADDR_L1.buybackVault).toBe("0x3Ed11f7Bcc36B3603d51736652884800daa2f54c");
        // same payment token, feeRouter, poolFactory and real-name check as the v3.2 stack
        expect(ADDR_L1.mockKRW).toBe(ADDR_V3.mockKRW);
        expect(ADDR_L1.feeRouter).toBe(ADDR_V3.feeRouter);
        expect(ADDR_L1.poolFactory).toBe(ADDR_V3.poolFactory);
        expect(ADDR_L1.mockDojang).toBe(ADDR_V3.mockDojang);
    });
    it("L0 keeps the old factory (quote registry); the offering section uses the new one", () => {
        expect(ADDR_V3.mapaeFactory).toBe("0xC0E22127A44266cCC56B2503504373777d0645A9");
        expect(ADDR_V3.mapaeFactory).not.toBe(ADDR_L1.mapaeFactory);
    });
});

describe("codegen ABI split (no cross overwrite)", () => {
    it("the L0 factory ABI is only the quote registry", () => {
        expect(names(MapaeFactoryV3Abi).sort()).toEqual(["QuoteAllowed", "QuoteEnabledSet", "allQuotes", "isQuoteAllowed", "quoteConfig"]);
    });
    it("the L1 ABIs carry the v3.2-L1 surface", () => {
        expect(names(MapaeFactoryL1Abi)).toEqual(expect.arrayContaining(["proceedsLockOf", "proceedsBand", "sponsorshipOf", "redeemManagerOf", "allOfferings"]));
        expect(names(OfferingL1Abi)).toEqual(expect.arrayContaining(["proceedsLock", "proceedsUpfrontBps", "ProceedsDistributed", "recipients"]));
        expect(names(ProceedsLockAbi)).toEqual(expect.arrayContaining(["start", "duration", "cliff", "released", "releasable", "release", "owner"]));
    });
});

describe("offering section: no v2 leftovers", () => {
    const files = {HOOKS, HOME, OFFERING, MEMBERSHIP, REDEEM, TRADE, APP, PROCEEDS};
    it.each(Object.entries(files))("%s imports no v2 ABI or address file and no demo name table", (_, src) => {
        expect(src).not.toMatch(/contracts\/abis"/);
        expect(src).not.toMatch(/contracts\/addresses"/);
        expect(src).not.toMatch(/lib\/creators/);
        expect(src).not.toMatch(/redeem\.names/);
        // v2 pool names (v3 uses quote); Sponsorship's Sponsored event keeps its own krwIn field
        expect(src).not.toMatch(/swapKrwForToken|swapTokenForKrw|getKrwOut|reserveKrw|bool krwIn, uint256 amountIn, uint256 amountOut, uint256 royalty/);
    });
    it("no fixed vesting or fee numbers in the copy", () => {
        const all = JSON.stringify(ko, (_, v) => (typeof v === "bigint" ? String(v) : v));
        expect(all).not.toContain("36개월");
        expect(all).not.toContain("6개월 클리프");
        expect(all).not.toContain("수수료 2%");
        expect(String(ko.offering.aboutVesting("365일", "30일"))).toBe("발행자 배분 물량은 365일에 걸쳐 풀려요. 처음 30일 동안은 풀리지 않아요.");
        expect(String(ko.offering.aboutVesting("365일", null))).toBe("발행자 배분 물량은 365일에 걸쳐 풀려요.");
    });
});

describe("proceeds and log copy", () => {
    const texts = (v: unknown): string[] => {
        if (typeof v === "string") return [v];
        if (typeof v === "function") return [String((v as (...a: string[]) => unknown)("1", "2", "3", "4", "5"))];
        if (v && typeof v === "object") return Object.values(v).flatMap(texts);
        return [];
    };
    const scope = [ko.home, ko.offering, ko.trade, ko.redeem, ko.logs];
    it.each(["수익", "투자", "오른다", "안전", "보장", "크리에이터", "팬", "멤버십"])("no %s", (w) => {
        expect(texts(scope).filter((t) => t.includes(w))).toEqual([]);
    });
    it("the fixed proceeds wording", () => {
        expect(ko.offering.proceedsNote).toBe("잠긴 금액은 정해진 일정에 따라 발행자에게만 지급돼요. 플랫폼은 이 금액을 옮길 수 없어요");
        expect(ko.offering.proceedsTerms("30", "365일")).toBe("즉시 지급 30% · 나머지는 365일에 걸쳐 지급");
        expect(ko.offering.proceedsCliff("30일")).toBe("지급 시작까지 30일");
        expect(ko.home.emptyTitle).toBe("아직 열린 공모가 없어요");
        expect(ko.home.emptyNote).toBe("공모가 열리면 여기에 표시돼요");
        expect(ko.logs.failed).toBe("기록을 불러오지 못했어요");
        expect(ko.logs.noTradesRecent("30")).toBe("최근 약 30시간 안에는 거래가 없어요");
        expect(ko.logs.noTrades).toBe("아직 거래가 없어요");
    });
    it("the release button is only for the lock's beneficiary", () => {
        expect(PROCEEDS).toMatch(/isIssuer = .*account\.toLowerCase\(\) === beneficiary\.toLowerCase\(\)/);
        expect(PROCEEDS).toMatch(/isIssuer && \(/);
        expect(PROCEEDS).toMatch(/disabled=\{s\.releasable === 0n\}/);
    });
});

describe("pool fee split (Trade)", () => {
    it("percent parts from the pool and the FeeRouter tier, only when they add up to totalFeeBps", () => {
        // L1 preset: platform 40 + LP 20 (router), royalty 60 + burn 30 (pool) = 150
        expect(feeParts(150, 60, 30, {swapPlatformBps: 40, swapLpBps: 20})).toEqual({total: "1.5", royalty: "0.6", burn: "0.3", lp: "0.2", platform: "0.4"});
        expect(feeParts(150, 60, 30, {swapPlatformBps: 40, swapLpBps: 10})).toBeUndefined();
        expect(feeParts(undefined, 60, 30, {swapPlatformBps: 40, swapLpBps: 20})).toBeUndefined();
        expect(feeParts(150, 60, 30, undefined)).toBeUndefined();
    });
});
