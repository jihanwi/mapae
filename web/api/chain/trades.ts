// GET /api/chain/trades?curve=0x..&before=<ts>&limit=<=50: newest first.
import {badRequest, chainGet} from "../_lib/chainApi.js";
import {trades} from "../_lib/db.js";
import {parseBefore, parseCurve, parseLimit} from "../_lib/indexer.js";

const h = chainGet("trades", async (sql, p) => {
    const curve = parseCurve(p.get("curve"));
    const before = parseBefore(p.get("before"));
    const limit = parseLimit(p.get("limit"));
    if (!curve || before === null || limit === null) return badRequest;
    return {status: 200, body: {trades: await trades(sql, curve, before, limit)}};
});
export const GET = h.GET;
export const OPTIONS = h.OPTIONS;
