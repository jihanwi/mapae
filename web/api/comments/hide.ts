// POST /api/comments/hide (operator): Authorization: Bearer <CRON_SECRET>, checked first.
import * as db from "../_lib/db.js";
import {json} from "../_lib/http.js";
import {handleHideComment} from "../_lib/social.js";

export async function POST(request: Request): Promise<Response> {
    const authorization = request.headers.get("authorization");
    const secret = process.env.CRON_SECRET;
    if (!secret || authorization !== `Bearer ${secret}`) return json(401, {error: "unauthorized"});
    let body: unknown;
    try {
        body = JSON.parse(await request.text());
    } catch {
        return json(400, {error: "bad_request"});
    }
    try {
        const sql = db.getSql();
        const r = await handleHideComment(authorization, secret, body, {db: {ensureSchema: () => db.ensureSchema(sql), hideComment: (i, h) => db.hideComment(sql, i, h)}});
        return json(r.status, r.body);
    } catch (e) {
        console.error("comments/hide failed", e);
        return json(503, {error: "unavailable"});
    }
}
