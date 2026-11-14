// POST /api/meta/reindex: rebuild meta/91342/index.json from the per-curve records.
// Requires the x-admin-token header to equal ADMIN_TOKEN; without ADMIN_TOKEN it always returns 403.
import {blobStore} from "../_lib/blobStore.js";
import {handleReindex} from "../_lib/handler.js";
import {json} from "../_lib/http.js";

export async function POST(request: Request): Promise<Response> {
    const r = await handleReindex(request.headers.get("x-admin-token"), process.env.ADMIN_TOKEN, {store: blobStore});
    return json(r.status, r.body);
}
