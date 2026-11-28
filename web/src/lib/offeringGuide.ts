// W-T75: where an offering is in its four steps and the one thing this wallet can do now, from the
// values the detail page already reads (no extra chain read). Pure; the copy keys are in
// copy.offering.guideNow.
//
// Steps: commit -> close (allocation) -> claim -> trade, or commit -> close -> refund.
// Clock: while the offering is open the page's own clock decides (as its countdown and "frozen"
// badge do); after the deadline the afterDeadline() state (chain time) decides.
import type {AfterDeadline} from "./offeringPhase";
import {OFFERING_CONSTS} from "../contracts/offeringBoundsL1";

export type GuideStage = "commit" | "close" | "claim" | "trade" | "refund";
export type GuideLine =
    | "connect"
    | "verify"
    | "open"
    | "committed"
    | "frozen"
    | "closedCommitted"
    | "closedEmpty"
    | "claimReady"
    | "tradeOpen";

export type GuideInput = {
    settled: boolean;
    refunding: boolean;
    /** seconds */
    deadline: bigint;
    /** seconds; the page clock while open */
    nowSec: bigint;
    /** afterDeadline() once the deadline passed (chain time); undefined until it is known */
    after: AfterDeadline | undefined;
    /** phase() == Frozen when the page has it; otherwise the cancel window decides */
    phaseFrozen?: boolean;
    connected: boolean;
    verified: boolean;
    issuer: boolean;
    /** committed[wallet]; 0 without a wallet */
    myCommitted: bigint;
    /** "none": no row in the allocation file; undefined while it loads or without a wallet */
    allocation: "none" | "some" | undefined;
    /** hasClaimed(wallet); undefined while it loads */
    claimed: boolean | undefined;
    cancelFreeze?: bigint;
};

export type Guide = {stage: GuideStage; line: GuideLine | null};

const REFUND_KINDS = new Set<AfterDeadline["kind"]>(["canStartRefund", "claim", "refunding", "canEmergencyRefund", "canClose", "closedEmpty"]);

/** Cancelling is closed: phase Frozen, or within CANCEL_FREEZE of the deadline (codegen value). */
export function cancelLocked(p: {deadline: bigint; nowSec: bigint; phaseFrozen?: boolean; cancelFreeze?: bigint}): boolean {
    const freeze = p.cancelFreeze ?? OFFERING_CONSTS.CANCEL_FREEZE;
    return p.phaseFrozen === true || p.nowSec >= p.deadline - freeze;
}

export function offeringGuide(p: GuideInput): Guide {
    // settled: claim when an allocation waits for this wallet, otherwise trade
    if (p.settled) {
        if (p.allocation === "some" && p.claimed === false) return {stage: "claim", line: "claimReady"};
        if (p.allocation === "none" || (p.allocation === "some" && p.claimed === true)) return {stage: "trade", line: "tradeOpen"};
        // without a wallet there is nothing to claim: trading is open
        if (!p.connected) return {stage: "trade", line: "tradeOpen"};
        return {stage: "trade", line: null};
    }
    // refunds: the refund panel explains each state, so no line here
    if (p.refunding || (p.after && REFUND_KINDS.has(p.after.kind))) return {stage: "refund", line: null};

    const open = p.nowSec < p.deadline && (!p.after || p.after.kind === "open");
    if (open) {
        if (!p.connected) return {stage: "commit", line: "connect"};
        if (!p.verified) return {stage: "commit", line: p.issuer ? null : "verify"};
        if (p.issuer) return {stage: "commit", line: null};
        if (cancelLocked(p)) return {stage: "commit", line: "frozen"};
        return {stage: "commit", line: p.myCommitted > 0n ? "committed" : "open"};
    }
    // after the deadline, waiting for settle (a refund state is handled above)
    if (p.after?.kind === "awaitSettle") return {stage: "close", line: p.myCommitted > 0n ? "closedCommitted" : "closedEmpty"};
    return {stage: "close", line: null};
}

/** The four (or three, ending in refund) steps in order, with this offering's position. */
export function guideSteps(stage: GuideStage): {key: Exclude<GuideStage, never>; state: "done" | "now" | "next"}[] {
    const order: GuideStage[] = stage === "refund" ? ["commit", "close", "refund"] : ["commit", "close", "claim", "trade"];
    const at = order.indexOf(stage);
    return order.map((key, i) => ({key, state: i < at ? "done" : i === at ? "now" : "next"}));
}
