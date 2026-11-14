import {Link} from "react-router-dom";
import {useCopy} from "../copy";
import {CurveInfo, useCurves} from "../hooks/curves";
import {progressBps} from "../lib/curveMath";
import {Badge, Card, CardSkeleton, Gauge, Medallion, NetError} from "../components/ui";

// Layout note (390px): the page uses fluid padding and a minmax(min(100%, 300px), 1fr) grid, so a
// card never asks for more width than the viewport; text blocks are min-w-0 + truncate.

export const quoteUnit = (c: Pick<CurveInfo, "isEth">) => (c.isEth ? "ETH" : "KRWs");

export function pctLabel(bps: bigint): string {
    const whole = bps / 100n;
    const frac = bps % 100n;
    return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0").replace(/0$/, "")}`;
}

function CurveCard({c}: {c: CurveInfo}) {
    const tr = useCopy();
    const bps = c.graduated ? 10_000n : progressBps(c.virtualQuote, c.r);
    return (
        <Link to={`/t/${c.address}`} className="block min-w-0 no-underline text-hanji-100">
            <Card className="h-full hover:border-brass-600">
                <div className="flex items-center gap-3.5 mb-4 min-w-0">
                    <Medallion char={c.symbol.slice(0, 1) || "馬"} />
                    <div className="min-w-0 flex-1">
                        <div className="text-[17px] font-bold truncate">{c.name}</div>
                        <div className="text-[13px] text-hanji-400 truncate">
                            {c.symbol} · {quoteUnit(c)}
                        </div>
                    </div>
                    <Badge kind={c.graduated ? "neutral" : "open"}>{c.graduated ? tr.curve.graduated : tr.curve.live}</Badge>
                </div>
                <div className="text-[13px] text-hanji-400 mb-3 tabular-nums">
                    {tr.curve.verifiedTraders(c.verifiedBuyerCount)}
                </div>
                <Gauge committed={bps} target={10_000n} />
                <div className="mt-2 text-[12px] text-hanji-400 tabular-nums">{tr.curve.progress(pctLabel(bps))}</div>
            </Card>
        </Link>
    );
}

export default function Curves() {
    const tr = useCopy();
    const {curves, isLoading, isError, refetch} = useCurves();
    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-12 pb-16 sm:pb-20">
            <h1 className="m-0 mb-2 text-[24px] sm:text-[28px] font-bold">{tr.curve.listTitle}</h1>
            <p className="m-0 mb-6 sm:mb-8 text-[14px] text-hanji-400">{tr.curve.listSub}</p>
            {isError ? (
                <NetError onRetry={refetch} />
            ) : isLoading ? (
                <div className="grid gap-5" style={{gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))"}}>
                    <CardSkeleton />
                    <CardSkeleton />
                </div>
            ) : curves.length === 0 ? (
                <p className="text-[14px] text-hanji-400">{tr.curve.empty}</p>
            ) : (
                <div className="grid gap-5" style={{gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))"}}>
                    {curves.map((c) => (
                        <CurveCard key={c.address} c={c} />
                    ))}
                </div>
            )}
        </div>
    );
}
