// GET /api/cron/index (Vercel Cron, every 15 min): index CurveCreated, Buy/Sell/Graduated,
// Swapped and token Transfers into Neon. CRON_SECRET is checked before anything else.
import {ADDR_V3} from "../../src/contracts/addressesV3.js";
import * as db from "../_lib/db.js";
import {cronAuthorized, runCron} from "../_lib/indexer.js";
import {json} from "../_lib/http.js";
import {giwaRpc} from "../_lib/rpc.js";

export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
    const authorization = request.headers.get("authorization");
    const secret = process.env.CRON_SECRET;
    if (!cronAuthorized(authorization, secret)) return json(401, {ok: false, error: "unauthorized"});
    let sql: db.Sql;
    try {
        sql = db.getSql();
    } catch (e) {
        console.error("cron: database unavailable", e);
        return json(503, {ok: false, error: "unavailable"});
    }
    try {
        const r = await runCron(authorization, secret, {
            db: {
                ensureSchema: () => db.ensureSchema(sql),
                readNextBlock: () => db.readNextBlock(sql),
                loadCurves: () => db.loadCurves(sql),
                writeRange: (w) => db.writeRange(sql, w),
            },
            rpc: giwaRpc(),
            nowMs: () => Date.now(),
            factory: ADDR_V3.curveFactory,
            deployBlock: ADDR_V3.deployBlock,
        });
        return json(r.status, r.body);
    } catch (e) {
        // ensureSchema / readNextBlock / loadCurves / head failures (before any range)
        console.error("cron: failed before indexing", e);
        return json(500, {ok: false, error: "failed"});
    }
}
