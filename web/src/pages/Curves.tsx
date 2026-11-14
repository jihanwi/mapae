import {useEffect, useRef, useState} from "react";
import {Link} from "react-router-dom";
import {useCopy} from "../copy";
import {CurveInfo, useCurves} from "../hooks/curves";
import {useActivity} from "../hooks/activity";
import {CurveStats, marketCap, sortCurves, Tab, TABS} from "../lib/activity";
import {progressBps} from "../lib/curveMath";
import {fmtRound, shortAddr} from "../lib/format";
import {agoLabel, prefersReducedMotion, tradeAmount, tradeUnit, useNow} from "../components/feed";
import {Badge, Card, CardSkeleton, Gauge, NetError} from "../components/ui";
import {CurveAvatar} from "../components/MetaForm";
import {useCurveMeta} from "../hooks/meta";

// Layout note (390px): the page uses fluid padding and a minmax(min(100%, 300px), 1fr) grid, so a
// card never asks for more width than the viewport; text blocks are min-w-0 + truncate. The six
// sort tabs scroll sideways inside their own strip (overflow-x-auto), never the page.

export const quoteUnit = (c: Pick<CurveInfo, "isEth">) => (c.isEth ? "ETH" : "KRWs");

export function pctLabel(bps: bigint): string {
    const whole = bps / 100n;
    const frac = bps % 100n;
    return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0").replace(/0$/, "")}`;
}

const FLASH_MS = 600;

/** True for FLASH_MS after `value` grows (not on first sight). Skipped with reduced motion. */
function useFlashOnIncrease(value: bigint | undefined): boolean {
    const prev = useRef<bigint | undefined>(value);
    const [on, setOn] = useState(false);
    useEffect(() => {
        const p = prev.current;
        prev.current = value;
        if (p === undefined || value === undefined || value <= p || prefersReducedMotion()) return;
        setOn(true);
        const id = setTimeout(() => setOn(false), FLASH_MS);
        return () => clearTimeout(id);
    }, [value]);
    return on;
}

function CurveCard({c, stats, tsOf, now, imageUrl}: {c: CurveInfo; stats: CurveStats | undefined; tsOf: (b: bigint) => number | undefined; now: number; imageUrl?: string | null}) {
    const tr = useCopy();
    const unit = quoteUnit(c);
    const bps = c.graduated ? 10_000n : progressBps(c.virtualQuote, c.r);
    const mcap = marketCap(c, c.poolSpot);
    const flash = useFlashOnIncrease(stats?.lastTradeBlock);
    const lastTs = stats ? tsOf(stats.lastTradeBlock) : undefined;
    return (
        <Link to={`/t/${c.address}`} className="block min-w-0 no-underline text-hanji-100">
            <Card className={`h-full hover:border-brass-600 transition-colors duration-300 ${flash ? "!border-brass-400" : ""}`}>
                <div className="flex items-center gap-3.5 mb-4 min-w-0">
                    <CurveAvatar char={c.symbol.slice(0, 1) || "馬"} imageUrl={imageUrl} />
                    <div className="min-w-0 flex-1">
                        <div className="text-[17px] font-bold truncate">{c.name}</div>
                        <div className="text-[13px] text-hanji-400 truncate">
                            {c.symbol} · {unit}
                        </div>
                    </div>
                    <Badge kind={c.graduated ? "neutral" : "open"}>{c.graduated ? tr.curve.graduated : tr.curve.live}</Badge>
                </div>
                <div className="flex justify-between gap-3 text-[13px] mb-3 tabular-nums flex-wrap">
                    <span className="text-hanji-400">{tr.curve.marketCap}</span>
                    <span className="text-hanji-100 font-semibold">{mcap !== undefined ? `${fmtRound(mcap, c.isEth ? 4 : 0, tr.locale)} ${unit}` : "…"}</span>
                </div>
                <div className="text-[13px] text-hanji-400 mb-3 tabular-nums">{tr.curve.verifiedTraders(c.verifiedBuyerCount)}</div>
                <Gauge committed={bps} target={10_000n} />
                <div className="mt-2 text-[12px] text-hanji-400 tabular-nums">{tr.curve.progress(pctLabel(bps))}</div>
                {stats && (
                    <div className="mt-3 pt-3 border-t border-ink-700 text-[12px] text-hanji-400 tabular-nums flex flex-col gap-1 min-w-0">
                        {lastTs !== undefined && <span>{tr.feed.lastTrade(agoLabel(tr, now, lastTs))}</span>}
                        <span className="truncate">
                            {tr.feed.recentLine(stats.uniqueTraders, fmtRound(stats.volumeQuote, c.isEth ? 4 : 0, tr.locale), unit)}
                        </span>
                    </div>
                )}
            </Card>
        </Link>
    );
}

