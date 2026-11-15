// GET /api/chain/summary?window=3600|86400: indexer position and per-curve numbers for the window
// (default 86400). Field names (trades24h, ...) are kept for any window; `window` is echoed.
import {badRequest, chainGet} from "../_lib/chainApi.js";
import {readState, summary} from "../_lib/db.js";
import {ADDR_V3} from "../../src/contracts/addressesV3.js";

export const SUMMARY_WINDOWS = [3600, 86_400] as const;
export type SummaryWindow = (typeof SUMMARY_WINDOWS)[number];

/** `window` query value -> seconds; null for anything but the allowed values (omitted = 86400). */
export function parseWindow(raw: string | null): SummaryWindow | null {
    if (raw === null) return 86_400;
    return SUMMARY_WINDOWS.find((w) => String(w) === raw) ?? null;
}

const h = chainGet("summary", async (sql, params) => {
    const window = parseWindow(params.get("window"));
    if (window === null) return badRequest;
    const since = Math.floor(Date.now() / 1000) - window;
    const [state, rows] = await Promise.all([readState(sql), summary(sql, since, ADDR_V3.curveFactory)]);
    const curves: Record<string, Omit<(typeof rows)[number], "curve">> = {};
    for (const {curve, ...rest} of rows) curves[curve] = rest;
    return {status: 200, body: {indexedBlock: state.indexedBlock, indexedTs: state.indexedTs, window, curves}};
});
export const GET = h.GET;
export const OPTIONS = h.OPTIONS;
