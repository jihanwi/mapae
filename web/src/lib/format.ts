import {formatUnits, getAddress} from "viem";

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

/** W-T46: one spelling per wallet in lists that mix chain logs and indexer rows (checksummed, then
 *  shortened). A value that is not an address is only shortened. */
export function displayAddr(a: string): string {
    try {
        return shortAddr(getAddress(a));
    } catch {
        return shortAddr(a);
    }
}

/** Max fraction digits of an amount input: every quote asset and token here has 18 decimals. */
export const AMOUNT_DECIMALS = 18;

/** 금액 입력 살균: NFKC로 전각 숫자·마침표를 반각으로 바꾼 뒤 쉼표·기타문자 제거, 소수점 1개만 허용,
 *  소수는 18자리까지. 표시값 = 전송값 (9-c) */
export function sanitizeAmountInput(raw: string): string {
    let s = raw.normalize("NFKC").replace(/[^0-9.]/g, ""); // 숫자와 점만 (쉼표·부호·e·문자 제거)
    const firstDot = s.indexOf(".");
    if (firstDot !== -1) {
        const frac = s.slice(firstDot + 1).replace(/\./g, "").slice(0, AMOUNT_DECIMALS);
        s = s.slice(0, firstDot + 1) + frac;
    }
    return s;
}

export function countdown(deadline: bigint, now: number, closedLabel = "마감"): string {
    const left = Number(deadline) - Math.floor(now / 1000);
    if (left <= 0) return closedLabel;
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

// ---------------------------------------------------------------------------------------------
// Chart axis labels (STATUS 결정 48): market cap by default, price on request
// ---------------------------------------------------------------------------------------------

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";
const sub = (n: number) => [...String(n)].map((d) => SUBSCRIPT[Number(d)]).join("");

/** A number in short form: below 1000 of the chosen unit 3 significant digits, otherwise a whole
 *  number with grouping. */
function compact(v: number, units: readonly [number, string][], locale: string): string {
    for (const [size, suffix] of units) {
        if (v >= size) {
            const n = v / size;
            const s = n >= 1000 ? n.toLocaleString(locale, {maximumFractionDigits: 0}) : n.toLocaleString(locale, {maximumSignificantDigits: 3});
            return `${s}${suffix}`;
        }
    }
    return v >= 1000 ? v.toLocaleString(locale, {maximumFractionDigits: 0}) : v.toLocaleString(locale, {maximumSignificantDigits: 3});
}

/** Market cap axis label. KRWs: ko in 만 / 억 ("199만", "3,004만", "1.2억"), other locales K / M / B
 *  ("1.99M"). ETH / WETH: 4 significant digits ("0.002058"). */
export function fmtAxisMcap(wei: bigint, unit: string, locale: string): string {
    if (unit !== "KRWs") return fmtSig(wei, 4, locale);
    const v = Number(wei) / 1e18;
    return locale.startsWith("ko")
        ? compact(v, [[1e8, "억"], [1e4, "만"]], locale)
        : compact(v, [[1e9, "B"], [1e6, "M"], [1e3, "K"]], locale);
}

/** Price axis label: 4 significant digits; with 4 or more zeros after the decimal point the zeros
 *  are written as a subscript count ("0.0₁₁1921" for 0.000000000001921). */
export function fmtAxisPrice(wei: bigint, locale: string): string {
    const s = fmtSig(wei, 4, locale);
    const m = /^0[.,](0+)(\d+)$/.exec(s);
    if (!m || m[1].length < 4) return s;
    const dot = s[1];
    return `0${dot}0${sub(m[1].length)}${m[2]}`;
}

/** W-T41: date and time in the UI locale (en-US or ko-KR). `withYear` adds the year. */
export function fmtWhen(ms: number, locale: string, withYear = false): string {
    return new Date(ms).toLocaleString(locale, {...(withYear ? {year: "numeric" as const} : {}), month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"});
}

/** W-T41: a whole number with the locale's grouping (comma in both en-US and ko-KR). */
export function fmtCount(n: number | bigint, locale: string): string {
    return n.toLocaleString(locale);
}
