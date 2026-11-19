// W-T61 (v3.6): what the token page and the lists show for a scheduled or verified-only curve.
// A curve's priority window counts from its startTime, so inPriorityWindow() (block.timestamp <
// priorityUntil) is already true before the start: every view checks "started" first.
import {priorityRemaining} from "./priority";

export type TradeView =
    | {kind: "graduated"}
    /** before startTime: no buy, no sell (the panel shows the countdown) */
    | {kind: "preStart"}
    /** verified-only curve, a wallet known to be unverified: buying is blocked until graduation */
    | {kind: "verifiedOnlyBlocked"}
    /** started, inside the real-name window */
    | {kind: "priority"}
    | {kind: "open"};

export type TradeViewInput = {
    graduated: boolean;
    /** CurveSale.started() from the chain on the token page; the local clock in lists */
    started: boolean;
    priorityUntil: bigint;
    nowSec: number;
    verifiedOnly: boolean;
    /** the connected wallet's real-name status; undefined without a wallet or before the read */
    verified: boolean | undefined;
};

export function tradeView(p: TradeViewInput): TradeView {
    if (p.graduated) return {kind: "graduated"};
    if (!p.started) return {kind: "preStart"};
    if (p.verifiedOnly && p.verified === false) return {kind: "verifiedOnlyBlocked"};
    return priorityRemaining(p.priorityUntil, p.nowSec) > 0 ? {kind: "priority"} : {kind: "open"};
}

/** Lists (no chain read of started()): a curve whose start is still ahead on the device clock. */
export const isUpcoming = (c: {graduated: boolean; startTime: bigint}, nowSec: number) => !c.graduated && Number(c.startTime) > Math.floor(nowSec);

/** Seconds until the start, never negative. */
export const startsIn = (startTime: bigint, nowSec: number) => Math.max(0, Number(startTime) - Math.floor(nowSec));

/** Over a day away the start is shown as a date, otherwise as an HH:MM:SS countdown. */
export const COUNTDOWN_MAX_SEC = 86_400;

/** The first line of the priority-window notice: a verified-only curve keeps the real-name rule
 *  after the window, so it states that rule instead of "anyone can buy after {t}". The second line
 *  (the holding cap) and the "실명 우선 {t}" badge stay: the cap still ends with the window. */
export type PriorityNotice = "verifiedOnly" | "window";
export const priorityNotice = (verifiedOnly: boolean): PriorityNotice => (verifiedOnly ? "verifiedOnly" : "window");

/** The real-name window of one curve in seconds (priorityUntil - startTime, both from the chain). */
export const windowSec = (c: {priorityUntil: bigint; startTime: bigint}) => Number(c.priorityUntil - c.startTime);
