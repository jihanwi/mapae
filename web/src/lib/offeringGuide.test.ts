// W-T75: the step and the "what to do now" line for each row of the ticket's table.
import {describe, expect, it} from "vitest";
import {cancelLocked, guideSteps, offeringGuide, type GuideInput} from "./offeringGuide";
import {OFFERING_CONSTS} from "../contracts/offeringBoundsL1";

const DEADLINE = 1_900_000_000n;
const FREEZE = OFFERING_CONSTS.CANCEL_FREEZE;
const base: GuideInput = {
    settled: false,
    refunding: false,
    deadline: DEADLINE,
    nowSec: DEADLINE - FREEZE - 3600n,
    after: undefined,
    connected: true,
    verified: true,
    issuer: false,
    myCommitted: 0n,
    allocation: undefined,
    claimed: undefined,
};
const g = (p: Partial<GuideInput>) => offeringGuide({...base, ...p});

describe("W-T75 offeringGuide: open", () => {
    it("no wallet", () => expect(g({connected: false, verified: false})).toEqual({stage: "commit", line: "connect"}));
    it("connected, not verified", () => expect(g({verified: false})).toEqual({stage: "commit", line: "verify"}));
    it("issuer: no line (issuerCannotCommit is already on the page)", () => {
        expect(g({issuer: true})).toEqual({stage: "commit", line: null});
        expect(g({issuer: true, nowSec: DEADLINE - 60n})).toEqual({stage: "commit", line: null});
    });
    it("no commitment, cancel window", () => expect(g({})).toEqual({stage: "commit", line: "open"}));
    it("committed, cancel window", () => expect(g({myCommitted: 1n})).toEqual({stage: "commit", line: "committed"}));
    it("cancel locked (the CANCEL_FREEZE window, or phase Frozen)", () => {
        expect(g({nowSec: DEADLINE - FREEZE})).toEqual({stage: "commit", line: "frozen"});
        expect(g({nowSec: DEADLINE - 1n, myCommitted: 5n})).toEqual({stage: "commit", line: "frozen"});
        expect(g({phaseFrozen: true})).toEqual({stage: "commit", line: "frozen"});
        expect(g({nowSec: DEADLINE - FREEZE - 1n})).toEqual({stage: "commit", line: "open"});
    });
    it("cancelLocked uses the codegen constant (2 hours)", () => {
        expect(FREEZE).toBe(7200n);
        expect(cancelLocked({deadline: DEADLINE, nowSec: DEADLINE - 7200n})).toBe(true);
        expect(cancelLocked({deadline: DEADLINE, nowSec: DEADLINE - 7201n})).toBe(false);
    });
});

describe("W-T75 offeringGuide: closed, waiting for settle", () => {
    const after = {kind: "awaitSettle" as const, emergencyAt: DEADLINE + 86_400n};
    it("committed", () => expect(g({nowSec: DEADLINE + 10n, after, myCommitted: 3n})).toEqual({stage: "close", line: "closedCommitted"}));
    it("no commitment (or no wallet)", () => {
        expect(g({nowSec: DEADLINE + 10n, after})).toEqual({stage: "close", line: "closedEmpty"});
        expect(g({nowSec: DEADLINE + 10n, after, connected: false})).toEqual({stage: "close", line: "closedEmpty"});
    });
    it("chain state not read yet: the close step, no line", () => expect(g({nowSec: DEADLINE + 10n})).toEqual({stage: "close", line: null}));
});

describe("W-T75 offeringGuide: settled", () => {
    it("an allocation to claim", () => expect(g({settled: true, allocation: "some", claimed: false})).toEqual({stage: "claim", line: "claimReady"}));
    it("claimed, or no allocation, or no wallet: trade", () => {
        expect(g({settled: true, allocation: "some", claimed: true})).toEqual({stage: "trade", line: "tradeOpen"});
        expect(g({settled: true, allocation: "none", claimed: false})).toEqual({stage: "trade", line: "tradeOpen"});
        expect(g({settled: true, connected: false})).toEqual({stage: "trade", line: "tradeOpen"});
    });
    it("still loading: trade step, no line", () => expect(g({settled: true, allocation: undefined, claimed: undefined})).toEqual({stage: "trade", line: null}));
});

describe("W-T75 offeringGuide: refund states have no line", () => {
    const kinds = [
        {kind: "canStartRefund" as const},
        {kind: "claim" as const, amount: 5n},
        {kind: "refunding" as const, refunded: undefined},
        {kind: "canEmergencyRefund" as const},
        {kind: "canClose" as const},
        {kind: "closedEmpty" as const},
    ];
    for (const after of kinds) {
        it(after.kind, () => {
            expect(g({nowSec: DEADLINE + 10n, after, myCommitted: 5n})).toEqual({stage: "refund", line: null});
        });
    }
    it("the refunding flag alone", () => expect(g({refunding: true})).toEqual({stage: "refund", line: null}));
});

describe("W-T75 guideSteps", () => {
    it("four steps, done / now / next", () => {
        expect(guideSteps("claim")).toEqual([
            {key: "commit", state: "done"},
            {key: "close", state: "done"},
            {key: "claim", state: "now"},
            {key: "trade", state: "next"},
        ]);
        expect(guideSteps("commit").map((s) => s.state)).toEqual(["now", "next", "next", "next"]);
    });
    it("refund replaces claim and trade with one step", () => {
        expect(guideSteps("refund")).toEqual([
            {key: "commit", state: "done"},
            {key: "close", state: "done"},
            {key: "refund", state: "now"},
        ]);
    });
});
