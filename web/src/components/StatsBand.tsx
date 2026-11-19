// W-T65: the figures band shared by the token page metrics (W-T56) and the wallet P&L band. One
// ink-900 band (1px ink-700 border, radius 14px, 18px top and bottom). Below the one-row
// breakpoint the items sit in a grid (two columns unless the caller adds more, 16px between rows);
// from it they sit in one row with 1px ink-700 dividers. Labels 12px hanji-400; values .num,
// medium, hanji-100 and never truncated (they wrap).
// Tailwind needs whole class names, so each breakpoint has its own fixed strings.
import {createContext, ReactNode, useContext} from "react";

export type OneRowFrom = "lg" | "xl";

const BAND: Record<OneRowFrom, string> = {
    xl: "grid grid-cols-2 gap-x-4 gap-y-4 xl:flex xl:gap-0",
    lg: "grid grid-cols-2 gap-x-4 gap-y-4 lg:flex lg:gap-0",
};
const ITEM: Record<OneRowFrom, string> = {
    xl: "xl:flex-auto xl:px-5 xl:border-l xl:border-ink-700 xl:first:border-l-0 xl:first:pl-0 xl:last:pr-0",
    lg: "lg:flex-auto lg:px-5 lg:border-l lg:border-ink-700 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0",
};
const VALUE_SIZE = {20: "text-[20px]", 19: "text-[19px]"} as const;

const FromCtx = createContext<OneRowFrom>("xl");

export function StatsBand({oneRowFrom = "xl", className = "", children}: {oneRowFrom?: OneRowFrom; className?: string; children: ReactNode}) {
    return (
        <FromCtx.Provider value={oneRowFrom}>
            <div className={`bg-ink-900 border border-ink-700 rounded-[14px] px-4 sm:px-5 py-[18px] ${BAND[oneRowFrom]} min-w-0 ${className}`}>{children}</div>
        </FromCtx.Provider>
    );
}

/** One item: label over the value. `size` is the value's font size in px. */
export function StatsItem({label, size = 20, className = "", children}: {label: string; size?: keyof typeof VALUE_SIZE; className?: string; children: ReactNode}) {
    const from = useContext(FromCtx);
    return (
        <div className={`min-w-0 ${ITEM[from]} ${className}`}>
            <div className="text-[12px] text-hanji-400 mb-1">{label}</div>
            <div className={`num ${VALUE_SIZE[size]} font-medium text-hanji-100 flex flex-wrap items-baseline gap-x-1.5 break-all`}>{children}</div>
        </div>
    );
}
