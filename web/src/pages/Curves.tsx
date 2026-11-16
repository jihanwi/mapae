import {ClipboardEvent, KeyboardEvent, useEffect, useRef, useState} from "react";
import {Link, useNavigate, useSearchParams} from "react-router-dom";
import {useCopy} from "../copy";
import {Address, CurveInfo, useCurves} from "../hooks/curves";
import {useActivity} from "../hooks/activity";
import {SummaryWindow, useChainSummary} from "../hooks/chainData";
import {keyByCurves, mergeStats, ServerSummary} from "../lib/chainMerge";
import {CurveStats, marketCap, sortCurves, Tab, TABS, Trade} from "../lib/activity";
import {progressBps} from "../lib/curveMath";
import {fmtCeil, fmtRound, shortAddr} from "../lib/format";
import {changeLabel, changeOf, exactAddressHit, featured, leftToGraduate, OVERLAY_MAX, searchCurves} from "../lib/homeList";
import {agoLabel, prefersReducedMotion, tradeAmount, tradeUnit, useNow} from "../components/feed";
import {Badge, Card, Gauge, NetError, StaleBand} from "../components/ui";
import {CurveAvatar} from "../components/MetaForm";
import {addrKey} from "../lib/address";
import {PriorityBadge} from "../components/PriorityCountdown";
import {useCurveMeta} from "../hooks/meta";
import {useNicknames} from "../hooks/nicknames";
import {WalletLink} from "../components/WalletLink";
import {useTitle} from "../lib/title";
import {NonStandardTicker} from "../components/TickerBadge";

// Layout note (390px): fluid padding, every text block is min-w-0 + truncate, and below lg each row
// is a two-line flex row (no table), so nothing asks for more width than the viewport. The sort tabs
// scroll sideways inside their own strip (overflow-x-auto), never the page. From lg the page is two
// columns: rows on the left, a sticky 320px live-trade panel and the intro card on the right.

export const quoteUnit = (c: Pick<CurveInfo, "isEth">) => (c.isEth ? "ETH" : "KRWs");

export function pctLabel(bps: bigint): string {
    const whole = bps / 100n;
    const frac = bps % 100n;
    return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0").replace(/0$/, "")}`;
}

const FLASH_MS = 600;
/** lg table columns: token | verified traders | market cap | change | progress | last trade */
const COLS = "lg:grid lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-4 lg:items-center";

