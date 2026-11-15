// GET /api/chain/summary?window=3600|86400: indexer position and per-curve numbers for the window
// (default 86400). Field names (trades24h, ...) are kept for any window; `window` is echoed.
// Short CDN cache (15 s): its indexedBlock is the client's data version for the other endpoints.
//
// POST /api/chain/summary (no body): on-demand catch-up (STATUS 결정 47). Indexes at most one range
// (9,000 blocks, 8 s budget), at most once per 20 s across all callers (claim on the cursor row);
// otherwise just answers the current position. 200 {indexedBlock, ran}, 503 on failure, no-store.
import {badRequest, chainGet, SUMMARY_CACHE} from "../_lib/chainApi.js";
import {claimPoke, ensureSchema, getSql, readState, summary} from "../_lib/db.js";
import {cors, forbiddenOrigin, json} from "../_lib/http.js";
import {indexOnce, POKE_INDEX_OPTS} from "../_lib/indexer.js";
import {cronDeps} from "../_lib/cronDeps.js";
import {handlePoke} from "../_lib/poke.js";
import {ADDR_V3} from "../../src/contracts/addressesV3.js";

export const SUMMARY_WINDOWS = [3600, 86_400] as const;
export type SummaryWindow = (typeof SUMMARY_WINDOWS)[number];

/** `window` query value -> seconds; null for anything but the allowed values (omitted = 86400). */
export function parseWindow(raw: string | null): SummaryWindow | null {
    if (raw === null) return 86_400;
    return SUMMARY_WINDOWS.find((w) => String(w) === raw) ?? null;
}

export const maxDuration = 15;

const h = chainGet("summary", {params: ["window"], cache: SUMMARY_CACHE}, async (sql, params) => {
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

export async function POST(request: Request): Promise<Response> {
    const c = cors(request);
    if (!c.allowed) return forbiddenOrigin(c);
    const noStore = {...c.headers, "Cache-Control": "no-store"};
    try {
        const sql = getSql();
        const r = await handlePoke({
            claim: (now) => claimPoke(sql, now),
            ensureSchema: () => ensureSchema(sql),
            index: () => indexOnce(cronDeps(sql), POKE_INDEX_OPTS),
            indexedBlock: async () => (await readState(sql)).indexedBlock,
            nowMs: () => Date.now(),
        });
        return json(200, r, noStore);
    } catch (e) {
        console.error("chain/summary POST (catch-up) failed", e);
        return json(503, {error: "unavailable"}, noStore);
    }
}
