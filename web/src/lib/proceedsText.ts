// Text helpers for the offering section (W-T32): lock lengths and bps shares. W-T41: the dictionary is
// an argument (the screen passes useCopy()); Korean when omitted.
import {ko, type Copy} from "../copy/ko";
import {spanParts} from "./proceeds";

/** "N일" / "N days" from seconds (days by default, hours under a day). */
export function spanText(seconds: bigint | number, tr: Copy = ko): string {
    const p = spanParts(seconds);
    return p.unit === "day" ? tr.offering.days(p.n.toLocaleString(tr.locale)) : tr.offering.hours(String(p.n));
}

/** bps as a percent string: 3000 → "30", 2550 → "25.5", 15 → "0.15". */
export function bpsPct(bps: number | bigint): string {
    return String(Math.round(Number(bps)) / 100);
}
