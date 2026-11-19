import {ClipboardEvent, KeyboardEvent, useEffect, useRef, useState} from "react";
import {Link, useNavigate, useSearchParams} from "react-router-dom";
import {useCopy} from "../copy";
import {Address, CurveInfo, useCurves} from "../hooks/curves";
import {useActivity} from "../hooks/activity";
import {SummaryWindow, useChainSummary} from "../hooks/chainData";
import {keyByCurves, mergeStats, ServerSummary} from "../lib/chainMerge";
import {CurveStats, marketCap, Trade} from "../lib/activity";
import {progressBps} from "../lib/curveMath";
import {fmtCeil, fmtRound, shortAddr} from "../lib/format";
import {changeLabel, changeOf, exactAddressHit, featured, HOME_TABS, HomeTab, homeTab, leftToGraduate, OVERLAY_MAX, searchCurves, upcomingCount} from "../lib/homeList";
import {LaunchBadges} from "../components/LaunchStatus";
import {isUpcoming} from "../lib/launchState";
import {agoLabel, prefersReducedMotion, tradeAmount, tradeUnit, useNow} from "../components/feed";
import {Badge, Card, Eyebrow, Gauge, NetError, PRIMARY_CLS, StaleBand, UnderlineTabs} from "../components/ui";
import {OfferingStrip} from "../components/OfferingStrip";
import {CurveAvatar} from "../components/MetaForm";
import {addrKey} from "../lib/address";
import {useCurveMeta} from "../hooks/meta";
import {useNicknames} from "../hooks/nicknames";
import {WalletLink} from "../components/WalletLink";
import {useTitle} from "../lib/title";
import {NonStandardTicker} from "../components/TickerBadge";

// Layout note (390px): fluid padding, every text block is min-w-0 + truncate, and below lg each row
// is a two-line flex row (no table), so nothing asks for more width than the viewport. The sort tabs
// scroll sideways inside their own strip (overflow-x-auto, scrollbar hidden), never the page.
// design-home: the top is the tagline, intro lines and two CTAs, with the featured card on the right
// from lg; then the fixed-price offering strip; then the list (rows left, sticky 320px live panel
// right, from lg). Market cap is never truncated: the token name column gives way first.

export const quoteUnit = (c: Pick<CurveInfo, "isEth">) => (c.isEth ? "ETH" : "KRWs");

export function pctLabel(bps: bigint): string {
    const whole = bps / 100n;
    const frac = bps % 100n;
    return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0").replace(/0$/, "")}`;
}

const FLASH_MS = 600;
/** lg table columns: rank | token | verified traders | market cap | change | progress | last trade.
 *  Market cap takes its full width (max-content); the token column (minmax 0) shrinks first. */
const COLS =
    "lg:grid lg:grid-cols-[28px_minmax(0,3.2fr)_minmax(0,0.9fr)_minmax(max-content,1.3fr)_minmax(0,1fr)_132px_minmax(0,1fr)] lg:gap-4 lg:items-center";

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
    return <span className={`num ${tone === "up" ? "text-success" : tone === "down" ? "text-error" : "text-hanji-400"}`}>{text}</span>;
}

/** Graduated / start countdown ("opens soon") / priority countdown, plus the verified-only mark
 *  (W-T61). Lists read "started" from the device clock. */
function StatusBadge({c}: {c: CurveInfo}) {
    const tr = useCopy();
    const started = !isUpcoming(c, Date.now() / 1000);
    return (
        <span className="inline-flex flex-wrap items-center gap-1.5 max-w-full">
            {c.graduated && <Badge kind="neutral">{tr.curve.graduated}</Badge>}
            <LaunchBadges c={c} started={started} compact />
        </span>
    );
}