/** True for FLASH_MS after `value` grows (not on first sight). Skipped with reduced motion. */
function useFlashOnIncrease(value: bigint | number | undefined): boolean {
    const prev = useRef(value);
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

/** Change vs. the reference price: "+" with text-success, text-error below 0, "–" when unknown. */
export function Change({bps}: {bps: bigint | undefined}) {
    const tr = useCopy();
    if (bps === undefined) return <span className="text-hanji-400">–</span>;
    const {text, tone} = changeLabel(bps, tr.locale);
    return <span className={tone === "up" ? "text-success" : tone === "down" ? "text-error" : "text-hanji-400"}>{text}</span>;
}

function StatusBadge({c}: {c: CurveInfo}) {
    const tr = useCopy();
    return c.graduated ? <Badge kind="neutral">{tr.curve.graduated}</Badge> : <PriorityBadge priorityUntil={c.priorityUntil} />;
}

const progressOf = (c: CurveInfo) => (c.graduated ? 10_000n : progressBps(c.virtualQuote, c.r));
const mcapText = (c: CurveInfo, locale: string) => {
    const m = marketCap(c, c.poolSpot);
    return m !== undefined ? `${fmtRound(m, c.isEth ? 4 : 0, locale)} ${quoteUnit(c)}` : "…";
};

type RowProps = {c: CurveInfo; stats: CurveStats | undefined; tsOf: (b: bigint) => number | undefined; now: number; imageUrl?: string | null; change: bigint | undefined};

function CurveRow({c, stats, tsOf, now, imageUrl, change}: RowProps) {
    const tr = useCopy();
    const unit = quoteUnit(c);
    const bps = progressOf(c);
    const lastTs = stats ? (stats.lastTradeTs ?? tsOf(stats.lastTradeBlock)) : undefined;
    // flash on a new trade: the merged last trade time (server) or block (browser window) grows
    const flash = useFlashOnIncrease(lastTs ?? stats?.lastTradeBlock);
    const ago = lastTs !== undefined ? agoLabel(tr, now, lastTs) : undefined;
    const avatar = c.symbol.slice(0, 1) || "馬";
    return (
        <Link
            to={`/t/${c.address}`}
            className={`block min-w-0 no-underline text-hanji-100 px-4 py-2.5 min-h-[56px] border-t border-ink-700 first:border-t-0 hover:bg-ink-900 transition-shadow duration-300 ${flash ? "ring-1 ring-inset ring-brass-400" : ""}`}
        >
            {/* lg: six columns */}
            <div className={`hidden ${COLS} tabular-nums text-[14px]`}>
                <div className="flex items-center gap-3 min-w-0">
                    <CurveAvatar char={avatar} imageUrl={imageUrl} size={36} />
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="font-semibold truncate">{c.name}</span>
                            <span className="flex-none">
                                <StatusBadge c={c} />
                            </span>
                        </div>
                        <div className="text-[12px] text-hanji-400 flex items-center gap-1.5 min-w-0">
                            <span className="truncate">
                                {c.symbol} · {unit}
                            </span>
                            <NonStandardTicker symbol={c.symbol} />
                        </div>
                    </div>
                </div>
                <div className="text-right">{c.verifiedBuyerCount}</div>
                <div className="text-right truncate">{mcapText(c, tr.locale)}</div>
                <div className="text-right">
                    <Change bps={change} />
                </div>
                <div className="flex items-center gap-2 min-w-0">
                    <div className="flex-1 min-w-0">
                        <Gauge committed={bps} target={10_000n} height={6} />
                    </div>
                    <span className="text-[12px] text-hanji-400 flex-none">{pctLabel(bps)}%</span>
                </div>
                <div className="text-right text-[13px] text-hanji-400 truncate">{ago ?? "–"}</div>
            </div>
            {/* below lg: two lines and a thin progress bar */}
            <div className="flex items-center gap-3 min-w-0 lg:hidden">
                <CurveAvatar char={avatar} imageUrl={imageUrl} size={36} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[15px] font-semibold truncate">{c.name}</span>
                        <span className="flex-none">
                            <StatusBadge c={c} />
                        </span>
                    </div>
                    <div className="text-[12px] text-hanji-400 flex items-center gap-1.5 min-w-0 tabular-nums">
                        <span className="truncate">{[c.symbol, tr.homeRows.verifiedShort(c.verifiedBuyerCount), ago].filter(Boolean).join(" · ")}</span>
                        <NonStandardTicker symbol={c.symbol} />
                    </div>
                    <div className="mt-1.5">
                        <Gauge committed={bps} target={10_000n} height={3} />
                    </div>
                </div>
                <div className="flex-none text-right tabular-nums max-w-[45%] min-w-0">
                    <div className="text-[13px] font-semibold truncate">{mcapText(c, tr.locale)}</div>
                    <div className="text-[12px]">
                        <Change bps={change} />
                    </div>
                </div>
            </div>
        </Link>
    );
}

function RowsHeader({period}: {period: SummaryWindow}) {
    const tr = useCopy();
    const h = tr.homeRows.cols;
    return (
        <div className={`hidden ${COLS} px-4 py-2 border-b border-ink-700 text-[12px] text-hanji-400`}>
            <span>{h.token}</span>
            <span className="text-right">{h.traders}</span>
            <span className="text-right">{h.mcap}</span>
            <span className="text-right">{tr.homeRows.changeCol(period)}</span>
            <span>{h.progress}</span>
            <span className="text-right">{h.last}</span>
        </div>
    );
}

function RowsSkeleton() {
    return (
        <div className="bg-ink-800 border border-ink-700 rounded-card">
            {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 min-h-[56px] border-t border-ink-700 first:border-t-0">
                    <span className="w-9 h-9 rounded-full bg-ink-700 shimmer flex-none" />
                    <div className="flex-1 min-w-0">
                        <span className="block rounded bg-ink-700 shimmer mb-2" style={{height: 13, width: "45%"}} />
                        <span className="block rounded bg-ink-700 shimmer" style={{height: 10, width: "30%"}} />
                    </div>
                    <span className="rounded bg-ink-700 shimmer flex-none" style={{height: 13, width: 72}} />
                </div>
            ))}
        </div>
    );
}

