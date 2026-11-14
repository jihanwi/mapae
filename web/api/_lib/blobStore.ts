// Store backed by Vercel Blob (public store; BLOB_READ_WRITE_TOKEN is read by @vercel/blob itself).
import {BlobNotFoundError, get, head, list, put} from "@vercel/blob";
import type {Store} from "./handler.js";

export const blobStore: Store = {
    async getJson(path) {
        // useCache false: index.json is rewritten in place, so read the latest from origin.
        const r = await get(path, {access: "public", useCache: false});
        if (!r || r.statusCode !== 200) return null;
        return JSON.parse(await new Response(r.stream).text());
    },
    async exists(path) {
        try {
            await head(path);
            return true;
        } catch (e) {
            if (e instanceof BlobNotFoundError) return false;
            throw e;
        }
    },
    async put(path, body, contentType, opts) {
        const data = typeof body === "string" ? body : new Blob([new Uint8Array(body)], {type: contentType});
        const r = await put(path, data, {
            access: "public",
            addRandomSuffix: false,
            allowOverwrite: opts.overwrite,
            contentType,
            ...(opts.maxAge !== undefined ? {cacheControlMaxAge: opts.maxAge} : {}),
        });
        return {url: r.url};
    },
    async list(prefix) {
        const out: string[] = [];
        let cursor: string | undefined;
        do {
            const page = await list({prefix, cursor});
            out.push(...page.blobs.map((b) => b.pathname));
            cursor = page.hasMore ? page.cursor : undefined;
        } while (cursor);
        return out;
    },
};
