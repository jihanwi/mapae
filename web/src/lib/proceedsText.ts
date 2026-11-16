// Text helpers for the offering section (W-T32): lock lengths and bps shares as Korean copy.
import {copy} from "../copy";
import {spanParts} from "./proceeds";

/** "N일" / "N시간" from seconds (days by default, hours under a day). */
export function spanText(seconds: bigint | number): string {
    const p = spanParts(seconds);
    return p.unit === "day" ? copy.offering.days(p.n.toLocaleString("ko-KR")) : copy.offering.hours(String(p.n));
}

/** bps as a percent string: 3000 → "30", 2550 → "25.5", 15 → "0.15". */
export function bpsPct(bps: number | bigint): string {
    return String(Math.round(Number(bps)) / 100);
}
