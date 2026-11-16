// GET /api/profile/nicknames?addresses=0x..,0x.. (at most 100, deduped, lowercase)
//   -> {nicknames: {"0x..": "nickname"}}; addresses without a nickname are absent.
// Nicknames are a public profile (owner decision 2026-11-15). One query per request.
import * as db from "../_lib/db.js";
import {cors, forbiddenOrigin, json, preflight} from "../_lib/http.js";

export const NICKNAMES_MAX = 100;

/** Comma-separated addresses -> deduped lowercase list; null when missing, empty, malformed or > 100. */
export function parseAddresses(raw: string | null): string[] | null {
    if (!raw) return null;
    const parts = raw.split(",");
    if (parts.some((p) => !/^0x[0-9a-fA-F]{40}$/.test(p))) return null;
    const list = [...new Set(parts.map((p) => p.toLowerCase()))];
    return list.length === 0 || list.length > NICKNAMES_MAX ? null : list;
}

export async function GET(request: Request): Promise<Response> {
    const c = cors(request);
    if (!c.allowed) return forbiddenOrigin(c);
    const list = parseAddresses(new URL(request.url).searchParams.get("addresses"));
    if (!list) return json(400, {error: "bad_request"}, c.headers);
    try {
        const sql = db.getSql();
        const rows = await db.withSchemaRetry("profile/nicknames GET", () => db.nicknamesOf(sql, list), () => db.ensureSchema(sql));
        const nicknames: Record<string, string> = {};
        for (const r of rows) nicknames[r.address] = r.nickname;
        return json(200, {nicknames}, {...c.headers, "Cache-Control": "s-maxage=60, stale-while-revalidate=300"});
    } catch (e) {
        console.error("profile/nicknames GET failed", e);
        return json(503, {error: "unavailable"}, c.headers);
    }
}

export const OPTIONS = (request: Request): Response => preflight(request);
