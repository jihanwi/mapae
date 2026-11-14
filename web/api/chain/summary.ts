// GET /api/chain/summary: indexer position and per-curve 24 h numbers.
import {chainGet} from "../_lib/chainApi.js";
import {readState, summary} from "../_lib/db.js";

const h = chainGet("summary", async (sql) => {
    const since = Math.floor(Date.now() / 1000) - 86_400;
    const [state, rows] = await Promise.all([readState(sql), summary(sql, since)]);
    const curves: Record<string, Omit<(typeof rows)[number], "curve">> = {};
    for (const {curve, ...rest} of rows) curves[curve] = rest;
    return {status: 200, body: {indexedBlock: state.indexedBlock, indexedTs: state.indexedTs, curves}};
});
export const GET = h.GET;
export const OPTIONS = h.OPTIONS;
