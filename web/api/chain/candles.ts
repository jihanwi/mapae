// GET /api/chain/candles?curve=0x..&interval=300|3600|86400: latest 300 non-empty buckets.
import {badRequest, chainGet} from "../_lib/chainApi.js";
import {candles} from "../_lib/db.js";
import {parseCurve, parseInterval} from "../_lib/indexer.js";

const h = chainGet("candles", {params: ["curve", "interval"]}, async (sql, p) => {
    const curve = parseCurve(p.get("curve"));
    const interval = parseInterval(p.get("interval"));
    if (!curve || !interval) return badRequest;
    return {status: 200, body: await candles(sql, curve, interval)};
});
export const GET = h.GET;
export const OPTIONS = h.OPTIONS;
