import {describe, expect, it} from "vitest";
import {ctaDecision, CtaFacts} from "../hooks/curves";
import {AUTO_RETRY_MS, INITIAL_GRACE_MS, tokenPageState} from "./tokenPage";
import {ko} from "../copy/ko";
import {en} from "../copy/en";
import {ADDR_V3} from "../contracts/addressesV3";

const KRW = "0x74eC9141afAd51F346BA5B841Ba93D573e8786fD" as const;
const SPENDER = "0x06f042817c7bBb18C793c586E7afe2870205355D" as const;
const base: CtaFacts = {
    connected: true,
    rightChain: true,
    verified: false,
    verify: "none",
    nowSec: 1_000,
    amount: 10n,
    payToken: KRW,
    spender: SPENDER,
    nativeBalance: undefined,
    balance: 100n,
    allowance: 100n,
};

describe("v3.1 CTA transitions", () => {
    const window = {priorityUntil: 1_600n};
    it("buy inside the window: unverified waits with the remaining time, verified can buy", () => {
        expect(ctaDecision({...base, verify: window})).toEqual({kind: "priorityWait", remainingSec: 600});
        expect(ctaDecision({...base, verify: window, verified: true})).toEqual({kind: "ready"});
        expect(ctaDecision({...base, verify: window, verified: undefined})).toEqual({kind: "loading"});
    });
    it("buy after the window: no real-name check at all", () => {
        expect(ctaDecision({...base, verify: window, nowSec: 1_600})).toEqual({kind: "ready"});
        expect(ctaDecision({...base, verify: window, nowSec: 5_000, verified: undefined})).toEqual({kind: "ready"});
        expect(ctaDecision({...base, verify: window, nowSec: 1_600, allowance: 0n})).toMatchObject({kind: "approve"});
    });
    it("sell and pool swaps never check verification", () => {
        expect(ctaDecision({...base, verify: "none", verified: false})).toEqual({kind: "ready"});
        expect(ctaDecision({...base, verify: "none", verified: undefined, balance: 1n})).toEqual({kind: "insufficient"});
    });
    it("launch still requires a verified wallet", () => {
        expect(ctaDecision({...base, verify: "required", verified: false})).toEqual({kind: "notVerified"});
        expect(ctaDecision({...base, verify: "required", verified: true})).toEqual({kind: "ready"});
    });
    it("connection and network come first", () => {
        expect(ctaDecision({...base, connected: false, verify: window})).toEqual({kind: "connect"});
        expect(ctaDecision({...base, rightChain: false, verify: window})).toEqual({kind: "wrongChain"});
    });
});

describe("old curve addresses", () => {
    it("an address the v3.1 factory does not know is 'not found', not an error", () => {
        expect(tokenPageState({validAddress: true, isCurve: false, registryError: false, curveError: false, curveLoaded: false})).toBe("notFound");
        expect(tokenPageState({validAddress: false, isCurve: undefined, registryError: false, curveError: false, curveLoaded: false})).toBe("notFound");
        expect(tokenPageState({validAddress: true, isCurve: undefined, registryError: false, curveError: false, curveLoaded: false})).toBe("loading");
        expect(tokenPageState({validAddress: true, isCurve: true, registryError: false, curveError: false, curveLoaded: true})).toBe("ready");
    });
    it("W-T16: stale after data, skeleton then error before it", () => {
        const base = {validAddress: true, isCurve: true as boolean | undefined, registryError: false, curveError: false, curveLoaded: false};
        // a read fails after data loaded once: keep the data and show the band
        expect(tokenPageState({...base, curveError: true, curveLoaded: true, hadData: true, graceOver: true})).toBe("stale");
        expect(tokenPageState({...base, registryError: true, curveLoaded: true, hadData: true})).toBe("stale");
        // never loaded: skeleton during the grace period, then the error
        expect(tokenPageState({...base, curveError: true, hadData: false, graceOver: false})).toBe("loading");
        expect(tokenPageState({...base, curveError: true, hadData: false, graceOver: true})).toBe("error");
        // still loading (no failure yet) after the grace period: the error and its retry
        expect(tokenPageState({...base, graceOver: false})).toBe("loading");
        expect(tokenPageState({...base, graceOver: true})).toBe("error");
        expect(tokenPageState({...base, isCurve: undefined, graceOver: true})).toBe("error");
        // recovers to ready, and not-found wins over everything
        expect(tokenPageState({...base, curveLoaded: true, hadData: true, graceOver: true})).toBe("ready");
        expect(tokenPageState({...base, isCurve: false, curveError: true, hadData: true})).toBe("notFound");
        expect(INITIAL_GRACE_MS).toBe(8_000);
        expect(AUTO_RETRY_MS).toBe(10_000);
    });
});

describe("v3.1 rule copy", () => {
    it("uses the reference sentences with minutes from ADDR_V3.priorityWindow", () => {
        const m = ADDR_V3.priorityWindow / 60;
        expect(ko.priority.rule).toBe(`출시 후 ${m}분 동안은 실명 지갑만 살 수 있어요. 그 뒤에는 누구나 살 수 있어요.`);
        expect(en.priority.rule).toBe(`For the first ${m} minutes after launch, only verified wallets can buy. After that, anyone can.`);
        for (const s of [ko.curve.listSub, ko.curve.poolNote, en.curve.listSub, en.curve.poolNote]) {
            expect(s).not.toMatch(/실명 지갑만 (사고팔|거래)|only verified wallets can trade/i);
        }
    });
});
