// W-T63: the offering list's two sections and the commit panel's quick amounts. Pure helpers.
import {isRefundState} from "./offeringPhase";

export type ListOffering = {settled: boolean; refunding: boolean; phase?: number; deadline: bigint};

/** Open for commits now: not settled, not in refunds, deadline still ahead (the frozen last two
 *  hours included). The same test the list card and the detail page use for "live". */
export const isOpenNow = (o: ListOffering, nowMs: number) => !o.settled && !isRefundState(o) && Number(o.deadline) * 1000 > nowMs;

const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/** "OPEN NOW" (nearest deadline first) and "SETTLED AND CLOSED" (everything else: settled, in
 *  refunds, past the deadline awaiting settle; latest deadline first). */
export function offeringSections<T extends ListOffering>(offerings: readonly T[], nowMs: number): {open: T[]; closed: T[]} {
    const open = offerings.filter((o) => isOpenNow(o, nowMs)).sort((a, b) => cmp(a.deadline, b.deadline));
    const closed = offerings.filter((o) => !isOpenNow(o, nowMs)).sort((a, b) => cmp(b.deadline, a.deadline));
    return {open, closed};
}

/** The commit panel's "Min" and "Up to limit" amounts from values already read. `null` hides or
 *  disables the button. Up to limit = walletLimit - committed (none when nothing is left or there
 *  is no limit); Min = minCommit, only when it still fits under the limit. */
export function quickCommits(minCommit: bigint, walletLimit: bigint, myCommitted: bigint): {min: bigint | null; upTo: bigint | null} {
    const left = walletLimit > 0n ? (walletLimit > myCommitted ? walletLimit - myCommitted : 0n) : null;
    const min = minCommit > 0n && (left === null || minCommit <= left) ? minCommit : null;
    const upTo = left !== null && left > 0n ? left : null;
    return {min, upTo};
}
