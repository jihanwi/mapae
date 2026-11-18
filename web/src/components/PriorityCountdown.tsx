// v3.1 priority window countdowns. Each one ticks every second only while it is on screen and
// the window is open; it renders nothing once the window is over.
import {useCopy} from "../copy";
import {useSecondClock} from "../hooks/curves";
import {fmtMmSs, priorityRemaining} from "../lib/priority";
import {Badge} from "./ui";
import {ADDR_V3} from "../contracts/addressesV3";

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

/** Notice above the trade panel while the window is open: the real-name rule and (v3.5, W-T54) the
 *  holding cap, `capTokens` read from the curve (the deployment default until it loads). */
export function PriorityBanner({priorityUntil, capTokens}: {priorityUntil: bigint; capTokens?: bigint}) {
    const tr = useCopy();
    const left = useRemaining(priorityUntil);
    if (left <= 0) return null;
    return (
        <div
            className="rounded-input px-4 py-3 text-[13px] text-brass-400 tabular-nums"
            style={{background: "rgba(195,154,59,.08)", border: "1px solid rgba(195,154,59,.3)"}}
        >
            <div>{tr.priority.banner(fmtMmSs(left))}</div>
            <div className="mt-1 text-hanji-400">{tr.tokenPage.priorityCapNote(capTokens ?? ADDR_V3.priorityMaxHoldingTokens)}</div>
        </div>
    );
}
