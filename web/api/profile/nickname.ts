// GET /api/profile/nickname?wallet=0x..  -> {nickname: string | null}
// POST /api/profile/nickname            -> set or change the nickname (verified wallets, 7-day cooldown)
import * as db from "../_lib/db.js";
import {cors, forbiddenOrigin, json} from "../_lib/http.js";
import {handleSetNickname} from "../_lib/social.js";
import {socialDeps, socialPost} from "../_lib/socialApi.js";

const post = socialPost("profile/nickname", async (body) => {
    const sql = db.getSql();
    return handleSetNickname(body, socialDeps(sql));
});
export const POST = post.POST;
export const OPTIONS = post.OPTIONS;

export async function GET(request: Request): Promise<Response> {
    const c = cors(request);
    if (!c.allowed) return forbiddenOrigin(c);
    const wallet = new URL(request.url).searchParams.get("wallet");
    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json(400, {error: "bad_request"}, c.headers);
    try {
        // Reads never create tables: a missing table is a 503, not an empty answer.
        const n = await db.nicknameOf(db.getSql(), wallet.toLowerCase());
        return json(200, {nickname: n?.nickname ?? null}, {...c.headers, "Cache-Control": "s-maxage=30"});
    } catch (e) {
        console.error("profile/nickname GET failed", e);
        return json(503, {error: "unavailable"}, c.headers);
    }
}
