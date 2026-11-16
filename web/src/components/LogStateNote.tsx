// W-T32: honest states of an event-log list (trade history, sponsor feed, redeem catalog). A failed
// read says so with a retry, a partial read names the range it covers, and only a read that reached
// the deployment block may say there is nothing yet.
import {useCopy} from "../copy";
import {LogState, ScanWindow} from "../lib/logRange";

/** GIWA blocks are ~1 s apart: hours covered by a partial window (at least 1). */
export function windowHours(w: {fromBlock: bigint; toBlock: bigint} | undefined): string {
    if (!w) return "0";
    return String(Math.max(1, Math.round(Number(w.toBlock - w.fromBlock + 1n) / 3600)));
}

export function LogStateNote({scan, count, recent, none}: {
    scan: {state: LogState; window: ScanWindow | undefined; refetch: () => void};
    /** rows shown from scan.logs */
    count: number;
    /** empty partial read, e.g. "최근 약 N시간 안에는 거래가 없어요" */
    recent: (hours: string) => string;
    /** empty complete read, e.g. "아직 거래가 없어요" */
    none: string;
}) {
    const copy = useCopy();
    if (scan.state === "loading") return null;
    if (scan.state === "error") {
        return (
            <div className="flex items-center gap-3 flex-wrap text-[13px] text-hanji-400 mb-2">
                <span>{copy.logs.failed}</span>
                <button onClick={scan.refetch} className="min-h-[44px] px-3 border border-ink-700 rounded-full text-hanji-100 hover:border-brass-600">
                    {copy.common.retry}
                </button>
            </div>
        );
    }
    const hours = windowHours(scan.window);
    if (count === 0) return <p className="text-[13px] text-hanji-400">{scan.state === "complete" ? none : recent(hours)}</p>;
    if (scan.state === "partial") return <p className="text-[12px] text-hanji-400 mb-2">{copy.logs.partialNote(hours)}</p>;
    return null;
}