const progressOf = (c: CurveInfo) => (c.graduated ? 10_000n : progressBps(c.virtualQuote, c.r));
/** Market cap: the figure in .num 500, the unit 12px hanji-400; never truncated. */
function Mcap({c, locale}: {c: CurveInfo; locale: string}) {
    const m = marketCap(c, c.poolSpot);
    if (m === undefined) return <span>…</span>;
    return (
        <span className="whitespace-nowrap">
            <span className="num font-medium">{fmtRound(m, c.isEth ? 4 : 0, locale)}</span> <span className="text-[12px] text-hanji-400">{quoteUnit(c)}</span>
        </span>
    );
}

type RowProps = {rank: number; c: CurveInfo; stats: CurveStats | undefined; tsOf: (b: bigint) => number | undefined; now: number; imageUrl?: string | null; change: bigint | undefined};

function CurveRow({rank, c, stats, tsOf, now, imageUrl, change}: RowProps) {
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
            className={`block min-w-0 no-underline text-hanji-100 hover:text-hanji-100 px-4 py-2.5 min-h-[56px] hover:bg-ink-900 transition-shadow duration-300 ${flash ? "ring-1 ring-inset ring-brass-400" : ""}`}
        >
            {/* lg: seven columns */}
            <div className={`hidden ${COLS} tabular-nums text-[14px]`}>
                <div className="num text-[13px] text-hanji-400">{rank}</div>
                <div className="flex items-center gap-3 min-w-0">
                    <CurveAvatar char={avatar} imageUrl={imageUrl} size={36} />
                    <div className="min-w-0">
                        {/* W-T61: badges wrap under the name when they do not fit (start countdown + verified-only) */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                            <span className="font-semibold truncate max-w-full">{c.name}</span>
                            {/* 1024-1279px: the token column is too narrow for name + badge */}
                            <span className="min-w-0 max-w-full hidden xl:inline-flex">
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
                <div className="text-right num">{c.verifiedBuyerCount}</div>
                <div className="text-right">
                    <Mcap c={c} locale={tr.locale} />
                </div>
                <div className="text-right">
                    <Change bps={change} />
                </div>
                <div className="flex items-center justify-end gap-2">
                    <div className="w-[72px] flex-none">
                        <Gauge committed={bps} target={10_000n} height={4} />
                    </div>
                    <span className="num w-[52px] flex-none text-right text-[12px] text-hanji-400">{pctLabel(bps)}%</span>
                </div>
                <div className="text-right text-[13px] text-hanji-400 truncate num">{ago ?? "–"}</div>
            </div>
            {/* below lg: two lines and a thin progress bar */}
            <div className="flex items-center gap-3 min-w-0 lg:hidden">
                <CurveAvatar char={avatar} imageUrl={imageUrl} size={36} />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                        <span className="text-[15px] font-semibold truncate max-w-full">{c.name}</span>
                        <span className="min-w-0 max-w-full inline-flex">
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
                <div className="flex-none text-right">
                    <div className="text-[13px]">
                        <Mcap c={c} locale={tr.locale} />
                    </div>
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
            <span className="num">#</span>
            <span className="truncate">{h.token}</span>
            <span className="text-right truncate">{h.traders}</span>
            <span className="text-right truncate">{h.mcap}</span>
            <span className="text-right truncate">{tr.homeRows.changeCol(period)}</span>
            <span className="text-right truncate">{h.progress}</span>
            <span className="text-right truncate">{h.last}</span>
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
        <Link to={`/t/${c.address}`} className="hidden sm:block min-w-0 no-underline text-hanji-100 hover:text-hanji-100">
            <Card className="hover:border-brass-600 transition-colors duration-300">
                <div className="flex items-baseline justify-between gap-3 mb-3">
                    <Eyebrow locale={tr.locale}>{tr.homeRows.featuredLabel}</Eyebrow>
                    <span className="num text-[13px] text-hanji-100 flex-none">{pctLabel(bps)}%</span>
                </div>
                <div className="flex items-center gap-3.5 mb-4 min-w-0">
                    <CurveAvatar char={c.symbol.slice(0, 1) || "馬"} imageUrl={imageUrl} />
                    <div className="min-w-0 flex-1">
                        <div className="text-[17px] font-bold truncate">{c.name}</div>
                        <div className="text-[13px] text-hanji-400 truncate">
                            {c.symbol} · {unit}
                        </div>
                    </div>
                    <div className="flex-none">
                        <LaunchBadges c={c} started={!isUpcoming(c, Date.now() / 1000)} compact />
                    </div>
                </div>
                <div className="flex justify-between gap-3 text-[13px] mb-3 tabular-nums flex-wrap">
                    <span className="text-hanji-400">{tr.curve.marketCap}</span>
                    <span className="font-semibold">
                        <Mcap c={c} locale={tr.locale} />
                    </span>
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
    const nick = nicks.get(addrKey(t.trader));
    const wallet = t.isDev ? tr.curve.dev : <WalletLink address={t.trader} nickname={nick} link={false} className={`max-w-[140px] ${nick ? "" : "num"}`} />;
    const amount = `${tradeAmount(t, c.isEth, tr.locale)} ${tradeUnit(t, c.isEth)}`;
    const ago = ts !== undefined ? agoLabel(tr, now, ts) : "";
    return (
        <Link to={`/t/${c.address}`} className={`flex items-center gap-2 min-w-0 no-underline text-hanji-100 hover:text-brass-400 tabular-nums text-[13px] ${compact ? "" : "py-1.5"}`}>
            <span className={`flex-none ${t.side === "buy" ? "text-success" : "text-error"}`}>{side}</span>
            <span className="flex-none font-semibold">{c.symbol}</span>
            <span className="min-w-0 flex-1 truncate text-hanji-400">
                {wallet} · <span className="num">{amount}</span>
            </span>
            <span className="flex-none text-[12px] text-hanji-400 num">{ago}</span>
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

/** The tagline with its accent words in brass-400 (the whole tagline when the accent is missing). */
function Tagline() {
    const {tagline, taglineAccent} = useCopy().homeRows;
    const at = tagline.indexOf(taglineAccent);
    if (at < 0) return <>{tagline}</>;
    return (
        <>
            {tagline.slice(0, at)}
            <span className="text-brass-400">{taglineAccent}</span>
            {tagline.slice(at + taglineAccent.length)}
        </>
    );
}

function HomeIntro() {
    const tr = useCopy();
    return (
        <div className="min-w-0">
            <h1 className="m-0 font-serif text-[30px] sm:text-[46px] font-bold leading-[1.18]">
                <Tagline />
            </h1>
            <ul className="m-0 mt-5 p-0 list-none flex flex-col gap-2">
                {tr.homeRows.intro.map((line) => (
                    <li key={line} className="flex items-start gap-3 text-[14.5px] text-hanji-100 leading-relaxed">
                        <span aria-hidden="true" className="flex-none w-[14px] h-px bg-brass-400 mt-[0.8em]" />
                        <span className="min-w-0">{line}</span>
                    </li>
                ))}
            </ul>
            <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/create" className={`${PRIMARY_CLS} hover:text-ink-950 inline-flex items-center justify-center min-h-[48px] px-6 text-[15px]`}>
                    {tr.homeRows.ctaLaunch}
                </Link>
                <Link
                    to="/offerings/new"
                    className="inline-flex items-center justify-center min-h-[48px] px-6 rounded-input border border-brass-400 bg-transparent text-brass-400 text-[15px] font-bold hover:border-brass-500 hover:text-brass-500"
                >
                    {tr.homeRows.ctaOffering}
                </Link>
            </div>
        </div>
    );
}

function Tabs({tab, onChange, upcoming}: {tab: HomeTab; onChange: (t: HomeTab) => void; upcoming: number}) {
    const tr = useCopy();
    return (
        <UnderlineTabs
            items={HOME_TABS.map((t) => ({
                key: t,
                label: (
                    <>
                        {tr.feed.tabs[t]}
                        {/* W-T61: how many tokens are scheduled */}
                        {t === "upcoming" && upcoming > 0 && <span className="num font-normal text-hanji-400"> {upcoming}</span>}
                    </>
                ),
            }))}
            value={tab}
            onChange={onChange}
            label={tr.feed.tabsLabel}
            className="-mx-4 px-4 sm:mx-0 sm:px-0 flex-1"
        />
    );
}

function PeriodPicker({period, onChange}: {period: SummaryWindow; onChange: (w: SummaryWindow) => void}) {
    const tr = useCopy();
    const opts: [SummaryWindow, string][] = [
        [3600, tr.homeRows.period.h1],
        [86400, tr.homeRows.period.d1],
    ];
    return (
        <div role="radiogroup" aria-label={tr.homeRows.periodLabel} className="flex flex-none rounded-[8px] border border-ink-700 bg-ink-900 p-[3px] self-start sm:self-center">
            {opts.map(([w, label]) => (
                <button
                    key={w}
                    role="radio"
                    aria-checked={period === w}
                    onClick={() => onChange(w)}
                    className={`num px-3 min-h-[36px] rounded-[6px] text-[13px] whitespace-nowrap ${period === w ? "bg-ink-700 text-hanji-100" : "text-hanji-400 hover:text-hanji-100"}`}
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
    const [tab, setTab] = useState<HomeTab>("latest");
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
    // W-T61: scheduled tokens show in "upcoming" (and "new") only
    const sorted = homeTab(tab, curves, stats, activity.graduatedAt, now);
    const shown = searchCurves(sorted, query);
    const top = featured(curves, stats, now);
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
            <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-10 lg:items-center mb-10 sm:mb-12 min-w-0">
                <HomeIntro />
                {top && !isError && !isLoading && <FeaturedCard c={top} imageUrl={meta.get(top.address)?.imageUrl} />}
            </div>
            <OfferingStrip className="mb-10 sm:mb-12" />
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8 min-w-0">
                <div className="min-w-0">
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
                            <SearchBox value={query} onChange={setQuery} onHit={openHit} />
                            <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-3 min-w-0">
                                <Tabs tab={tab} onChange={setTab} upcoming={upcomingCount(curves, now)} />
                                <PeriodPicker period={period} onChange={setPeriod} />
                            </div>
                            {(windowNote || note) && <p className="m-0 mb-4 text-[12px] text-hanji-400">{[windowNote, note].filter(Boolean).join(" · ")}</p>}
                            {activity.error != null && <p className="m-0 mb-4 text-[12px] text-error">{tr.feed.loadError}</p>}
                            {shown.length === 0 ? (
                                <p className="text-[14px] text-hanji-400">{query.trim() !== "" ? tr.homeRows.searchEmpty : tr.feed.emptyTab}</p>
                            ) : (
                                <div className="bg-ink-800 border border-ink-700 rounded-card lg:bg-transparent lg:border-0 lg:rounded-none min-w-0 overflow-hidden">
                                    <RowsHeader period={period} />
                                    <div className="divide-y divide-ink-700 lg:divide-ink-800">
                                        {shown.map((c, i) => (
                                            <CurveRow
                                                key={c.address}
                                                rank={i + 1}
                                                c={c}
                                                stats={stats.get(addrKey(c.address))}
                                                tsOf={activity.tsOf}
                                                now={now}
                                                imageUrl={meta.get(c.address)?.imageUrl}
                                                change={changeOf(c, server)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
                <aside className="hidden lg:flex lg:flex-col gap-5 sticky top-6 self-start min-w-0">
                    {!isError && !isLoading && curves.length > 0 && <LivePanel rows={live} now={now} nicks={liveNicks} />}
                </aside>
            </div>
        </div>
    );
}
