// Candle chart (SVG, no chart library) for the token page. Geometry is in lib/candles.ts.
// The up/down colors (tailwind `up` / `down`) are used only here, for candles and volume bars.
// Layout note (390px): the SVG is as wide as its container (measured), never wider; candles are
// right-anchored at a fixed slot (lib/candles View), so zooming and panning never widen the page.
// Interaction: wheel zooms at the cursor (horizontal wheel pans), drag pans, two-finger pinch
// zooms, double click / double tap resets. One finger shows the candle under it.
import {ReactNode, useEffect, useRef, useState} from "react";
import {useCopy} from "../copy";
import {useAccount} from "wagmi";
import {useCandles, useChainSummary} from "../hooks/chainData";
import {useActivity} from "../hooks/activity";
import {useWalletTrades, WalletTrade} from "../hooks/wallet";
import {Trade, tradePriceWad} from "../lib/activity";
import {CandleMarks, MarkerTrade, markSources, marksByCandle} from "../lib/trustSignals";
import {AREA_GAP, barIndexAt, connectOpens, fitView, layoutCandles, liveFrom, LiveTrade, mergeLiveCandles, panBy, parseCandles, TIME_LABEL_W, timeLabels, toMarketCap, View, zoomAt} from "../lib/candles";
import {fmtAxisMcap, fmtAxisPrice, fmtRound} from "../lib/format";
import {Segmented} from "./ui";

const HEIGHT = 240;
const WHEEL_ZOOM = 1.15;
const DOUBLE_TAP_MS = 300;
const AXIS_W = 64; // right-hand price labels
const INTERVALS = [
    {key: "m5", sec: 300},
    {key: "h1", sec: 3600},
    {key: "d1", sec: 86400},
] as const;

function useWidth<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [w, setW] = useState(0);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
        ro.observe(el);
        setW(Math.floor(el.getBoundingClientRect().width));
        return () => ro.disconnect();
    }, []);
    return [ref, w] as const;
}

type AxisUnit = "mcap" | "price";
type AxisScale = "linear" | "log";
type OnOff = "on" | "off";
const AXIS_KEY = "mapae.chart.axis";
const SCALE_KEY = "mapae.chart.scale";
const DEV_MARKS_KEY = "mapae.chart.devMarks";
const MY_MARKS_KEY = "mapae.chart.myMarks";
const MARK_GAP = 3;
const MARK_STEP = 13; // one mark: a 5 px triangle and a 9 px letter

/** Trades of one wallet on this curve as chart marks (server pages + browser trades not yet indexed). */
function walletMarks(pages: {trades: WalletTrade[]}[] | undefined, live: readonly Trade[], curve: string, wallet: string | undefined, who: "dev" | "me", tsOf: (b: bigint) => number | undefined, devOnly: boolean): MarkerTrade[] {
    if (!wallet) return [];
    const c = curve.toLowerCase();
    const w = wallet.toLowerCase();
    const out: MarkerTrade[] = [];
    for (const p of pages ?? []) {
        for (const t of p.trades) if (t.curve.toLowerCase() === c && (!devOnly || t.isDev)) out.push({ts: Number(t.ts), side: t.side, who});
    }
    for (const t of live) {
        const ts = tsOf(t.block);
        if (ts !== undefined && t.curve.toLowerCase() === c && t.trader.toLowerCase() === w && (!devOnly || t.isDev)) out.push({ts, side: t.side, who});
    }
    return out;
}

/** One mark: a triangle pointing at the candle and its letter beyond it. */
function Mark({x, y, dir, letter}: {x: number; y: number; dir: "up" | "down"; letter: string}) {
    // dir "down" (sell): the triangle tip at y, the letter above; "up" (buy): tip at y, letter below
    const tri = dir === "down" ? `M${x - 3},${y - 5} L${x + 3},${y - 5} L${x},${y} Z` : `M${x - 3},${y + 5} L${x + 3},${y + 5} L${x},${y} Z`;
    return (
        <g className={dir === "up" ? "text-up" : "text-down"} pointerEvents="none">
            <path d={tri} fill="currentColor" />
            <text x={x} y={dir === "down" ? y - 7 : y + 14} fontSize={9} fontWeight={700} textAnchor="middle" fill="currentColor">
                {letter}
            </text>
        </g>
    );
}

