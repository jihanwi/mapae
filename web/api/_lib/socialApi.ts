// Wiring for the nickname/comment functions: CORS, JSON body, the real DB and chain, error logging.
import * as db from "./db.js";
import {socialChain} from "./chain.js";
import {cors, forbiddenOrigin, json, preflight} from "./http.js";
import type {Result, SocialDeps} from "./social.js";

export const MAX_SOCIAL_BODY = 16 * 1024;

export function socialDeps(sql: db.Sql): SocialDeps {
    return {
        db: {
            ensureSchema: () => db.ensureSchema(sql),
            nicknameOf: (a) => db.nicknameOf(sql, a),
            setNickname: (a, n, l) => db.setNickname(sql, a, n, l),
            nicknameTakenByOther: (l, a) => db.nicknameTakenByOther(sql, l, a),
            curveKnown: (c) => db.curveKnown(sql, c),
            commentRate: (a) => db.commentRate(sql, a),
            insertComment: (c, a, b) => db.insertComment(sql, c, a, b),
            deleteComment: (i, a) => db.deleteComment(sql, i, a),
            hideComment: (i, h) => db.hideComment(sql, i, h),
            listComments: (c, b, l) => db.listComments(sql, c, b, l),
        },
        chain: socialChain(),
        nowSec: Math.floor(Date.now() / 1000),
    };
}

/** POST handler: same-origin/Pages CORS, small JSON body, 503 + console.error on failures. */
export function socialPost(name: string, run: (body: unknown, request: Request) => Promise<Result>) {
    return {
        POST: async (request: Request): Promise<Response> => {
            const c = cors(request);
            if (!c.allowed) return forbiddenOrigin(c);
            let body: unknown;
            try {
                const text = await request.text();
                if (text.length > MAX_SOCIAL_BODY) return json(413, {error: "bad_request"}, c.headers);
                body = JSON.parse(text);
            } catch {
                return json(400, {error: "bad_request"}, c.headers);
            }
            try {
                const r = await run(body, request);
                return json(r.status, r.body, c.headers);
            } catch (e) {
                console.error(`${name} failed`, e);
                return json(503, {error: "unavailable"}, c.headers);
            }
        },
        OPTIONS: (request: Request): Response => preflight(request),
    };
}
