import {describe, expect, it} from "vitest";
import {afterDeadline, allowsZeroCommitClose, PhaseInput} from "./offeringPhase";
import {ko} from "../copy/ko";
import {en} from "../copy/en";
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

describe("v3.4-L1: closing an offering nobody committed to", () => {
    const V34 = "0x3D3aD542A0953797B5537f19d6aEc84C8b6FC227";
    const V33 = "0x3b1D679d6CFA5f2e92832aFfBf516319204D767f";
    const V32 = "0xa9CA0C10Cd6B6398679B578DCE192cb4cAA5bc71";
    const empty = {...base, totalCommitted: 0n, myCommitted: 0n};
    it("only offerings of the v3.4-L1 factory (or later) may close with zero commitments", () => {
        expect(allowsZeroCommitClose(V34)).toBe(true);
        expect(allowsZeroCommitClose(V34.toLowerCase())).toBe(true);
        expect(allowsZeroCommitClose(V33)).toBe(false);
        expect(allowsZeroCommitClose(V32)).toBe(false);
        expect(allowsZeroCommitClose(undefined)).toBe(false);
        expect(allowsZeroCommitClose("0x00000000000000000000000000000000000000ff")).toBe(false);
        expect(allowsZeroCommitClose("0xabc", [{version: "v3.5-L1", mapaeFactory: "0xABC"}])).toBe(true);
    });
    it("v3.4 factory, zero commitments, past the deadline: close, in either mode", () => {
        expect(afterDeadline({...empty, refundMode: 1, zeroCommitClose: true})).toEqual({kind: "canClose"});
        expect(afterDeadline({...empty, refundMode: 0, zeroCommitClose: true})).toEqual({kind: "canClose"});
        expect(afterDeadline({...empty, refundMode: 1, zeroCommitClose: true, chainTs: DEADLINE - 1n})).toEqual({kind: "open"});
    });
    it("an older factory's partial-mode, zero-commit offering still waits for settle", () => {
        expect(afterDeadline({...empty, refundMode: 1, zeroCommitClose: false})).toEqual({kind: "awaitSettle", emergencyAt: DEADLINE + OFFERING_CONSTS.SETTLE_TIMEOUT});
    });
    it("a partial-mode offering with commitments waits for settle on any factory", () => {
        expect(afterDeadline({...base, refundMode: 1, zeroCommitClose: true})).toEqual({kind: "awaitSettle", emergencyAt: DEADLINE + OFFERING_CONSTS.SETTLE_TIMEOUT});
    });
    it("closed (refunding, zero commitments): no refund to claim", () => {
        expect(afterDeadline({...empty, refunding: true, zeroCommitClose: true})).toEqual({kind: "closedEmpty"});
        expect(afterDeadline({...base, refunding: true})).toEqual({kind: "claim", amount: 15_000n * E});
    });
    it("copy", () => {
        expect(ko.refund.closeNote).toBe("응모가 없어서 공모를 종료할 수 있어요");
        expect(ko.refund.closeCta).toBe("공모 종료");
        expect(ko.refund.closedEmpty).toBe("응모 없이 종료된 공모예요");
        expect(en.refund.closeNote).toBe("No one committed. You can close this offering.");
        expect(en.refund.closeCta).toBe("Close offering");
        expect(en.refund.closedEmpty).toBe("This offering closed with no commitments.");
        for (const s of [en.refund.closeNote, en.refund.closeCta, en.refund.closedEmpty, en.offeringCreate.gate.active]) expect(s).not.toMatch(/[\u3131-\u318E\uAC00-\uD7A3]/);
    });
});