/** The open token closest to graduation (sm and up). */
function FeaturedCard({c, imageUrl}: {c: CurveInfo; imageUrl?: string | null}) {
    const tr = useCopy();
    const unit = quoteUnit(c);
    const bps = progressOf(c);
    return (
        <Link to={`/t/${c.address}`} className="hidden sm:block mb-6 min-w-0 no-underline text-hanji-100">
            <Card className="hover:border-brass-600 transition-colors duration-300">
                <div className="text-[12px] text-brass-400 mb-3">{tr.homeRows.featuredLabel}</div>
                <div className="flex items-center gap-3.5 mb-4 min-w-0">
                    <CurveAvatar char={c.symbol.slice(0, 1) || "馬"} imageUrl={imageUrl} />
                    <div className="min-w-0 flex-1">
                        <div className="text-[17px] font-bold truncate">{c.name}</div>
                        <div className="text-[13px] text-hanji-400 truncate">
                            {c.symbol} · {unit}
                        </div>
                    </div>
                    <div className="flex-none">
                        <PriorityBadge priorityUntil={c.priorityUntil} />
                    </div>
                </div>
                <div className="flex justify-between gap-3 text-[13px] mb-3 tabular-nums flex-wrap">
                    <span className="text-hanji-400">{tr.curve.marketCap}</span>
                    <span className="font-semibold">{mcapText(c, tr.locale)}</span>
                </div>
                <Gauge committed={bps} target={10_000n} />
                <div className="mt-2 flex justify-between gap-3 flex-wrap text-[12px] text-hanji-400 tabular-nums">
                    <span>{tr.curve.verifiedTraders(c.verifiedBuyerCount)}</span>
                    {/* the fee is not indexed: the figure waits for the chain read */}
                    {c.source !== "server" && <span className="text-hanji-100">{tr.curve.toGraduate(fmtCeil(leftToGraduate(c), c.isEth ? 6 : 0, tr.locale), unit)}</span>}
                </div>
            </Card>
        </Link>
    );
}

type LiveRow = {t: Trade; c: CurveInfo; ts: number | undefined};

/** Latest browser trades of the listed curves (the former LiveStrip data). */
function useLiveRows(curves: CurveInfo[], n: number): LiveRow[] {
    const {trades, tsOf} = useActivity();
    const byAddr = new Map(curves.map((c) => [addrKey(c.address), c]));
    return trades
        .filter((t) => byAddr.has(addrKey(t.curve)))
        .slice(0, n)
        .map((t) => ({t, c: byAddr.get(addrKey(t.curve))!, ts: tsOf(t.block)}));
}

type Nicks = Map<`0x${string}`, string>;

function LiveLine({row, now, compact, nicks}: {row: LiveRow; now: number; compact?: boolean; nicks: Nicks}) {
    const tr = useCopy();
    const {t, c, ts} = row;
    const side = t.side === "buy" ? tr.feed.buy : tr.feed.sell;
    // the whole line links to the token page, so the wallet is plain text (no link inside a link)
    const wallet = t.isDev ? tr.curve.dev : <WalletLink address={t.trader} nickname={nicks.get(addrKey(t.trader))} link={false} className="max-w-[140px]" />;
    const amount = `${tradeAmount(t, c.isEth, tr.locale)} ${tradeUnit(t, c.isEth)}`;
    const ago = ts !== undefined ? agoLabel(tr, now, ts) : "";
    return (
        <Link to={`/t/${c.address}`} className={`flex items-center gap-2 min-w-0 no-underline text-hanji-100 hover:text-brass-400 tabular-nums text-[13px] ${compact ? "" : "py-1.5"}`}>
            <span className={`flex-none ${t.side === "buy" ? "text-success" : "text-error"}`}>{side}</span>
            <span className="flex-none font-semibold">{c.symbol}</span>
            <span className="min-w-0 flex-1 truncate text-hanji-400">
                {wallet} · {amount}
            </span>
            <span className="flex-none text-[12px] text-hanji-400">{ago}</span>
        </Link>
    );
}

