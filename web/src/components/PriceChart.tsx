import {useRef, useState} from "react";
import {copy} from "../copy";

export type PricePoint = {t: number; price: number; buy: boolean};

const fmtPrice = (p: number) =>
    p >= 100 ? Math.round(p).toLocaleString("en-US") : p.toLocaleString("en-US", {maximumFractionDigits: 2});

const fmtTime = (t: number) => {
    const d = new Date(t * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function niceStep(raw: number) {
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/** 체결가 라인 차트 — 외부 라이브러리 없는 경량 SVG. 캔들·거래량·등락색 금지 원칙 유지 */
export function PriceChart({points, offerPrice}: {points: PricePoint[]; offerPrice: number}) {
    const svgRef = useRef<SVGSVGElement>(null);
    const [hover, setHover] = useState<number | null>(null);

    if (points.length < 2) {
        return <p className="m-0 text-[13px] text-hanji-400">{copy.trade.chartEmpty}</p>;
    }

    const W = 640, H = 220, L = 56, R = 96, T = 16, B = 30;
    const minT = points[0].t, maxT = points[points.length - 1].t;
    let lo = Math.min(...points.map((p) => p.price), offerPrice);
    let hi = Math.max(...points.map((p) => p.price), offerPrice);
    const span = hi - lo || hi * 0.1 || 1;
    lo -= span * 0.15; hi += span * 0.15;
    const x = (t: number) => L + (maxT === minT ? 0.5 : (t - minT) / (maxT - minT)) * (W - L - R);
    const y = (p: number) => T + (1 - (p - lo) / (hi - lo)) * (H - T - B);

    const step = niceStep((hi - lo) / 3);
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
    const timeLabels = maxT === minT ? [minT] : [minT, (minT + maxT) / 2, maxT];

    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
    const last = points[points.length - 1];
    const hovered = hover !== null ? points[hover] : null;

    const pick = (clientX: number) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const px = ((clientX - rect.left) / rect.width) * W;
        let best = 0, bestD = Infinity;
        points.forEach((p, i) => {
            const d = Math.abs(x(p.t) - px);
            if (d < bestD) { bestD = d; best = i; }
        });
        setHover(best);
    };

    return (
        <div className="relative">
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block select-none"
                style={{touchAction: "pan-y"}}
                onMouseMove={(e) => pick(e.clientX)} onMouseLeave={() => setHover(null)}
                onTouchStart={(e) => pick(e.touches[0].clientX)}
                onTouchMove={(e) => pick(e.touches[0].clientX)}
                onTouchEnd={() => setHover(null)}>
                {/* 그리드(수평만) + 좌측 가격 눈금 */}
                {ticks.map((v) => (
                    <g key={v}>
                        <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#3A3126" strokeWidth={1} opacity={0.6} />
                        <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={12} fill="#A89880">{fmtPrice(v)}</text>
                    </g>
                ))}
                {/* 공모가 기준선 */}
                <line x1={L} x2={W - R} y1={y(offerPrice)} y2={y(offerPrice)}
                    stroke="#A89880" strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
                <text x={W - R + 8} y={y(offerPrice) + 4} fontSize={12} fill="#A89880">
                    {copy.trade.chartOfferLabel(fmtPrice(offerPrice))}
                </text>
                {/* 하단 시간 라벨 */}
                {timeLabels.map((t, i) => (
                    <text key={i} x={x(t)} y={H - 8} fontSize={12} fill="#A89880"
                        textAnchor={i === 0 ? "start" : i === timeLabels.length - 1 ? "end" : "middle"}>
                        {fmtTime(t)}
                    </text>
                ))}
                {/* 체결가 라인 + 마지막 체결 dot */}
                <path d={path} fill="none" stroke="#C39A3B" strokeWidth={1.5} strokeLinejoin="round" />
                <circle cx={x(last.t)} cy={y(last.price)} r={3} fill="#C39A3B" />
                {hovered && <circle cx={x(hovered.t)} cy={y(hovered.price)} r={3.5} fill="none" stroke="#F2EAD9" strokeWidth={1.2} />}
            </svg>
            {hovered && (
                <div className="absolute pointer-events-none bg-ink-900 border border-ink-700 rounded-input px-3 py-2 text-[12px] whitespace-nowrap"
                    style={{
                        left: `${(x(hovered.t) / W) * 100}%`,
                        top: `${(y(hovered.price) / H) * 100}%`,
                        transform: `translate(${x(hovered.t) > W * 0.6 ? "-110%" : "10px"}, -120%)`,
                    }}>
                    <span className="text-hanji-400">{fmtTime(hovered.t)}</span>{" · "}
                    <span className="text-hanji-100 font-semibold tabular-nums">{fmtPrice(hovered.price)} KRWs</span>{" · "}
                    <span className="text-hanji-400">{hovered.buy ? copy.trade.buy : copy.trade.sell}</span>
                </div>
            )}
        </div>
    );
}
