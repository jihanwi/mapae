// Candle chart (SVG, no chart library) for the token page. Geometry is in lib/candles.ts.
// The up/down colors (tailwind `up` / `down`) are used only here, for candles and volume bars.
// Layout note (390px): the SVG is as wide as its container (measured), never wider; when the
// candles don't fit, only the newest ones that fit are drawn. No horizontal scroll.
import {useEffect, useRef, useState} from "react";
import {useCopy} from "../copy";
import {useCandles} from "../hooks/chainData";
import {barIndexAt, layoutCandles, parseCandles} from "../lib/candles";
import {fmtRound, fmtSig} from "../lib/format";

const HEIGHT = 240;
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

const timeLabel = (t: number, locale: string, sec: number) =>
    new Date(t * 1000).toLocaleString(locale, sec >= 86400 ? {month: "short", day: "numeric"} : {month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"});

export function CandleChart({curve, unit}: {curve: string; unit: string}) {
    const tr = useCopy();
    const [interval, setIv] = useState<300 | 3600 | 86400>(300);
    const q = useCandles(curve, interval);
    const [boxRef, width] = useWidth<HTMLDivElement>();
    const [hover, setHover] = useState<number | null>(null);
    const plotW = Math.max(0, width - AXIS_W);
    const candles = q.data ? parseCandles(q.data) : [];
    const L = layoutCandles(candles, plotW, HEIGHT);
    const dp = unit === "ETH" || unit === "WETH" ? 6 : 0;
    const hb = hover !== null ? L.bars[hover] : undefined;

    const onMove = (clientX: number, target: Element) => {
        const x = clientX - target.getBoundingClientRect().left;
        const i = barIndexAt(x, plotW, L.bars.length);
        setHover(i >= 0 ? i : null);
    };

    return (
        <div className="bg-ink-900 border border-ink-700 rounded-card p-4 sm:p-6 min-w-0">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <h3 className="m-0 text-[15px] font-bold">{tr.chain.chartTitle}</h3>
                <div role="group" aria-label={tr.chain.intervalLabel} className="flex gap-1.5">
                    {INTERVALS.map((it) => (
                        <button
                            key={it.key}
                            onClick={() => {
                                setIv(it.sec);
                                setHover(null);
                            }}
                            className={`px-3 min-h-[32px] rounded-full border text-[12px] ${interval === it.sec ? "border-brass-400 text-brass-400" : "border-ink-700 text-hanji-400 hover:border-brass-600"}`}
                        >
                            {tr.chain.intervals[it.key]}
                        </button>
                    ))}
                </div>
            </div>
            <div ref={boxRef} className="w-full min-w-0">
                {q.isError ? (
                    <p className="m-0 text-[13px] text-hanji-400">{tr.chain.unavailable}</p>
                ) : q.isLoading || width === 0 ? (
                    <div style={{height: HEIGHT}} />
                ) : L.bars.length === 0 ? (
                    <p className="m-0 text-[13px] text-hanji-400">{tr.chain.chartEmpty}</p>
                ) : (
                    <>
                        <div className="min-h-[36px] text-[12px] tabular-nums text-hanji-400 flex flex-wrap gap-x-3 gap-y-0.5 mb-1">
                            {hb && (
                                <>
                                    <span className="text-hanji-100">{timeLabel(hb.candle.t, tr.locale, interval)}</span>
                                    <span>{tr.chain.open} {fmtSig(hb.candle.o, 4, tr.locale)}</span>
                                    <span>{tr.chain.high} {fmtSig(hb.candle.h, 4, tr.locale)}</span>
                                    <span>{tr.chain.low} {fmtSig(hb.candle.l, 4, tr.locale)}</span>
                                    <span>{tr.chain.close} {fmtSig(hb.candle.c, 4, tr.locale)}</span>
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
                                        {fmtSig(t.price, 4, tr.locale)}
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
                            <rect
                                x={0}
                                y={0}
                                width={plotW}
                                height={HEIGHT}
                                fill="transparent"
                                onMouseMove={(e) => onMove(e.clientX, e.currentTarget)}
                                onMouseLeave={() => setHover(null)}
                                onTouchStart={(e) => onMove(e.touches[0].clientX, e.currentTarget)}
                                onTouchMove={(e) => onMove(e.touches[0].clientX, e.currentTarget)}
                            />
                        </svg>
                        <div className="flex justify-between text-[11px] text-hanji-400 tabular-nums mt-1" style={{width: plotW}}>
                            <span>{timeLabel(L.bars[0].candle.t, tr.locale, interval)}</span>
                            {L.bars.length > 1 && <span>{timeLabel(L.bars[L.bars.length - 1].candle.t, tr.locale, interval)}</span>}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
