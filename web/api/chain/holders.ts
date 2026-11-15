// GET /api/chain/holders?curve=0x..: top 50 balances from indexed transfers, labelled.
import {badRequest, chainGet} from "../_lib/chainApi.js";
import {curveRow, holders} from "../_lib/db.js";
import {holderLabel, parseCurve} from "../_lib/indexer.js";

const h = chainGet("holders", {params: ["curve"]}, async (sql, p) => {
    const curve = parseCurve(p.get("curve"));
    if (!curve) return badRequest;
    const c = await curveRow(sql, curve);
    if (!c) return {status: 200, body: {total: 0, holders: []}};
    const exclude = [curve, ...(c.pool ? [c.pool] : [])];
    const r = await holders(sql, c.token, exclude);
    return {
        status: 200,
        body: {total: r.total, holders: r.rows.map((x) => ({...x, label: holderLabel(x.address, {curve, pool: c.pool, dev: c.dev})}))},
    };
});
export const GET = h.GET;
export const OPTIONS = h.OPTIONS;
