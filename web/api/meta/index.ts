// GET /api/meta: public index of curve metadata (hidden curves removed).
// POST /api/meta: save a curve's image, description and links, signed by its Dev. Never overwrites.
import {blobStore} from "../_lib/blobStore.js";
import {giwaChain} from "../_lib/chain.js";
import {handleGetMeta, handlePostMeta} from "../_lib/handler.js";
import {cors, forbiddenOrigin, json, MAX_BODY, preflight} from "../_lib/http.js";

// POST may wait up to ~4.5 s for the RPC to see a just-launched curve (see handler.ts).
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
    const c = cors(request);
    if (!c.allowed) return forbiddenOrigin(c);
    const r = await handleGetMeta({store: blobStore});
    const cache: Record<string, string> = r.status === 200 ? {"Cache-Control": "s-maxage=15, stale-while-revalidate=60"} : {};
    return json(r.status, r.body, {...c.headers, ...cache});
}

export async function POST(request: Request): Promise<Response> {
    const c = cors(request);
    if (!c.allowed) return forbiddenOrigin(c);
    let body: unknown;
    try {
        const text = await request.text();
        if (text.length > MAX_BODY) return json(413, {error: "image_too_large"}, c.headers);
        body = JSON.parse(text);
    } catch {
        return json(400, {error: "bad_request"}, c.headers);
    }
    try {
        const r = await handlePostMeta(body, {store: blobStore, chain: giwaChain(), nowMs: Date.now()});
        return json(r.status, r.body, c.headers);
    } catch {
        return json(503, {error: "temporary"}, c.headers);
    }
}

export function OPTIONS(request: Request): Response {
    return preflight(request);
}
