// v3.1 priority window countdowns. Each one ticks every second only while it is on screen and
// the window is open; it renders nothing once the window is over.
import {useCopy} from "../copy";
import {useSecondClock} from "../hooks/curves";
import {fmtMmSs, priorityRemaining} from "../lib/priority";
import {Badge} from "./ui";

function useRemaining(priorityUntil: bigint): number {
    const open = priorityRemaining(priorityUntil, Date.now() / 1000) > 0;
    return priorityRemaining(priorityUntil, useSecondClock(open));
}

/** "실명 우선 mm:ss" badge for curve cards. */
export function PriorityBadge({priorityUntil}: {priorityUntil: bigint}) {
    const tr = useCopy();
    const left = useRemaining(priorityUntil);
    if (left <= 0) return null;
    return (
        <Badge kind="frozen">
            <span className="tabular-nums">{tr.priority.badge(fmtMmSs(left))}</span>
        </Badge>
    );
}

/** One-line notice above the trade panel while the window is open. */
export function PriorityBanner({priorityUntil}: {priorityUntil: bigint}) {
    const tr = useCopy();
    const left = useRemaining(priorityUntil);
    if (left <= 0) return null;
    return (
        <div
            className="rounded-input px-4 py-3 text-[13px] text-brass-400 tabular-nums"
            style={{background: "rgba(195,154,59,.08)", border: "1px solid rgba(195,154,59,.3)"}}
        >
            {tr.priority.banner(fmtMmSs(left))}
        </div>
    );
}
