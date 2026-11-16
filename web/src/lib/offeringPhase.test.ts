import {describe, expect, it} from "vitest";
import {afterDeadline, PhaseInput} from "./offeringPhase";
import {OFFERING_CONSTS} from "../contracts/offeringBoundsL1";

const E = 10n ** 18n;
const DEADLINE = 1_800_000_000n;
const base: PhaseInput = {settled: false, refunding: false, refundMode: 0, deadline: DEADLINE, totalCommitted: 15_000n * E, raiseTarget: 5_000_000n * E, chainTs: DEADLINE + 60n, myCommitted: 15_000n * E};

describe("after the deadline (W-T38)", () => {
    it("SETTLE_TIMEOUT comes from codegen (7 days)", () => {
        expect(OFFERING_CONSTS.SETTLE_TIMEOUT).toBe(7n * 86_400n);
    });
    it("before the deadline: open (chain time, not the device clock)", () => {
        expect(afterDeadline({...base, chainTs: DEADLINE - 1n})).toEqual({kind: "open"});
    });
    it("a: all-or-nothing, deadline passed, target missed -> anyone may start refunds", () => {
        expect(afterDeadline(base)).toEqual({kind: "canStartRefund"});
        expect(afterDeadline({...base, chainTs: DEADLINE})).toEqual({kind: "canStartRefund"});
        expect(afterDeadline({...base, myCommitted: undefined})).toEqual({kind: "canStartRefund"});
    });
    it("b: refunding with a commitment -> claim the full amount", () => {
        expect(afterDeadline({...base, refunding: true})).toEqual({kind: "claim", amount: 15_000n * E});
    });
    it("c: refunding, nothing to claim; refunded only when known", () => {
        expect(afterDeadline({...base, refunding: true, myCommitted: 0n})).toEqual({kind: "refunding", refunded: undefined});
        expect(afterDeadline({...base, refunding: true, myCommitted: 0n, myRefunded: true})).toEqual({kind: "refunding", refunded: true});
        expect(afterDeadline({...base, refunding: true, myCommitted: undefined, myRefunded: false})).toEqual({kind: "refunding", refunded: false});
    });
    it("d: target met (or partial mode) -> waiting for settle until deadline + 7 days", () => {
        const met = {...base, totalCommitted: 5_000_000n * E};
        expect(afterDeadline(met)).toEqual({kind: "awaitSettle", emergencyAt: DEADLINE + 604_800n});
        expect(afterDeadline({...base, refundMode: 1})).toEqual({kind: "awaitSettle", emergencyAt: DEADLINE + 604_800n});
        expect(afterDeadline({...met, chainTs: DEADLINE + 604_799n}).kind).toBe("awaitSettle");
    });
    it("e: the settle timeout passed -> anyone may call emergencyRefund (any mode)", () => {
        const met = {...base, totalCommitted: 5_000_000n * E};
        expect(afterDeadline({...met, chainTs: DEADLINE + 604_800n})).toEqual({kind: "canEmergencyRefund"});
        expect(afterDeadline({...base, refundMode: 1, chainTs: DEADLINE + 700_000n})).toEqual({kind: "canEmergencyRefund"});
        // all-or-nothing under target stays on enableRefunds (the cheaper, earlier path)
        expect(afterDeadline({...base, chainTs: DEADLINE + 700_000n})).toEqual({kind: "canStartRefund"});
    });
    it("settled wins over everything", () => {
        expect(afterDeadline({...base, settled: true, refunding: false})).toEqual({kind: "settled"});
    });
});

describe("refund copy and error table (W-T38)", async () => {
    const {ko} = await import("../copy/ko");
    const {OfferingL1Abi} = await import("../contracts/abisV3L1");
    const SRC = (await import("../pages/Offering.tsx?raw")).default;
    it("every mapped revert name is an Offering error", () => {
        const names = new Set(OfferingL1Abi.filter((x) => x.type === "error").map((x) => (x as {name: string}).name));
        for (const k of Object.keys(ko.refund.errors)) if (k !== "unknown" && k !== "stateChanged") expect(names.has(k), k).toBe(true);
        for (const k of ["TargetReached", "DeadlineNotReached", "RefundNotAvailable", "NothingToRefund", "SettleTimeoutNotReached", "InvalidPhase"]) expect(ko.refund.errors[k], k).toBeDefined();
    });
    it("no 'automatic refund' wording anywhere", () => {
        expect(JSON.stringify(ko, (_, v) => (typeof v === "bigint" ? String(v) : typeof v === "function" ? String(v("1", "2")) : v))).not.toContain("자동 환불");
        expect(SRC).not.toContain("자동 환불");
        expect(ko.refund.modeNote).toBe("목표에 못 미치면 마감 뒤 환불을 시작할 수 있고, 응모금 전액을 돌려받아요");
    });
    it("the state sentences", () => {
        expect(ko.refund.claimCta("15,000")).toBe("환불 받기 · 15,000 KRWs");
        expect(ko.refund.refunded("15,000")).toBe("환불 받았어요 · 15,000 KRWs");
        expect(ko.refund.awaitSettle("2026년 11월 25일")).toBe("정산을 기다리는 중이에요. 2026년 11월 25일까지 정산되지 않으면 누구나 환불을 시작할 수 있어요");
    });
});