function readPref<T extends string>(key: string, allowed: readonly T[]): T | null {
    try {
        const v = localStorage.getItem(key);
        return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : null;
    } catch {
        return null;
    }
}
function writePref(key: string, v: string): void {
    try {
        localStorage.setItem(key, v);
    } catch {
        // storage blocked (private mode): the choice lasts for this page only
    }
}

const timeLabel = (t: number, locale: string, sec: number) =>
    new Date(t * 1000).toLocaleString(locale, sec >= 86400 ? {month: "short", day: "numeric"} : {month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"});

/** `graduated` picks the default scale (log after graduation, linear before) until the user
 *  chooses one. The vertical axis shows market cap by default (STATUS 결정 48). */
/** `footer`: drawn at the bottom of the same card under a 1px line (the token page's progress). */
export function CandleChart({
    curve,
    unit,
    virtualQuote,
    graduated = false,
    dev,
    footer,
}: {
    curve: string;
    unit: string;
    virtualQuote: bigint;
    graduated?: boolean;
    dev?: string;
    footer?: ReactNode;
}) {
    const tr = useCopy();
    // Trade marks (decision 51): Dev trades and the connected wallet's trades, each toggled.
    const [showDev, setShowDev] = useState(() => readPref<OnOff>(DEV_MARKS_KEY, ["on", "off"]) !== "off");
    const [showMine, setShowMine] = useState(() => readPref<OnOff>(MY_MARKS_KEY, ["on", "off"]) !== "off");
    const toggleDev = () => {
        const next = !showDev;
        setShowDev(next);
        writePref(DEV_MARKS_KEY, next ? "on" : "off");
    };
    const toggleMine = () => {
        const next = !showMine;
        setShowMine(next);
        writePref(MY_MARKS_KEY, next ? "on" : "off");
    };
    const {address: me} = useAccount();
    const devTrades = useWalletTrades(dev ?? "");
    const myTrades = useWalletTrades(me ?? "");
    const [interval, setIv] = useState<300 | 3600 | 86400>(300);
    const [axis, setAxisState] = useState<AxisUnit>(() => readPref<AxisUnit>(AXIS_KEY, ["mcap", "price"]) ?? "mcap");
    const [chosenScale, setChosenScale] = useState<AxisScale | null>(() => readPref<AxisScale>(SCALE_KEY, ["linear", "log"]));
    const scale: AxisScale = chosenScale ?? (graduated ? "log" : "linear");
    const setAxis = (a: AxisUnit) => {
        setAxisState(a);
        writePref(AXIS_KEY, a);
    };
    const setScale = (sc: AxisScale) => {
        setChosenScale(sc);
        writePref(SCALE_KEY, sc);
    };
    const label = (v: bigint) => (axis === "mcap" ? fmtAxisMcap(v, unit, tr.locale) : fmtAxisPrice(v, tr.locale));
    const q = useCandles(curve, interval);
    const [boxRef, width] = useWidth<HTMLDivElement>();
    const [hover, setHover] = useState<number | null>(null);
    const plotW = Math.max(0, width - AXIS_W);
    const summary = useChainSummary();
    const activity = useActivity();
    // Server candles + this curve's browser RPC trades after the server's indexedBlock (all of them
    // when the candle API is down). Opens are then connected to the previous close (display only).
    // Prices follow the server: curve trades at the post-trade spot, pool trades at the average.
    const live: LiveTrade[] = activity.trades
        .filter((t) => t.curve.toLowerCase() === curve.toLowerCase())
        .map((t) => ({block: t.block, logIndex: t.logIndex, ts: activity.tsOf(t.block), quoteAmount: t.quoteAmount, tokenAmount: t.tokenAmount, priceWad: tradePriceWad(t, virtualQuote)}));
    const server = q.isSuccess ? parseCandles(q.data) : [];
    // see liveFrom: undefined = add no live trades (position unknown while server candles exist)
    const indexed = liveFrom({candlesOk: q.isSuccess, serverCount: server.length, indexedBlock: summary.isSuccess ? summary.data.indexedBlock : undefined});
    const priced = connectOpens(indexed === undefined ? server : mergeLiveCandles(server, live, indexed, interval));
    const candles = axis === "mcap" ? toMarketCap(priced) : priced;
    // the Dev's own wallet: one "D" per trade (never D and B / S for the same trade)
    const sources = markSources({dev, me, showDev, showMine});
    const markTrades = [
        ...(sources.dev ? walletMarks(devTrades.data?.pages, activity.trades, curve, dev, "dev", activity.tsOf, true) : []),
        ...(sources.mine ? walletMarks(myTrades.data?.pages, activity.trades, curve, me, "me", activity.tsOf, false) : []),
    ];
    const marks: Map<number, CandleMarks> = marksByCandle(
        markTrades,
        candles.map((x) => x.t),
        interval
    );
    // null = default view (fits the width, newest at the right). Width changes keep the slot and
    // only re-fit the offset (fitView); interval changes go back to the default view.
    const [view, setView] = useState<View | null>(null);
    const total = candles.length;
    const shown = view ? fitView(view, total, plotW) : undefined;
    const L = layoutCandles(candles, plotW, HEIGHT, shown, 0.75, AREA_GAP, scale === "log");
    const dp = unit === "ETH" || unit === "WETH" ? 6 : 0;
    const hb = hover !== null ? L.bars[hover] : undefined;

    // Keep the viewed range when new candles arrive while looking at the past (offset > 0).
    const lastT = total > 0 ? candles[total - 1].t : null;
    const prevLast = useRef<number | null>(lastT);
    useEffect(() => {
        const prev = prevLast.current;
        prevLast.current = lastT;
        if (prev === null || lastT === null || lastT <= prev) return;
        const added = candles.filter((x) => x.t > prev).length;
        setView((v) => (v && v.offset > 0 ? {...v, offset: v.offset + added} : v));
    }, [lastT]); // eslint-disable-line react-hooks/exhaustive-deps

    // Latest values for the native wheel listener (attached once per plot element).
    const live2 = useRef({view: shown ?? {slot: L.slot, offset: 0}, total, plotW});
    live2.current = {view: shown ?? {slot: L.slot, offset: 0}, total, plotW};
    const [plotEl, setPlotEl] = useState<SVGRectElement | null>(null);
    useEffect(() => {
        if (!plotEl) return;
        // Non-passive so the page does not scroll while the cursor is over the plot. The listener
        // sits on the plot itself, so outside it the page scrolls normally.
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const {view: v, total: n, plotW: w} = live2.current;
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                setView(panBy(v, -e.deltaX, n, w));
            } else if (e.deltaY !== 0) {
                const x = e.clientX - plotEl.getBoundingClientRect().left;
                setView(zoomAt(v, e.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM, x, w, n));
            }
        };
        plotEl.addEventListener("wheel", onWheel, {passive: false});
        return () => plotEl.removeEventListener("wheel", onWheel);
    }, [plotEl]);

    const drag = useRef<{x: number; view: View} | null>(null);
    const [dragging, setDragging] = useState(false);
    const pinch = useRef<{dist: number; centre: number; view: View} | null>(null);
    const lastTap = useRef(0);
    const localX = (clientX: number, target: Element) => clientX - target.getBoundingClientRect().left;
    const current = (): View => shown ?? {slot: L.slot, offset: 0};

    const onMove = (clientX: number, target: Element) => {
        const i = barIndexAt(localX(clientX, target), L.bars, L.slot);
        setHover(i >= 0 ? i : null);
    };
    const resetView = () => {
        setView(null);
        setHover(null);
    };

    return (
        <div className="bg-ink-900 border border-ink-700 rounded-card p-4 sm:p-6 min-w-0">
            <h3 className="m-0 mb-3 text-[15px] font-bold">{tr.chain.chartTitle}</h3>
            {/* design-token-page: three segments ([mcap | price], [linear | log], [5m | 1h | 1d]) and the
                two trade-mark checkboxes on the right; same state and saved prefs as before */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3 min-w-0">
                <Segmented
                    label={tr.chain.axisLabel}
                    items={[
                        {key: "mcap", label: tr.chain.axisMcap},
                        {key: "price", label: tr.chain.axisPrice},
                    ]}
                    value={axis}
                    onChange={setAxis}
                />
                <Segmented
                    label={tr.chain.scaleLabel}
                    items={[
                        {key: "linear", label: tr.chain.scaleLinear},
                        {key: "log", label: tr.chain.scaleLog},
                    ]}
                    value={scale}
                    onChange={setScale}
                />
                <Segmented
                    label={tr.chain.intervalLabel}
                    items={INTERVALS.map((it) => ({key: it.sec, label: <span className="num">{tr.chain.intervals[it.key]}</span>}))}
                    value={interval}
                    onChange={(sec) => {
                        setIv(sec);
                        setHover(null);
                        setView(null);
                    }}
                />
                {dev && (
                    <div role="group" aria-label={tr.chain.marksLabel} className="flex flex-wrap items-center gap-x-4 sm:ml-auto">
                        {(
                            [
                                [showDev, toggleDev, tr.chain.marksDev],
                                [showMine, toggleMine, tr.chain.marksMine],
                            ] as const
                        ).map(([on, toggle, text]) => (
                            <label key={text} className="inline-flex items-center gap-2 min-h-[44px] text-[13px] text-hanji-100 cursor-pointer whitespace-nowrap">
                                <input type="checkbox" checked={on} onChange={toggle} className="w-4 h-4 accent-brass-400 cursor-pointer" />
                                {text}
                            </label>
                        ))}
                    </div>
                )}
            </div>
            <div ref={boxRef} className="w-full min-w-0 select-none">
                {q.isError && L.bars.length === 0 ? (
                    <p className="m-0 text-[13px] text-hanji-400">{tr.chain.unavailable}</p>
                ) : (q.isLoading && L.bars.length === 0) || width === 0 ? (
                    <div style={{height: HEIGHT}} />
                ) : L.bars.length === 0 ? (
                    <p className="m-0 text-[13px] text-hanji-400">{tr.chain.chartEmpty}</p>
                ) : (
                    <>
                        <div className="min-h-[36px] text-[12px] tabular-nums text-hanji-400 flex flex-wrap gap-x-3 gap-y-0.5 mb-1">
                            {hb && (
                                <>
                                    <span className="text-hanji-100">{timeLabel(hb.candle.t, tr.locale, interval)}</span>
                                    <span>{tr.chain.open} {label(hb.candle.o)}</span>
                                    <span>{tr.chain.high} {label(hb.candle.h)}</span>
                                    <span>{tr.chain.low} {label(hb.candle.l)}</span>
                                    <span>{tr.chain.close} {label(hb.candle.c)}</span>
                                    <span>
                                        {tr.chain.volume} {fmtRound(hb.candle.v, dp, tr.locale)} {unit}
                                    </span>
                                </>
                            )}
                        </div>
                        <svg width={width} height={HEIGHT} className="block" role="img" aria-label={tr.chain.chartTitle}>
                            {L.ticks.map((t, i) => (
                                <g key={i}>
                                    <line x1={0} x2={plotW} y1={t.y} y2={t.y} stroke="#3A3126" strokeWidth={1} />
                                    <text x={plotW + 6} y={Math.min(Math.max(t.y + 4, 10), L.priceH)} fontSize={11} fill="#A89880" className="tabular-nums">
                                        {label(t.price)}
                                    </text>
                                </g>
                            ))}
                            {L.bars.map((b, i) => (
                                <g key={b.candle.t} className={b.up ? "text-up" : "text-down"} opacity={hover === null || hover === i ? 1 : 0.55}>
                                    <line x1={b.x} x2={b.x} y1={b.wickTop} y2={b.wickBottom} stroke="currentColor" strokeWidth={1} />
                                    <rect x={b.x - b.w / 2} y={b.bodyTop} width={b.w} height={b.bodyH} fill="currentColor" />
                                    <rect x={b.x - b.w / 2} y={b.volTop} width={b.w} height={b.volH} fill="currentColor" opacity={0.35} />
                                </g>
                            ))}
                            {L.bars.map((b) => {
                                const m = marks.get(b.candle.t);
                                if (!m) return null;
                                // sells above the wick (Dev nearest), buys below it; clamped inside the plot
                                const sells = [m.devSell ? "D" : null, m.mySell ? "S" : null].filter((x): x is string => x !== null);
                                const buys = [m.devBuy ? "D" : null, m.myBuy ? "B" : null].filter((x): x is string => x !== null);
                                return (
                                    <g key={`m${b.candle.t}`}>
                                        {sells.map((l, i) => (
                                            <Mark key={`s${l}`} x={b.x} y={Math.max(16 + i * MARK_STEP, b.wickTop - MARK_GAP - i * MARK_STEP)} dir="down" letter={l} />
                                        ))}
                                        {buys.map((l, i) => (
                                            <Mark key={`b${l}`} x={b.x} y={Math.min(HEIGHT - 16 - (buys.length - 1 - i) * MARK_STEP, b.wickBottom + MARK_GAP + i * MARK_STEP)} dir="up" letter={l} />
                                        ))}
                                    </g>
                                );
                            })}
                            <rect
                                ref={setPlotEl}
                                x={0}
                                y={0}
                                width={plotW}
                                height={HEIGHT}
                                fill="transparent"
                                // vertical swipes still scroll the page; pinch and horizontal moves are ours
                                style={{touchAction: "pan-y", cursor: dragging ? "grabbing" : "grab"}}
                                onMouseDown={(e) => {
                                    e.preventDefault(); // no text selection when a drag starts
                                    drag.current = {x: e.clientX, view: current()};
                                    setDragging(true);
                                    setHover(null);
                                }}
                                onMouseMove={(e) => {
                                    if (drag.current) setView(panBy(drag.current.view, e.clientX - drag.current.x, total, plotW));
                                    else onMove(e.clientX, e.currentTarget);
                                }}
                                onMouseUp={() => {
                                    drag.current = null;
                                    setDragging(false);
                                }}
                                onMouseLeave={() => {
                                    drag.current = null;
                                    setDragging(false);
                                    setHover(null);
                                }}
                                onDoubleClick={resetView}
                                onTouchStart={(e) => {
                                    if (e.touches.length === 2) {
                                        const [a, b] = [e.touches[0], e.touches[1]];
                                        pinch.current = {
                                            dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
                                            centre: localX((a.clientX + b.clientX) / 2, e.currentTarget),
                                            view: current(),
                                        };
                                        setHover(null);
                                        return;
                                    }
                                    const now = Date.now();
                                    if (now - lastTap.current < DOUBLE_TAP_MS) {
                                        lastTap.current = 0;
                                        resetView();
                                        return;
                                    }
                                    lastTap.current = now;
                                    onMove(e.touches[0].clientX, e.currentTarget);
                                }}
                                onTouchMove={(e) => {
                                    const p = pinch.current;
                                    if (p && e.touches.length === 2 && p.dist > 0) {
                                        const [a, b] = [e.touches[0], e.touches[1]];
                                        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                                        setView(zoomAt(p.view, dist / p.dist, p.centre, plotW, total));
                                        return;
                                    }
                                    if (!p) onMove(e.touches[0].clientX, e.currentTarget);
                                }}
                                onTouchEnd={(e) => {
                                    if (e.touches.length < 2) pinch.current = null;
                                }}
                            />
                        </svg>
                        {/* time labels under the first and last visible candles (only the last when they would overlap) */}
                        <div className="relative h-[16px] text-[11px] text-hanji-400 tabular-nums mt-1 overflow-hidden" style={{width: plotW}}>
                            {timeLabels(L.bars, plotW).map((lb) => {
                                const b = lb.bar === "first" ? L.bars[0] : L.bars[L.bars.length - 1];
                                return (
                                    <span key={lb.bar} className="absolute top-0 whitespace-nowrap" style={{left: lb.left, width: TIME_LABEL_W, textAlign: lb.align}}>
                                        {timeLabel(b.candle.t, tr.locale, interval)}
                                    </span>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
            {footer !== undefined && <div className="mt-4 pt-4 border-t border-ink-700 min-w-0">{footer}</div>}
        </div>
    );
}