/** Latest 8 trades above the list. Not rendered at all when there is none. */
function LiveStrip({curves, now}: {curves: CurveInfo[]; now: number}) {
    const tr = useCopy();
    const {trades, tsOf} = useActivity();
    const byAddr = new Map(curves.map((c) => [c.address, c]));
    const rows = trades.filter((t) => byAddr.has(t.curve)).slice(0, 8);
    if (rows.length === 0) return null;
    return (
        <section aria-label={tr.feed.liveLabel} className="mb-6 bg-ink-900 border border-ink-700 rounded-card px-4 py-2 min-w-0">
            {rows.map((t) => {
                const c = byAddr.get(t.curve)!;
                const ts = tsOf(t.block);
                const side = t.side === "buy" ? tr.feed.buy : tr.feed.sell;
                const wallet = t.isDev ? tr.curve.dev : shortAddr(t.trader);
                return (
                    <Link
                        key={`${t.tx}:${t.logIndex}`}
                        to={`/t/${c.address}`}
                        className="block py-1.5 text-[13px] text-hanji-100 hover:text-brass-400 no-underline truncate tabular-nums"
                    >
                        <span className={t.side === "buy" ? "text-success" : "text-error"}>●</span>{" "}
                        {tr.feed.tickerLine(wallet, c.symbol, `${tradeAmount(t, c.isEth, tr.locale)} ${tradeUnit(t, c.isEth)}`, side, ts !== undefined ? agoLabel(tr, now, ts) : "")}
                    </Link>
                );
            })}
        </section>
    );
}

function Tabs({tab, onChange}: {tab: Tab; onChange: (t: Tab) => void}) {
    const tr = useCopy();
    return (
        <div role="tablist" aria-label={tr.feed.tabsLabel} className="flex gap-2 overflow-x-auto pb-1 mb-3 -mx-4 px-4 sm:mx-0 sm:px-0">
            {TABS.map((t) => (
                <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => onChange(t)}
                    className={`flex-none px-4 min-h-[36px] rounded-full border text-[13px] whitespace-nowrap ${tab === t ? "border-brass-400 text-brass-400" : "border-ink-700 text-hanji-400 hover:border-brass-600"}`}
                >
                    {tr.feed.tabs[t]}
                </button>
            ))}
        </div>
    );
}

export default function Curves() {
    const tr = useCopy();
    const {curves, isLoading, isError, refetch} = useCurves();
    const activity = useActivity();
    const meta = useCurveMeta(); // one request for every curve; no metadata on failure
    const [tab, setTab] = useState<Tab>("latest");
    const now = useNow();
    const sorted = sortCurves(tab, curves, activity.stats, activity.graduatedAt);
    const grid = {gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))"};
    const note =
        tab === "popular" ? tr.feed.popularNote : tab === "mcap" ? tr.feed.mcapNote : undefined;
    const windowNote = (tab === "latest" || tab === "popular") && activity.hours !== undefined ? tr.feed.window(activity.hours) : undefined;
    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-12 pb-16 sm:pb-20 min-w-0">
            <h1 className="m-0 mb-2 text-[24px] sm:text-[28px] font-bold">{tr.curve.listTitle}</h1>
            <p className="m-0 mb-6 sm:mb-8 text-[14px] text-hanji-400">{tr.curve.listSub}</p>
            {isError ? (
                <NetError onRetry={refetch} />
            ) : isLoading ? (
                <div className="grid gap-5" style={grid}>
                    <CardSkeleton />
                    <CardSkeleton />
                </div>
            ) : curves.length === 0 ? (
                <p className="text-[14px] text-hanji-400">{tr.curve.empty}</p>
            ) : (
                <>
                    <LiveStrip curves={curves} now={now} />
                    <Tabs tab={tab} onChange={setTab} />
                    {(windowNote || note) && (
                        <p className="m-0 mb-4 text-[12px] text-hanji-400">{[windowNote, note].filter(Boolean).join(" · ")}</p>
                    )}
                    {activity.error != null && <p className="m-0 mb-4 text-[12px] text-error">{tr.feed.loadError}</p>}
                    {sorted.length === 0 ? (
                        <p className="text-[14px] text-hanji-400">{tr.feed.emptyTab}</p>
                    ) : (
                        <div className="grid gap-5" style={grid}>
                            {sorted.map((c) => (
                                <CurveCard key={c.address} c={c} stats={activity.stats.get(c.address)} tsOf={activity.tsOf} now={now} imageUrl={meta.get(c.address)?.imageUrl} />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
