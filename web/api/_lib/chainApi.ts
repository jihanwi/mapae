// Shared wrapper for the /api/chain/* GET endpoints: CORS, the cache header, and 503 on failure.
import {cors, forbiddenOrigin, json, preflight} from "./http.js";
import {getSql, Sql} from "./db.js";

export const CHAIN_CACHE = "s-maxage=120, stale-while-revalidate=600";
/** /api/chain/summary carries the indexer position (the client's data version): kept short. */
export const SUMMARY_CACHE = "s-maxage=15, stale-while-revalidate=60";

/** `v` is the client's data version (indexedBlock), a cache key only: digits, at most 20. */
const VERSION_RE = /^\d{1,20}$/;

/** True when every query parameter is one of `allowed` or a well-formed `v`. */
export function paramsAllowed(params: URLSearchParams, allowed: readonly string[]): boolean {
    for (const [k, val] of params) {
        if (k === "v") {
            if (!VERSION_RE.test(val)) return false;
        } else if (!allowed.includes(k)) {
            return false;
        }
    }
    return true;
}

export type ChainGetOpts = {
    /** Query parameters this endpoint reads (besides `v`); anything else is a 400. */
    params: readonly string[];
    cache?: string;
};

export type Answer = {status: number; body: unknown};

export function chainGet(name: string, opts: ChainGetOpts, run: (sql: Sql, params: URLSearchParams) => Promise<Answer>) {
    return {
        GET: async (request: Request): Promise<Response> => {
            const c = cors(request);
            if (!c.allowed) return forbiddenOrigin(c);
            const params = new URL(request.url).searchParams;
            if (!paramsAllowed(params, opts.params)) return json(400, {error: "bad_request"}, c.headers);
            try {
                const r = await run(getSql(), params);
                const cache: Record<string, string> = r.status === 200 ? {"Cache-Control": opts.cache ?? CHAIN_CACHE} : {};
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
