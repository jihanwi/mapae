// GET /api/chain/flow?curve=0x..: non-Dev buys and sells of the last 24 h, distinct verified buyers
// and sellers, and how many curves this curve's Dev launched (same factory). Not indexed -> zeros.
import {badRequest, chainGet} from "../_lib/chainApi.js";
import {devLaunched, flow} from "../_lib/db.js";
import {parseCurve} from "../_lib/indexer.js";

export const FLOW_WINDOW = 86_400;

const h = chainGet("flow", async (sql, p) => {
    const curve = parseCurve(p.get("curve"));
    if (!curve) return badRequest;
    const since = Math.floor(Date.now() / 1000) - FLOW_WINDOW;
    const [f, launched] = await Promise.all([flow(sql, curve, since), devLaunched(sql, curve)]);
    return {
        status: 200,
        body: {
            window: FLOW_WINDOW,
            buys: {count: f.buyCount, volume: f.buyVolume},
            sells: {count: f.sellCount, volume: f.sellVolume},
            verifiedBuyers: f.verifiedBuyers,
            // sells get `verified` from the per-range lookup (fillVerified); a failed lookup leaves
            // null, which simply does not count here
            verifiedSellers: f.verifiedSellers,
            devLaunched: launched,
        },
    };
});
export const GET = h.GET;
export const OPTIONS = h.OPTIONS;
