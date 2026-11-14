// Web-standard Request/Response helpers: JSON responses and the CORS policy.
// Allowed: same origin (no Origin header, or Origin equal to this host) and GitHub Pages.
export const PAGES_ORIGIN = "https://jihanwi.github.io";

export type Cors = {allowed: boolean; headers: Record<string, string>};

export function cors(request: Request): Cors {
    const origin = request.headers.get("origin");
    const vary = {Vary: "Origin"};
    if (!origin) return {allowed: true, headers: vary};
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
    let originHost: string;
    try {
        originHost = new URL(origin).host;
    } catch {
        return {allowed: false, headers: vary};
    }
    if (originHost === host) return {allowed: true, headers: vary};
    if (origin === PAGES_ORIGIN) {
        return {
            allowed: true,
            headers: {...vary, "Access-Control-Allow-Origin": PAGES_ORIGIN, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "content-type"},
        };
    }
    return {allowed: false, headers: vary};
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json; charset=utf-8", ...headers}});
}

export const forbiddenOrigin = (c: Cors) => json(403, {error: "forbidden"}, c.headers);

export function preflight(request: Request): Response {
    const c = cors(request);
    return c.allowed ? new Response(null, {status: 204, headers: {...c.headers, "Access-Control-Max-Age": "600"}}) : forbiddenOrigin(c);
}

/** Body limit before JSON parsing (400 KB image as base64 + fields). */
export const MAX_BODY = 600 * 1024;
