// Issuer proceeds schedule (W-T32, decision 56). ProceedsLock is OZ VestingWalletCliff: nothing is
// released before cliff (= start + cliffSeconds), then the vested part grows linearly from start to
// start + duration, and everything is vested after that. start is the offering deadline; the
// proceeds arrive at settle, which may be later than the deadline, so part of them can already be
// released at settle. Amounts are chain values only (the lock's balance and released(token)).

export type LockTerms = {
    /** unix seconds (VestingWallet.start()) */
    start: bigint;
    /** seconds (VestingWallet.duration()) */
    duration: bigint;
    /** unix seconds (VestingWalletCliff.cliff(), absolute) */
    cliff: bigint;
};

export type SchedulePhase = "beforeCliff" | "vesting" | "done";

/** Vested amount at `now` for a total allocation (same formula as OZ _vestingSchedule). */
export function vestedAt(t: LockTerms, total: bigint, now: bigint): bigint {
    if (now < t.cliff) return 0n;
    if (now >= t.start + t.duration) return total;
    if (now <= t.start || t.duration === 0n) return 0n;
    return (total * (now - t.start)) / t.duration;
}

export type ProceedsStatus = {
    phase: SchedulePhase;
    /** everything ever put in the lock (balance + released) */
    total: bigint;
    /** already sent to the issuer */
    released: bigint;
    /** can be released now */
    releasable: bigint;
    /** released + releasable */
    unlocked: bigint;
    /** still locked */
    remaining: bigint;
    /** unlocked share of total, in bps (0 when total is 0) */
    unlockedBps: number;
    /** the next point where the schedule changes: the cliff before it, the end while vesting, none after */
    nextAt: bigint | undefined;
    endAt: bigint;
};

/** Schedule state from the lock's terms and its chain amounts at `now`. `releasable` is the lock's own
 *  releasable(token) when read (the screen shows chain values); without it the same formula is used. */
export function proceedsStatus(t: LockTerms, amounts: {balance: bigint; released: bigint; releasable?: bigint}, now: bigint): ProceedsStatus {
    const total = amounts.balance + amounts.released;
    const endAt = t.start + t.duration;
    const vested = vestedAt(t, total, now);
    const computed = vested > amounts.released ? vested - amounts.released : 0n;
    const releasable = amounts.releasable ?? computed;
    const unlocked = amounts.released + releasable;
    const phase: SchedulePhase = now < t.cliff ? "beforeCliff" : now >= endAt ? "done" : "vesting";
    return {
        phase,
        total,
        released: amounts.released,
        releasable,
        unlocked,
        remaining: total - unlocked,
        unlockedBps: total > 0n ? Number((unlocked * 10_000n) / total) : 0,
        nextAt: phase === "beforeCliff" ? t.cliff : phase === "vesting" ? endAt : undefined,
        endAt,
    };
}

/** Lock length in whole days, or whole hours under a day (never "0"). */
export function spanParts(seconds: bigint | number): {n: number; unit: "day" | "hour"} {
    const s = Number(seconds);
    if (s >= 86_400) return {n: Math.max(1, Math.round(s / 86_400)), unit: "day"};
    return {n: Math.max(1, Math.ceil(s / 3_600)), unit: "hour"};
}
