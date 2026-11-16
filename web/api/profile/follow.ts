// POST /api/profile/follow {action: "follow" | "unfollow", target, wallet, session, proof}:
// follow or unfollow a wallet with the 7-day session (decision 53). Follows are public.
// GET /api/profile/follow?wallet=0x..[&viewer=0x..] -> {followers, following, isFollowing}
// followers counts only follows made while the follower was verified; isFollowing is present
// only with a viewer. A missing table or column is created once (withSchemaRetry).
import * as db from "../_lib/db.js";
import {paramsAllowed} from "../_lib/chainApi.js";
import {cors, forbiddenOrigin, json} from "../_lib/http.js";
import {handleFollow} from "../_lib/social.js";
import {followDeps, socialPost} from "../_lib/socialApi.js";

const post = socialPost("profile/follow", async (body) => {
    const sql = db.getSql();
    // a write before the cron migrated: create the table, then run the action
    return db.withSchemaRetry("profile/follow POST", () => handleFollow(body, followDeps(sql)), () => db.ensureSchema(sql));
});
export const POST = post.POST;
export const OPTIONS = post.OPTIONS;

const ADDR = /^0x[0-9a-fA-F]{40}$/;

export async function GET(request: Request): Promise<Response> {
    const c = cors(request);
    if (!c.allowed) return forbiddenOrigin(c);
    const p = new URL(request.url).searchParams;
    const wallet = p.get("wallet");
    const viewer = p.get("viewer");
    if (!paramsAllowed(p, ["wallet", "viewer"]) || !wallet || !ADDR.test(wallet) || (viewer !== null && !ADDR.test(viewer))) {
        return json(400, {error: "bad_request"}, c.headers);
    }
    try {
        const sql = db.getSql();
        const r = await db.withSchemaRetry(
            "profile/follow GET",
            () => db.followCounts(sql, wallet.toLowerCase(), viewer === null ? null : viewer.toLowerCase()),
            () => db.ensureSchema(sql)
        );
        const body = viewer === null ? {followers: r.followers, following: r.following} : r;
        return json(200, body, {...c.headers, "Cache-Control": "s-maxage=15"});
    } catch (e) {
        console.error("profile/follow GET failed", e);
        return json(503, {error: "unavailable"}, c.headers);
    }
}
