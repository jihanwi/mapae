// Ticker rule UI (decision 54): the "non-standard ticker" mark and the same-ticker count.
// The mark uses the muted text colour (never a warning or red colour). Hover shows the note via
// title; a tap or click toggles it inline (inside a row link it does not follow the link).
import {MouseEvent, useState} from "react";
import {useCopy} from "../copy";
import {useChainSummary} from "../hooks/chainData";
import {isStandardTicker, sameTickerCount} from "../lib/ticker";

export function NonStandardTicker({symbol}: {symbol: string}) {
    const tr = useCopy();
    const [open, setOpen] = useState(false);
    if (isStandardTicker(symbol)) return null;
    const toggle = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
    };
    return (
        <span className="inline-flex items-center gap-1.5 min-w-0 align-middle">
            <span
                role="button"
                tabIndex={0}
                aria-expanded={open}
                title={tr.tokenPage.nonStandardTickerNote}
                onClick={toggle}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpen((v) => !v);
                    }
                }}
                className="flex-none px-1.5 rounded-full border border-ink-700 text-[11px] leading-[18px] text-hanji-400 cursor-help whitespace-nowrap"
            >
                {tr.tokenPage.nonStandardTicker}
            </span>
            {open && <span className="text-[11px] text-hanji-400 min-w-0">{tr.tokenPage.nonStandardTickerNote}</span>}
        </span>
    );
}

/** Tokens of the summary list (already loaded on every v3 page) with the same ticker, as text
 *  ("3", or "3+" when the list is cut at 500); null when the list is missing or the count is 0. */
export function useSameTicker(symbol: string, exceptCurve?: string): string | null {
    const s = useChainSummary();
    const list = s.data?.list;
    if (!list) return null;
    const n = sameTickerCount(symbol, list, exceptCurve);
    if (n === 0) return null;
    return `${n}${s.data?.listTruncated ? "+" : ""}`;
}
