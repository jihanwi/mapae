// W-T61 (v3.6): the launch options of the create form. The factory checks
//   startTime == 0 (now) or now + MIN_START_DELAY <= startTime <= now + MAX_START_DELAY,
// and a scheduled launch takes no Dev first buy. The bounds come from the factory (read on the page).
// The form asks for SUBMIT_MARGIN_SEC more than the minimum, so a transaction that lands a little
// late still passes the factory's check.

export type StartMode = "now" | "scheduled";

/** Quick picks for a scheduled start (seconds from now): 30 min, 1 h, 24 h. */
export const QUICK_DELAYS = [{key: "in30m", sec: 1800}, {key: "in1h", sec: 3600}, {key: "in24h", sec: 86_400}] as const;
export type QuickKey = (typeof QUICK_DELAYS)[number]["key"];

/** Extra time over MIN_START_DELAY required when submitting. */
export const SUBMIT_MARGIN_SEC = 120;

export type StartCheck = {ok: true} | {ok: false; reason: "pick" | "tooSoon" | "tooLate"};

/** A scheduled start chosen in the form, checked against the factory bounds at `nowSec`. */
export function checkStart(startSec: number | null, nowSec: number, minDelay: number, maxDelay: number): StartCheck {
    if (startSec === null || !Number.isFinite(startSec)) return {ok: false, reason: "pick"};
    if (startSec < nowSec + minDelay + SUBMIT_MARGIN_SEC) return {ok: false, reason: "tooSoon"};
    if (startSec > nowSec + maxDelay) return {ok: false, reason: "tooLate"};
    return {ok: true};
}

/** Whole minutes the earliest allowed pick lies ahead (shown in the "too soon" reason). */
export const earliestMinutes = (minDelay: number) => Math.ceil((minDelay + SUBMIT_MARGIN_SEC) / 60);

/** The createCurve arguments the options turn into: startTime (0 = now) and the Dev first buy,
 *  which is always 0 for a scheduled launch (the factory would revert it). */
export function launchArgs(mode: StartMode, startSec: number | null, devBuy: bigint, verifiedOnly: boolean) {
    const scheduled = mode === "scheduled" && startSec !== null;
    return {
        options: {startTime: scheduled ? BigInt(Math.floor(startSec)) : 0n, verifiedOnly},
        devBuy: mode === "scheduled" ? 0n : devBuy,
    };
}

/** `<input type="datetime-local">` value (local time, minutes) -> unix seconds; null when empty or invalid. */
export function parseLocalDateTime(v: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
    const ms = new Date(v).getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Unix seconds -> `<input type="datetime-local">` value in local time (minutes). */
export function toLocalInput(sec: number): string {
    const d = new Date(sec * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "UTC+9", "UTC-3:30", "UTC" for the viewer's offset at `sec`. */
export function utcOffsetLabel(sec: number): string {
    const off = -new Date(sec * 1000).getTimezoneOffset();
    if (off === 0) return "UTC";
    const sign = off > 0 ? "+" : "-";
    const a = Math.abs(off);
    const h = Math.floor(a / 60);
    const m = a % 60;
    return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** "11월 21일 오후 9:00" / "Nov 21, 9:00 PM" in the viewer's time zone. */
export function startLabel(sec: number | bigint, locale: string): string {
    return new Date(Number(sec) * 1000).toLocaleString(locale, {month: locale.startsWith("ko") ? "long" : "short", day: "numeric", hour: "numeric", minute: "2-digit"});
}
