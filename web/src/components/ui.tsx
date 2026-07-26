import {ReactNode} from "react";

/** 메달리온 — 유일 모티프. 이중 원 + 중앙 serif 글자 */
export function Medallion({
    char,
    size = 52,
    active = true,
    dashed = false,
    glow = false,
    sub,
}: {
    char: ReactNode;
    size?: number;
    active?: boolean;
    dashed?: boolean;
    glow?: boolean;
    sub?: ReactNode;
}) {
    const ring = dashed ? "#3A3126" : active ? "#C39A3B" : "#8A6D2F";
    const inner = dashed ? "rgba(58,49,38,.6)" : active ? "rgba(195,154,59,.35)" : "rgba(138,109,47,.35)";
    const color = dashed ? "#3A3126" : active ? "#C39A3B" : "#8A6D2F";
    const pad = size >= 100 ? 11 : 5;
    return (
        <span
            className="grid place-items-center flex-none rounded-full bg-ink-900"
            style={{
                width: size,
                height: size,
                border: `${size >= 100 ? 2 : 1.5}px ${dashed ? "dashed" : "solid"} ${ring}`,
                boxShadow: glow ? "0 0 40px rgba(195,154,59,.12)" : undefined,
            }}
        >
            <span
                className="grid place-items-center rounded-full font-serif text-center leading-tight"
                style={{
                    width: size - pad * 2,
                    height: size - pad * 2,
                    border: `1px solid ${inner}`,
                    color,
                    fontSize: size >= 100 ? size / 4 : size / 2.7,
                }}
            >
                <span>
                    {char}
                    {sub != null && <div style={{fontSize: 11, color: "#A89880"}}>{sub}</div>}
                </span>
            </span>
        </span>
    );
}

export function Badge({kind, children}: {kind: "open" | "frozen" | "neutral" | "partial"; children: ReactNode}) {
    const style = {
        open: {border: "1px solid rgba(122,155,109,.5)", color: "#7A9B6D"},
        frozen: {border: "1px solid rgba(195,154,59,.55)", color: "#C39A3B"},
        neutral: {border: "1px solid #3A3126", color: "#A89880"},
        partial: {border: "1px solid #8A6D2F", color: "#C39A3B"},
    }[kind];
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full text-[12px] whitespace-nowrap" style={{...style, padding: "4px 10px"}}>
            {(kind === "open" || kind === "frozen") && (
                <span className="w-[5px] h-[5px] rounded-full" style={{background: style.color}} />
            )}
            {children}
        </span>
    );
}

/** 게이지 — 100% 초과 시 목표 마커 + 스트라이프 초과분 */
export function Gauge({committed, target, height = 8}: {committed: bigint; target: bigint; height?: number}) {
    const pct = target > 0n ? Number((committed * 10_000n) / target) / 100 : 0;
    const over = pct > 100;
    const fill = over ? (100 / pct) * 100 : pct;
    return (
        <div className="relative overflow-hidden bg-ink-700" style={{height, borderRadius: height / 2}}>
            <div className="absolute top-0 bottom-0 left-0 bg-brass-400" style={{width: `${Math.min(fill, 100)}%`, borderRadius: height / 2}} />
            {over && (
                <>
                    <div
                        className="absolute top-0 bottom-0"
                        style={{left: `${fill}%`, right: 0, background: "repeating-linear-gradient(135deg,#8A6D2F 0 3px,#2A231A 3px 6px)"}}
                    />
                    <div className="absolute top-0 bottom-0 w-[2px] bg-hanji-100 opacity-80" style={{left: `${fill}%`}} />
                </>
            )}
        </div>
    );
}

export function PrimaryBtn({children, ...props}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            {...props}
            className={`rounded-input bg-brass-400 text-ink-950 text-[14px] font-bold px-5 py-3 hover:bg-brass-500 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-brass-400 ${props.className ?? ""}`}
        >
            {children}
        </button>
    );
}

export function SecondaryBtn({children, ...props}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            {...props}
            className={`rounded-input bg-transparent border border-ink-700 text-hanji-100 text-[14px] px-5 py-3 hover:border-brass-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-ink-700 ${props.className ?? ""}`}
        >
            {children}
        </button>
    );
}

export function Card({children, className = "", onClick}: {children: ReactNode; className?: string; onClick?: () => void}) {
    return (
        <div
            onClick={onClick}
            className={`bg-ink-800 border border-ink-700 rounded-card p-6 ${onClick ? "cursor-pointer hover:border-brass-600" : ""} ${className}`}
        >
            {children}
        </div>
    );
}

export function Stat({label, value, unit}: {label: string; value: ReactNode; unit?: string}) {
    return (
        <div className="bg-ink-900 rounded-stat px-3.5 py-3">
            <div className="text-[12px] text-hanji-400 mb-1">{label}</div>
            <div className="text-[15px] font-semibold tabular-nums">
                {value}
                {unit && <span className="text-hanji-400 font-normal text-[13px]"> {unit}</span>}
            </div>
        </div>
    );
}

export function Skeleton({h = 120}: {h?: number}) {
    return <div className="rounded-card bg-ink-800 border border-ink-700 animate-pulse" style={{height: h}} />;
}

/** 인라인 텍스트 스켈레톤 — 크리에이터명 등 로드 전 자리 표시 */
export function TextSkeleton({w = 80, h = 14}: {w?: number; h?: number}) {
    return <span className="inline-block rounded bg-ink-700 animate-pulse align-middle" style={{width: w, height: h}} />;
}
