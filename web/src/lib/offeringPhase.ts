// What an offering allows after its deadline (W-T38), from chain values only. Refunds are never
// automatic in Offering.sol:
//   enableRefunds()   anyone; AllOrNothing, deadline passed, totalCommitted < raiseTarget, not settled / refunding
//   emergencyRefund() anyone; deadline + SETTLE_TIMEOUT passed, not settled / refunding (any mode)
//   refund()          refunding; pays committed[msg.sender] in full
// Times are chain block times (seconds). SETTLE_TIMEOUT comes from codegen (Offering.sol).
import {OFFERING_CONSTS} from "../contracts/offeringBoundsL1";

export type PhaseInput = {
    settled: boolean;
    refunding: boolean;
    /** 0 AllOrNothing, 1 Partial */
    refundMode: number;
    deadline: bigint;
    totalCommitted: bigint;
    raiseTarget: bigint;
    /** latest block time */
    chainTs: bigint;
    /** committed[connected wallet]; undefined without a wallet or before the read */
    myCommitted: bigint | undefined;
    /** the connected wallet has a Refunded event (true), none in a complete read (false), unknown (undefined) */
    myRefunded?: boolean | undefined;
    settleTimeout?: bigint;
};

export type AfterDeadline =
    | {kind: "open"}
    | {kind: "settled"}
    /** a: target missed (AllOrNothing): anyone may call enableRefunds */
    | {kind: "canStartRefund"}
    /** b: refunding and this wallet has a commitment to take back */
    | {kind: "claim"; amount: bigint}
    /** c: refunding, nothing to take back for this wallet; refunded = known from events */
    | {kind: "refunding"; refunded: boolean | undefined}
    /** d: waiting for settle; anyone may start refunds from `emergencyAt` */
    | {kind: "awaitSettle"; emergencyAt: bigint}
    /** e: the settle timeout passed: anyone may call emergencyRefund */
    | {kind: "canEmergencyRefund"};

export function afterDeadline(p: PhaseInput): AfterDeadline {
    if (p.settled) return {kind: "settled"};
    if (p.refunding) {
        if (p.myCommitted !== undefined && p.myCommitted > 0n) return {kind: "claim", amount: p.myCommitted};
        return {kind: "refunding", refunded: p.myRefunded};
    }
    if (p.chainTs < p.deadline) return {kind: "open"};
    const timeout = p.settleTimeout ?? OFFERING_CONSTS.SETTLE_TIMEOUT;
    if (p.refundMode === 0 && p.totalCommitted < p.raiseTarget) return {kind: "canStartRefund"};
    if (p.chainTs >= p.deadline + timeout) return {kind: "canEmergencyRefund"};
    return {kind: "awaitSettle", emergencyAt: p.deadline + timeout};
}
