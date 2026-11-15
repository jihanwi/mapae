// GET /t/:curve (vercel.json rewrite to /api/meta?share=:curve): a small HTML page with Open Graph
// and Twitter Card tags for link previews, then a meta refresh into the app (/#/t/<curve>).
// No script. Name and ticker from the index DB; description and image from the metadata store
// (ignored for hidden curves, which the store's index already drops).
import type {IndexEntry} from "./handler.js";

const CURVE_RE = /^0x[0-9a-fA-F]{40}$/;
export const SHARE_CACHE = "s-maxage=300, stale-while-revalidate=3600";
const SITE_DESCRIPTION = "첫 10분은 실명 지갑만 삽니다. 봇이 먼저 사는 런치가 없습니다.";

const ESC: Record<string, string> = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"};
/** Escapes & < > " ' for HTML text and double- or single-quoted attributes. */
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (ch) => ESC[ch]);

/** Lowercase curve address, or null when the parameter is not a 20-byte hex address. */
export function parseShareCurve(raw: string | null): string | null {
    return raw !== null && CURVE_RE.test(raw) ? raw.toLowerCase() : null;
}

export type ShareInfo = {curve: string; name: string; symbol: string; meta: IndexEntry | undefined};

/** The preview page. `origin` is the deployment origin (https://host), used for absolute URLs. */
export function shareHtml(origin: string, s: ShareInfo): string {
    const title = `${s.name} (${s.symbol}) | MAPAE`;
    const description = s.meta?.description.trim() ? s.meta.description.trim() : SITE_DESCRIPTION;
    const image = s.meta?.imageUrl && /^https:\/\//.test(s.meta.imageUrl) ? s.meta.imageUrl : `${origin}/logo.png`;
    const page = `${origin}/t/${s.curve}`;
    const app = `/#/t/${s.curve}`;
    const e = escapeHtml;
    return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${e(title)}</title>
<meta name="description" content="${e(description)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="MAPAE" />
<meta property="og:title" content="${e(title)}" />
<meta property="og:description" content="${e(description)}" />
<meta property="og:url" content="${e(page)}" />
<meta property="og:image" content="${e(image)}" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${e(title)}" />
<meta name="twitter:description" content="${e(description)}" />
<meta name="twitter:image" content="${e(image)}" />
<meta http-equiv="refresh" content="0;url=${e(app)}" />
</head>
<body>
<p><a href="${e(app)}">${e(title)}</a></p>
</body>
</html>
`;
}

export type ShareDeps = {
    curveName(curve: string): Promise<{name: string; symbol: string} | null>;
    /** The public metadata index (hidden curves removed); {} when the store fails. */
    metaIndex(): Promise<Record<string, IndexEntry>>;
};

/** 302 to / for a malformed or unknown curve; 302 into the app (no preview) when the DB fails. */
export async function handleShare(raw: string | null, origin: string, deps: ShareDeps): Promise<Response> {
    const curve = parseShareCurve(raw);
    if (!curve) return new Response(null, {status: 302, headers: {Location: "/", "Cache-Control": SHARE_CACHE}});
    let found: {name: string; symbol: string} | null;
    try {
        found = await deps.curveName(curve);
    } catch (e) {
        console.error("share: curve lookup failed", e);
        return new Response(null, {status: 302, headers: {Location: `/#/t/${curve}`, "Cache-Control": "no-store"}});
    }
    if (!found) return new Response(null, {status: 302, headers: {Location: "/", "Cache-Control": SHARE_CACHE}});
    let meta: IndexEntry | undefined;
    try {
        meta = (await deps.metaIndex())[curve];
    } catch (e) {
        console.error("share: metadata lookup failed", e);
    }
    return new Response(shareHtml(origin, {curve, ...found, meta}), {status: 200, headers: {"content-type": "text/html; charset=utf-8", "Cache-Control": SHARE_CACHE}});
}
