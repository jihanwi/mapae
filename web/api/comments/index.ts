// GET /api/comments?curve=0x..&before=<id>&limit=<=50 (newest first; each comment carries its
// author address, nicknames being a public profile)
// POST /api/comments (verified wallets with a nickname)
import * as db from "../_lib/db.js";
import {cors, forbiddenOrigin, json} from "../_lib/http.js";
import {handlePostComment, parseCommentQuery} from "../_lib/social.js";
import {socialDeps, socialPost} from "../_lib/socialApi.js";

const post = socialPost("comments POST", async (body) => handlePostComment(body, socialDeps(db.getSql())));
export const POST = post.POST;
export const OPTIONS = post.OPTIONS;

export async function GET(request: Request): Promise<Response> {
    const c = cors(request);
    if (!c.allowed) return forbiddenOrigin(c);
    const q = parseCommentQuery(new URL(request.url).searchParams);
    if (!q) return json(400, {error: "bad_request"}, c.headers);
    try {
        const comments = await db.listComments(db.getSql(), q.curve, q.before, q.limit);
        const nextBefore = comments.length === q.limit ? comments[comments.length - 1].id : null;
        return json(200, {comments, nextBefore}, {...c.headers, "Cache-Control": "s-maxage=15, stale-while-revalidate=60"});
    } catch (e) {
        console.error("comments GET failed", e);
        return json(503, {error: "unavailable"}, c.headers);
    }
}
