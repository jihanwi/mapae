// Shared wrapper for the /api/chain/* GET endpoints: CORS, the cache header, and 503 on failure.
import {cors, forbiddenOrigin, json, preflight} from "./http.js";
import {getSql, Sql} from "./db.js";

export const CHAIN_CACHE = "s-maxage=120, stale-while-revalidate=600";

export type Answer = {status: number; body: unknown};

export function chainGet(name: string, run: (sql: Sql, params: URLSearchParams) => Promise<Answer>) {
    return {
        GET: async (request: Request): Promise<Response> => {
            const c = cors(request);
            if (!c.allowed) return forbiddenOrigin(c);
            const params = new URL(request.url).searchParams;
            try {
                const r = await run(getSql(), params);
                const cache: Record<string, string> = r.status === 200 ? {"Cache-Control": CHAIN_CACHE} : {};
                return json(r.status, r.body, {...c.headers, ...cache});
            } catch (e) {
                console.error(`chain/${name} failed`, e);
                return json(503, {error: "unavailable"}, c.headers);
            }
        },
        OPTIONS: (request: Request): Response => preflight(request),
    };
}

export const badRequest: Answer = {status: 400, body: {error: "bad_request"}};
