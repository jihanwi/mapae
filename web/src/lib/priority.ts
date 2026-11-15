// v3.1 real-name priority window, counted on the device clock (the chain is the final judge:
// a buy the device thinks is open can still revert NotVerified, which the trade panel handles).

/** Seconds left until `priorityUntil` (unix seconds); 0 at or after it, never negative. */
export function priorityRemaining(priorityUntil: bigint | number, nowSec: number): number {
    const left = Number(priorityUntil) - Math.floor(nowSec);
    return left > 0 ? left : 0;
}

export const inPriorityWindow = (priorityUntil: bigint | number, nowSec: number) => priorityRemaining(priorityUntil, nowSec) > 0;

/** "mm:ss" (minutes not capped at 59: 61:05 for over an hour). */
export function fmtMmSs(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Split seconds into whole minutes and the remaining seconds. */
export const minSec = (sec: number) => ({m: Math.floor(Math.max(0, sec) / 60), s: Math.max(0, Math.floor(sec)) % 60});