function LivePanel({rows, now, nicks}: {rows: LiveRow[]; now: number; nicks: Nicks}) {
    const tr = useCopy();
    return (
        <section aria-label={tr.homeRows.livePanel} className="bg-ink-800 border border-ink-700 rounded-card px-4 py-3 min-w-0">
            <h2 className="m-0 mb-2 text-[14px] font-semibold">{tr.homeRows.livePanel}</h2>
            {rows.length === 0 ? (
                <p className="m-0 text-[12px] text-hanji-400">{tr.chain.chartEmpty}</p>
            ) : (
                rows.map((r) => <LiveLine key={`${r.t.tx}:${r.t.logIndex}`} row={r} now={now} nicks={nicks} />)
            )}
        </section>
    );
}

/** Below lg: the newest trade on one line; nothing when there is none. */
function LatestTrade({rows, now, nicks}: {rows: LiveRow[]; now: number; nicks: Nicks}) {
    const tr = useCopy();
    if (rows.length === 0) return null;
    return (
        <section aria-label={tr.homeRows.livePanel} className="lg:hidden mb-5 bg-ink-900 border border-ink-700 rounded-card px-4 py-2 min-w-0">
            <LiveLine row={rows[0]} now={now} compact nicks={nicks} />
        </section>
    );
}

function IntroCard({className = ""}: {className?: string}) {
    const tr = useCopy();
    return (
        <Card className={className}>
            {tr.homeRows.intro.map((line) => (
                <p key={line} className="m-0 mb-2 last:mb-0 text-[13px] text-hanji-400 leading-relaxed">
                    {line}
                </p>
            ))}
        </Card>
    );
}

