// What an offering allows after its deadline (W-T38), from chain values only. Refunds are never
// automatic in Offering.sol:
//   enableRefunds()   anyone; AllOrNothing, deadline passed, totalCommitted < raiseTarget, not settled / refunding
//   emergencyRefund() anyone; deadline + SETTLE_TIMEOUT passed, not settled / refunding (any mode)
//   refund()          refunding; pays committed[msg.sender] in full
// Times are chain block times (seconds). SETTLE_TIMEOUT comes from codegen (Offering.sol).
//   v3.4-L1: enableRefunds() also passes with totalCommitted == 0 in either mode (zero-commit close)
import {OFFERING_CONSTS} from "../contracts/offeringBoundsL1";
import {L1_FACTORIES} from "../contracts/addressesV3L1";

const versionNum = (v: string) => {
    const m = /^v(\d+)\.(\d+)-L1$/.exec(v);
    return m ? Number(m[1]) * 1000 + Number(m[2]) : 0;
};
/** v3.4-L1 and later: an offering with no commitment can be closed (enableRefunds) after its deadline
 *  in either refund mode. Decided by the offering's factory (from /api/chain/offerings or the
 *  allOfferings read); an unknown factory is treated as an older one (no zero-commit close). */
export function allowsZeroCommitClose(factory: string | undefined, factories: readonly {version: string; mapaeFactory: string}[] = L1_FACTORIES): boolean {
    if (!factory) return false;
    const f = factories.find((x) => x.mapaeFactory.toLowerCase() === factory.toLowerCase());
    return !!f && versionNum(f.version) >= versionNum("v3.4-L1");
}

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
    /** v3.4-L1 factory (allowsZeroCommitClose): a zero-commit offering may be closed after the deadline */
    zeroCommitClose?: boolean;
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
    | {kind: "canEmergencyRefund"}
    /** v3.4-L1: no commitment at all, deadline passed: anyone may close it (enableRefunds) */
    | {kind: "canClose"}
    /** refunding with no commitment ever made: closed, nothing to take back */
    | {kind: "closedEmpty"};

export function afterDeadline(p: PhaseInput): AfterDeadline {
    if (p.settled) return {kind: "settled"};
    if (p.refunding) {
        if (p.totalCommitted === 0n) return {kind: "closedEmpty"};
        if (p.myCommitted !== undefined && p.myCommitted > 0n) return {kind: "claim", amount: p.myCommitted};
        return {kind: "refunding", refunded: p.myRefunded};
    }
    if (p.chainTs < p.deadline) return {kind: "open"};
    const timeout = p.settleTimeout ?? OFFERING_CONSTS.SETTLE_TIMEOUT;
    if (p.zeroCommitClose && p.totalCommitted === 0n) return {kind: "canClose"};
    if (p.refundMode === 0 && p.totalCommitted < p.raiseTarget) return {kind: "canStartRefund"};
    if (p.chainTs >= p.deadline + timeout) return {kind: "canEmergencyRefund"};
    return {kind: "awaitSettle", emergencyAt: p.deadline + timeout};
}

/** W-T47 (decision 61): an offering in refunds. Its totalCommitted is a record that refunds do not
 *  lower, so screens label it "at close". From the values already read (refunding flag, phase 4 =
 *  Refunding); no extra chain read. */
export function isRefundState(o: {refunding: boolean; phase?: number}): boolean {
    return o.refunding || o.phase === 4;
}
