// W-T61 (v3.6): badges and the pre-start trade panel of scheduled and verified-only curves.
// "started" is passed in: the chain's CurveSale.started() on the token page, the device clock in
// lists. The priority window counts from the start, so PriorityBadge only shows once started.
import {useEffect, useState} from "react";
import {useCopy} from "../copy";
import {capPct} from "../copy/ko";
import {daysHours, dayScale, listStartKey, nextTickMs, startsIn, windowSec} from "../lib/launchState";
import {startLabel} from "../lib/launchOptions";
import {hms} from "../lib/offeringStrip";
import {PriorityBadge} from "./PriorityCountdown";
import {Badge} from "./ui";

type LaunchCurve = {graduated: boolean; startTime: bigint; priorityUntil: bigint; verifiedOnly: boolean};

/** Seconds until `startTime` while the start is ahead: redrawn every second below a day, once a
 *  minute above it, and exactly when it crosses below 24 h (W-T62, nextTickMs). */
function useStartsIn(startTime: bigint): number {
    const [left, setLeft] = useState(() => startsIn(startTime, Date.now() / 1000));
    useEffect(() => {
        let id: ReturnType<typeof setTimeout>;
        const tick = () => {
            const l = startsIn(startTime, Date.now() / 1000);
            setLeft(l);
            if (l > 0) id = setTimeout(tick, nextTickMs(l));
        };
        tick();
        return () => clearTimeout(id);
    }, [startTime]);
    return left;
}

/** "거래 시작까지 01:23:45", or "11월 21일 오후 9:00 시작" a day or more ahead; "곧 거래가 열려요"
 *  once the clock passed the start but the chain has not opened yet. Lists (compact): "곧 시작 ·
 *  01:23:45" below a day, "예정 · 11월 26일 오후 8:19" from a day on (W-T62). */
export function StartBadge({startTime, compact = false}: {startTime: bigint; compact?: boolean}) {
    const tr = useCopy();
    const left = useStartsIn(startTime);
    const far = dayScale(left);
    const when = far ? startLabel(startTime, tr.locale) : hms(left);
    if (compact && left > 0) {
        // two unbreakable pieces, so a narrow row breaks between them, never inside the date
        return (
            <Badge kind="frozen" wrap>
                <span className="num inline-flex flex-wrap gap-x-1 min-w-0">
                    <span className="whitespace-nowrap">{tr.launch[listStartKey(left)]} ·</span>
                    <span className="whitespace-nowrap">{when}</span>
                </span>
            </Badge>
        );
    }
    const text = left <= 0 ? tr.launch.opening : far ? tr.launch.opensAt(when) : tr.launch.opensIn(when);
    return (
        <Badge kind="frozen">
            <span className="num">{text}</span>
        </Badge>
    );
}

export function VerifiedOnlyBadge({graduated}: {graduated: boolean}) {
    const tr = useCopy();
    return <Badge kind="neutral">{graduated ? tr.launch.verifiedOnlyGraduated : tr.launch.verifiedOnly}</Badge>;
}

/** The status badges of a curve before graduation: start countdown or the priority countdown, and
 *  the verified-only mark (also after graduation, as "graduated as verified only"). */
export function LaunchBadges({c, started, compact = false}: {c: LaunchCurve; started: boolean; compact?: boolean}) {
    return (
        <>
            {!c.graduated && (started ? <PriorityBadge priorityUntil={c.priorityUntil} /> : <StartBadge startTime={c.startTime} compact={compact} />)}
            {c.verifiedOnly && <VerifiedOnlyBadge graduated={c.graduated} />}
        </>
    );
}

/** The trade panel before the start: a big countdown, the start time, and the two rules, with the
 *  window length and the holding cap read from the curve (priorityUntil - startTime,
 *  priorityMaxHolding). It gives way to the trade form when the chain reports started(). */
export function PreStartPanel({c}: {c: LaunchCurve & {priorityMaxHolding: bigint}}) {
    const tr = useCopy();
    const left = useStartsIn(c.startTime);
    const min = Math.round(windowSec(c) / 60);
    return (
        <div className="text-center py-2" role="status">
            <div className="text-[13px] text-hanji-400">{tr.launch.panelTitle}</div>
            {/* W-T62: "6일 22시간" a day or more ahead, HH:MM:SS below */}
            <div className="num mt-2 text-[40px] leading-none font-medium text-hanji-100">
                {left <= 0 ? "00:00:00" : dayScale(left) ? tr.launch.daysHours(daysHours(left).d, daysHours(left).h) : hms(left)}
            </div>
            {left <= 0 && <div className="mt-2 text-[13px] text-brass-400">{tr.launch.opening}</div>}
            <div className="num mt-3 text-[14px] text-hanji-100">{tr.launch.opensAt(startLabel(c.startTime, tr.locale))}</div>
            <ul className="m-0 mt-5 p-0 list-none text-left flex flex-col gap-2 text-[13px] text-hanji-100 border-t border-ink-700 pt-4">
                <li>{tr.launch.rulePriority(min)}</li>
                <li>{tr.launch.ruleCap(min, capPct(c.priorityMaxHolding))}</li>
            </ul>
        </div>
    );
}