function Tabs({tab, onChange}: {tab: Tab; onChange: (t: Tab) => void}) {
    const tr = useCopy();
    return (
        <div role="tablist" aria-label={tr.feed.tabsLabel} className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 min-w-0 flex-1">
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

function PeriodPicker({period, onChange}: {period: SummaryWindow; onChange: (w: SummaryWindow) => void}) {
    const tr = useCopy();
    const opts: [SummaryWindow, string][] = [
        [3600, tr.homeRows.period.h1],
        [86400, tr.homeRows.period.d1],
    ];
    return (
        <div role="radiogroup" aria-label={tr.homeRows.periodLabel} className="flex flex-none rounded-full border border-ink-700 p-0.5 self-start">
            {opts.map(([w, label]) => (
                <button
                    key={w}
                    role="radio"
                    aria-checked={period === w}
                    onClick={() => onChange(w)}
                    className={`px-3 min-h-[32px] rounded-full text-[13px] whitespace-nowrap ${period === w ? "bg-ink-700 text-brass-400" : "text-hanji-400 hover:text-hanji-100"}`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

function SearchBox({value, onChange, onHit}: {value: string; onChange: (v: string) => void; onHit: (q: string) => boolean}) {
    const tr = useCopy();
    return (
        <input
            type="search"
            value={value}
            aria-label={tr.homeRows.search}
            placeholder={tr.homeRows.search}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") onHit(value);
            }}
            onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
                // a pasted full curve or token address opens that token right away
                if (onHit(e.clipboardData.getData("text"))) e.preventDefault();
            }}
            className="w-full min-w-0 mb-4 bg-ink-900 border border-ink-700 rounded-input px-4 min-h-[44px] text-[14px] text-hanji-100 placeholder:text-hanji-400 outline-none focus:border-brass-400"
        />
    );
}

export default function Curves() {
    const tr = useCopy();
    useTitle(`MAPAE | ${tr.homeRows.tagline}`);
    const navigate = useNavigate();
    // Server list first; the chain overlays the visible rows (featured + the first OVERLAY_MAX).
    const [overlay, setOverlay] = useState<Address[]>([]);
    const {curves, isLoading, isError, stale, refetch} = useCurves(true, overlay);
    const activity = useActivity();
    const meta = useCurveMeta(); // one request for every curve; no metadata on failure
    const [tab, setTab] = useState<Tab>("latest");
    const [period, setPeriod] = useState<SummaryWindow>(86400);
    // ?q= prefills the search (the token page's "other tokens with this ticker" link)
    const [params] = useSearchParams();
    const [query, setQuery] = useState(() => params.get("q") ?? "");
    // live trades (panel: 8, mobile line: the newest of them) and one bulk nickname lookup for both
    const live = useLiveRows(curves, 8);
    const liveNicks = useNicknames(live.filter((r) => !r.t.isDev).map((r) => r.t.trader));
    const now = useNow();
    // Stats for the chosen window: the server index plus browser RPC trades after its indexedBlock.
    // Without the server (503 / no answer) the list keeps working on the browser window alone, and
    // the change column shows "–".
    const summary = useChainSummary(period);
    const serverOk = summary.isSuccess;
    const server: ServerSummary | undefined = serverOk ? summary.data : undefined;
    const stats = server ? keyByCurves(mergeStats(server, activity.trades, activity.tsOf, now, period), curves) : activity.stats;
    const sorted = sortCurves(tab, curves, stats, activity.graduatedAt);
    const shown = searchCurves(sorted, query);
    const top = featured(curves, stats);
    const note = tab === "popular" ? tr.feed.popularNote(period) : tab === "mcap" ? tr.feed.mcapNote : undefined;
    const windowNote = serverOk ? tr.homeRows.periodNote(period) : activity.hours !== undefined ? tr.feed.window(activity.hours) : undefined;
    const visible = [...(top ? [top.address] : []), ...shown.map((c) => c.address)].slice(0, OVERLAY_MAX);
    const visibleKey = visible.join(",");
    useEffect(() => setOverlay(visible), [visibleKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const openHit = (q: string) => {
        const hit = exactAddressHit(curves, q);
        if (hit) navigate(`/t/${hit.address}`);
        return hit !== undefined;
    };
    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-8 sm:pt-12 pb-16 sm:pb-20 min-w-0">
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8 min-w-0">
                <div className="min-w-0">
                    <h1 className="m-0 mb-6 sm:mb-8 font-serif text-[24px] sm:text-[30px] font-bold leading-snug">{tr.homeRows.tagline}</h1>
                    {isError ? (
                        <NetError onRetry={refetch} autoRetryMs={10_000} />
                    ) : isLoading ? (
                        <RowsSkeleton />
                    ) : curves.length === 0 ? (
                        <p className="text-[14px] text-hanji-400">{tr.curve.empty}</p>
                    ) : (
                        <>
                            {stale && <StaleBand className="mb-4" />}
                            <LatestTrade rows={live.slice(0, 1)} now={now} nicks={liveNicks} />
                            {top && query.trim() === "" && <FeaturedCard c={top} imageUrl={meta.get(top.address)?.imageUrl} />}
                            <SearchBox value={query} onChange={setQuery} onHit={openHit} />
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-3 min-w-0">
                                <Tabs tab={tab} onChange={setTab} />
                                <PeriodPicker period={period} onChange={setPeriod} />
                            </div>
                            {(windowNote || note) && <p className="m-0 mb-4 text-[12px] text-hanji-400">{[windowNote, note].filter(Boolean).join(" · ")}</p>}
                            {activity.error != null && <p className="m-0 mb-4 text-[12px] text-error">{tr.feed.loadError}</p>}
                            {shown.length === 0 ? (
                                <p className="text-[14px] text-hanji-400">{query.trim() !== "" ? tr.homeRows.searchEmpty : tr.feed.emptyTab}</p>
                            ) : (
                                <div className="bg-ink-800 border border-ink-700 rounded-card min-w-0 overflow-hidden">
                                    <RowsHeader period={period} />
                                    {shown.map((c) => (
                                        <CurveRow
                                            key={c.address}
                                            c={c}
                                            stats={stats.get(addrKey(c.address))}
                                            tsOf={activity.tsOf}
                                            now={now}
                                            imageUrl={meta.get(c.address)?.imageUrl}
                                            change={changeOf(c, server)}
                                        />
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                    <IntroCard className="mt-6 lg:hidden" />
                </div>
                <aside className="hidden lg:flex lg:flex-col gap-5 sticky top-6 self-start min-w-0">
                    {!isError && !isLoading && curves.length > 0 && <LivePanel rows={live} now={now} nicks={liveNicks} />}
                    <IntroCard />
                </aside>
            </div>
        </div>
    );
}
