// GET /api/chain/holders?curve=0x..: top 50 balances from indexed transfers, labelled, plus the
// token page's trust signals (decision 51, `signals`; see db.holderSignals). An unknown curve
// answers no holders and signals null.
import {badRequest, chainGet} from "../_lib/chainApi.js";
import {curveRow, holders, holderSignals} from "../_lib/db.js";
import {holderLabel, parseCurve} from "../_lib/indexer.js";

const h = chainGet("holders", {params: ["curve"]}, async (sql, p) => {
    const curve = parseCurve(p.get("curve"));
    if (!curve) return badRequest;
    const c = await curveRow(sql, curve);
    if (!c) return {status: 200, body: {total: 0, holders: [], signals: null}};
    const exclude = [curve, ...(c.pool ? [c.pool] : [])];
    const [r, signals] = await Promise.all([holders(sql, c.token, exclude), holderSignals(sql, {curve, token: c.token, dev: c.dev, pool: c.pool})]);
    return {
        status: 200,
        body: {total: r.total, holders: r.rows.map((x) => ({...x, label: holderLabel(x.address, {curve, pool: c.pool, dev: c.dev})})), signals},
    };
});
export const GET = h.GET;
export const OPTIONS = h.OPTIONS;
