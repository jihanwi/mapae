// "내 보유" rows for offerings the wallet took part in (W-T39), from chain values only. Pure.
export type CommitStatus =
    | {kind: "committed"; amount: bigint}
    | {kind: "awaitSettle"; amount: bigint}
    | {kind: "refund"; amount: bigint}
    | {kind: "claim"}
    | null;

export function commitStatus(p: {
    settled: boolean;
    refunding: boolean;
    deadlineSec: bigint;
    nowMs: number;
    committed: bigint | undefined;
    claimed: boolean | undefined;
    /** the allocation file lists this wallet (true), does not (false), could not be read (undefined) */
    allocated: boolean | undefined;
}): CommitStatus {
    if (p.committed === undefined || p.committed === 0n) return null;
    if (p.refunding) return {kind: "refund", amount: p.committed};
    if (p.settled) return p.claimed === false && p.allocated === true ? {kind: "claim"} : null;
    if (BigInt(Math.floor(p.nowMs / 1000)) < p.deadlineSec) return {kind: "committed", amount: p.committed};
    return {kind: "awaitSettle", amount: p.committed};
}
