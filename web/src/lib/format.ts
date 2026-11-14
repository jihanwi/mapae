import {formatUnits} from "viem";

/** 18-decimals → "1,234,567" (소수점은 유효할 때만, 최대 dp자리). locale: BCP 47 (v3 passes the UI language). */
export function fmt(wei: bigint, dp = 2, locale = "en-US"): string {
    const s = formatUnits(wei, 18);
    const [i, f] = s.split(".");
    const int = BigInt(i).toLocaleString(locale);
    if (!f || dp === 0) return int;
    const frac = f.slice(0, dp).replace(/0+$/, "");
    return frac ? `${int}.${frac}` : int;
}

/** Like fmt, but rounds up at `dp`. For amounts the user pays (charged amount, fees, cost to
 *  graduate / sell out, KRWs needed), so entering the shown amount is never 1 unit short.
 *  A value that is exact at `dp` stays unchanged. */
export function fmtCeil(wei: bigint, dp = 2, locale = "en-US"): string {
    if (dp >= 18) return fmt(wei, 18, locale);
    const step = 10n ** BigInt(18 - dp);
    const up = ((wei + step - 1n) / step) * step;
    return fmt(up, dp, locale);
}

/** Like fmt, but rounds half-up at `dp` instead of truncating. Display only for prices and market
 *  cap; amounts the user pays, receives or holds keep fmt (floor) so they never look larger. */
export function fmtRound(wei: bigint, dp = 2, locale = "en-US"): string {
    if (dp >= 18) return fmt(wei, 18, locale);
    const step = 10n ** BigInt(18 - dp);
    const rounded = ((wei + step / 2n) / step) * step;
    return fmt(rounded, dp, locale);
}

/** 18-decimals → up to `sig` significant digits, rounded half-up (for tiny curve prices such as
 *  0.000000000562 ETH). Prices only; see fmtRound. */
export function fmtSig(wei: bigint, sig = 4, locale = "en-US"): string {
    if (wei === 0n) return "0";
    const s = formatUnits(wei, 18);
    const [i, f = ""] = s.split(".");
    if (i !== "0") return fmtRound(wei, Math.max(0, sig - i.length), locale);
    const lead = f.length - f.replace(/^0+/, "").length;
    return fmtRound(wei, Math.min(18, lead + sig), locale);
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** 금액 입력 살균 — 쉼표·기타문자 제거, 소수점 1개만 허용. 표시값 = 전송값 (9-c) */
export function sanitizeAmountInput(raw: string): string {
    let s = raw.replace(/[^0-9.]/g, ""); // 숫자와 점만 (쉼표·부호·e·문자 제거)
    const firstDot = s.indexOf(".");
    if (firstDot !== -1) {
        s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    }
    return s;
}

export function countdown(deadline: bigint, now: number): string {
    const left = Number(deadline) - Math.floor(now / 1000);
    if (left <= 0) return "마감";
    const d = Math.floor(left / 86400);
    const p = (n: number) => String(n).padStart(2, "0");
    const hms = `${p(Math.floor(left / 3600) % 24)}:${p(Math.floor(left / 60) % 60)}:${p(left % 60)}`;
    return `D-${d} ${hms}`;
}

/** Date/time in the UI locale (e.g. the next allowed curve creation time). */
export function fmtDateTime(unixSeconds: bigint | number, locale: string): string {
    return new Date(Number(unixSeconds) * 1000).toLocaleString(locale);
}

/** Elapsed time bucket for "3 min ago" style labels (the copy layer renders it). */
export type Ago = {unit: "now" | "min" | "hour" | "day"; n: number};
export function agoOf(nowSec: number, tsSec: number): Ago {
    const d = Math.max(0, nowSec - tsSec);
    if (d < 60) return {unit: "now", n: 0};
    if (d < 3600) return {unit: "min", n: Math.floor(d / 60)};
    if (d < 86400) return {unit: "hour", n: Math.floor(d / 3600)};
    return {unit: "day", n: Math.floor(d / 86400)};
}
