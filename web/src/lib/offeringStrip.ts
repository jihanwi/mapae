// design-home: which fixed-price offerings the home strip shows (at most STRIP_MAX).
//   1. committing: not settled, not in refunds, deadline still ahead; nearest deadline first
//   2. trading (settled; a settled offering has its pool): most recently settled first
// Offerings in refunds are never shown, nor ones past the deadline that are not settled yet.
import {isRefundState} from "./offeringPhase";

export const STRIP_MAX = 3;

export type StripOffering = {
    address: string;
    settled: boolean;
    refunding: boolean;
    phase?: number;
    /** unix seconds */
    deadline: bigint;
};

export type StripPick<T> = {o: T; kind: "committing" | "trading"};

/** `settledBlockOf` gives the Settled block from the offering index (undefined when unknown);
 *  unknown ones go after the known ones, then by the later deadline. */
export function pickStrip<T extends StripOffering>(offerings: readonly T[], nowSec: number, settledBlockOf: (o: T) => bigint | undefined, max = STRIP_MAX): StripPick<T>[] {
    const now = BigInt(Math.floor(nowSec));
    const usable = offerings.filter((o) => !isRefundState(o));
    const committing = usable.filter((o) => !o.settled && o.deadline > now).sort((a, b) => cmp(a.deadline, b.deadline));
    const trading = usable
        .filter((o) => o.settled)
        .map((o) => ({o, b: settledBlockOf(o)}))
        .sort((x, y) => {
            if (x.b !== undefined && y.b !== undefined && x.b !== y.b) return cmp(y.b, x.b);
            if ((x.b === undefined) !== (y.b === undefined)) return x.b === undefined ? 1 : -1;
            return cmp(y.o.deadline, x.o.deadline);
        })
        .map((x) => x.o);
    return [...committing.map((o) => ({o, kind: "committing" as const})), ...trading.map((o) => ({o, kind: "trading" as const}))].slice(0, max);
}

const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/** Seconds left as HH:MM:SS (hours may pass 24). */
export function hms(secondsLeft: number): string {
    const s = Math.max(0, Math.floor(secondsLeft));
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}
