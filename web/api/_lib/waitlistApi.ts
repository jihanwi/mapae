// Waitlist requests (W-T43). Server side (Web Crypto: HMAC-SHA256, SHA-256, getRandomValues). The X calls (`fetch`) and the store are
// injected, so the whole flow is tested with fake responses (waitlist.test.ts); api/waitlist/index.ts
// wires the real ones.
//
// GET  ?action=start[&ref][&lang]   -> 302 to X (state + PKCE S256 in a signed 10 min cookie)
// GET  ?action=callback&code&state   -> token, users/me once, join, session cookie, 302 /#/waitlist
// GET  ?action=land[&ref][&lang]     -> 302 /#/waitlist (the /waitlist rewrite)
// GET  ?share=<code>                  -> link preview HTML (no DB read)
// GET  (no params)                    -> my state (private, no-store)
// GET  ?stats=1 (Bearer CRON_SECRET)  -> operator stats (W-T72, checked before the flag)
// POST {action: wallet | email | email-remove | logout | mission (W-T70)}
import {isAddress, recoverMessageAddress} from "viem";
import {cors, forbiddenOrigin, json} from "./http.js";
import {paramsAllowed} from "./chainApi.js";
import type {WaitlistJoin, WaitlistMe, WaitlistRank, WaitlistStats} from "./db.js";
import {
    appPath,
    authorizeUrl,
    emailConfig,
    followUrl,
    isMission,
    Mission,
    pointsConfig,
    POINT_WEIGHTS,
    pointsOf,
    repostUrl,
    isRefCode,
    isWaitlistLang,
    maskEmail,
    normalizeEmail,
    OAUTH_COOKIE,
    OAUTH_TTL_SEC,
    redirectUri,
    refCodeFrom,
    SESSION_COOKIE,
    SESSION_TTL_SEC,
    shareUrl,
    walletMessage,
    waitlistConfig,
    WaitlistConfig,
    WaitlistEnv,
    waitlistShareHtml,
    shareImage,
    X_ME,
    X_TOKEN,
} from "./waitlist.js";

export type WaitlistStore = {
    join(j: WaitlistJoin): Promise<{inserted: boolean} | "ref_code_taken">;
    me(xid: string, rank: WaitlistRank): Promise<WaitlistMe | null>;
    setWallet(xid: string, wallet: string): Promise<"ok" | "taken" | "no_account">;
    setEmail(xid: string, email: string): Promise<boolean>;
    removeEmail(xid: string): Promise<void>;
    /** W-T52: the line number of the account with this referral code, null when none. */
    positionByCode(code: string, rank: WaitlistRank): Promise<number | null>;
    /** W-T70: records a mission's first press; false when the account row is gone. */
    setMission(xid: string, mission: Mission): Promise<boolean>;
    /** W-T72: the operator's aggregate view (no ids, codes, wallets or emails). */
    stats(): Promise<WaitlistStats>;
};

export type WaitlistDeps = {
    env: WaitlistEnv;
    /** Opened only when a request needs the database. */
    store: () => WaitlistStore;
    fetch: typeof fetch;
    nowSec: () => number;
    random?: (n: number) => Uint8Array;
    /** W-T52: the card PNG for a line number (waitlistCard.ts in production). */
    renderCard?: (position: number) => Promise<Uint8Array>;
};

export const MAX_REF_DRAWS = 5;
const MAX_POST = 4 * 1024;
const NO_STORE = {"Cache-Control": "private, no-store"};
/** W-T72: the operator stats answer (spec: Cache-Control: no-store). */
const NO_STORE_ONLY = {"Cache-Control": "no-store"};
const SHARE_CACHE = "s-maxage=300, stale-while-revalidate=3600";
/** W-T52: a card shows the number at render time; a new number appears within about 5 minutes. */
export const CARD_CACHE = "public, s-maxage=300, stale-while-revalidate=600";

// ---------------------------------------------------------------------------------------------
// Signed cookies: base64url(JSON payload) "." base64url(HMAC-SHA256(secret, payload part))
// ---------------------------------------------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
    if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
    try {
        const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
        return Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } catch {
        return null;
    }
}

const hmacKey = (secret: string, use: "sign" | "verify") =>
    crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, [use]);

export async function signCookie(payload: object, secret: string): Promise<string> {
    const body = b64url(enc.encode(JSON.stringify(payload)));
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(body)));
    return `${body}.${b64url(mac)}`;
}

/** The payload when the signature matches and `exp` is in the future. The MAC check is
 *  crypto.subtle.verify, which compares in constant time (the Web Crypto form of timingSafeEqual). */
export async function verifyCookie<T extends {exp: number}>(value: string | undefined, secret: string, nowSec: number): Promise<T | null> {
    if (!value) return null;
    const dot = value.indexOf(".");
    if (dot <= 0 || dot !== value.lastIndexOf(".")) return null;
    const body = value.slice(0, dot);
    const mac = fromB64url(value.slice(dot + 1));
    if (!mac || mac.length !== 32) return null;
    if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), new Uint8Array(mac), enc.encode(body)))) return null;
    const raw = fromB64url(body);
    if (!raw) return null;
    let p: unknown;
    try {
        p = JSON.parse(dec.decode(raw));
    } catch {
        return null;
    }
    const exp = (p as {exp?: unknown} | null)?.exp;
    if (typeof exp !== "number" || exp <= nowSec) return null;
    return p as T;
}

/** Constant-time equality of two strings of the same length (the OAuth state). */
export function sameString(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
}

export function readCookie(request: Request, name: string): string | undefined {
    const header = request.headers.get("cookie") ?? "";
    for (const part of header.split(";")) {
        const i = part.indexOf("=");
        if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
    return undefined;
}

export const setCookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
export const clearCookie = (name: string) => `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export type SessionPayload = {xid: string; exp: number};
export type OAuthPayload = {state: string; verifier: string; ref: string | null; lang: string | null; exp: number};

/** PKCE: a 43-character verifier and its S256 challenge (RFC 7636). */
export async function pkcePair(random: (n: number) => Uint8Array): Promise<{verifier: string; challenge: string}> {
    const verifier = b64url(random(32));
    return {verifier, challenge: b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))))};
}

const defaultRandom = (n: number) => crypto.getRandomValues(new Uint8Array(n));

// ---------------------------------------------------------------------------------------------
// X (Authorization Code with PKCE, confidential client)
// ---------------------------------------------------------------------------------------------

export type XUser = {id: string; username: string; createdAt: string | null; followers: number | null};

const X_FIELD_MAX = 200;
/** A string value cut to 200 characters, else null (W-T73: only these go into the logs). */
const xStr = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, X_FIELD_MAX) : null);

export type XErrorFields = {
    title: string | null;
    detail: string | null;
    type: string | null;
    reason: string | null;
    first: {title: string | null; detail: string | null; type: string | null; message: string | null} | null;
};

/** W-T73: the reason X gives in an error body, for the log. Only these string fields (each cut to
 *  200 characters), never the whole body, its `data`, a token or a header. */
export function xErrorFields(body: unknown): XErrorFields {
    const b = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const errors = b && Array.isArray(b.errors) ? b.errors : null;
    const e0 = errors && errors.length > 0 && errors[0] && typeof errors[0] === "object" ? (errors[0] as Record<string, unknown>) : null;
    return {
        title: xStr(b?.title),
        detail: xStr(b?.detail),
        type: xStr(b?.type),
        reason: xStr(b?.reason),
        first: errors ? {title: xStr(e0?.title), detail: xStr(e0?.detail), type: xStr(e0?.type), message: xStr(e0?.message)} : null,
    };
}

/** Token exchange then users/me once. "x" for any X failure (logged without secrets or tokens);
 *  missing id or username in users/me is a failure, missing created_at or followers is stored null. */
export async function xSignIn(cfg: WaitlistConfig, code: string, verifier: string, f: typeof fetch): Promise<XUser | "x"> {
    const basic = btoa(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`);
    let token: string;
    try {
        const r = await f(X_TOKEN, {
            method: "POST",
            headers: {Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded"},
            body: new URLSearchParams({code, grant_type: "authorization_code", redirect_uri: redirectUri(cfg.origin), code_verifier: verifier}).toString(),
        });
        const body = (await r.json().catch(() => null)) as {access_token?: unknown; error?: unknown; error_description?: unknown} | null;
        if (!r.ok || typeof body?.access_token !== "string") {
            console.error("waitlist: X token exchange failed", {status: r.status, error: typeof body?.error === "string" ? body.error : null, errorDescription: xStr(body?.error_description)});
            return "x";
        }
        token = body.access_token;
    } catch (e) {
        console.error("waitlist: X token exchange failed", e);
        return "x";
    }
    try {
        const r = await f(X_ME, {headers: {Authorization: `Bearer ${token}`}});
        const body = (await r.json().catch(() => null)) as {data?: {id?: unknown; username?: unknown; created_at?: unknown; public_metrics?: {followers_count?: unknown}}} | null;
        const d = body?.data;
        if (!r.ok || typeof d?.id !== "string" || typeof d.username !== "string" || !d.id || !d.username) {
            console.error("waitlist: X users/me failed", {status: r.status, hasData: !!d, ...xErrorFields(body)});
            return "x";
        }
        const followers = d.public_metrics?.followers_count;
        return {
            id: d.id,
            username: d.username,
            createdAt: typeof d.created_at === "string" ? d.created_at : null,
            followers: typeof followers === "number" && Number.isFinite(followers) ? Math.trunc(followers) : null,
        };
    } catch (e) {
        console.error("waitlist: X users/me failed", e);
        return "x";
    }
}

// ---------------------------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------------------------

const redirect = (location: string, cookies: string[] = []) => {
    const h = new Headers({Location: location, "Cache-Control": "no-store"});
    for (const c of cookies) h.append("Set-Cookie", c);
    return new Response(null, {status: 302, headers: h});
};

async function card(code: string | null, origin: string, rank: WaitlistRank, deps: WaitlistDeps): Promise<Response> {
    const fallback = () => redirect(shareImage(origin));
    if (!isRefCode(code)) return fallback();
    let position: number | null;
    try {
        position = await deps.store().positionByCode(code, rank);
    } catch (e) {
        console.error("waitlist card: position query failed", e);
        return fallback();
    }
    if (position === null) return fallback();
    if (!deps.renderCard) {
        console.error("waitlist card: no renderer configured");
        return fallback();
    }
    let png: Uint8Array;
    try {
        png = await deps.renderCard(position);
    } catch (e) {
        console.error("waitlist card: render failed", e);
        return fallback();
    }
    return new Response(png as BodyInit, {status: 200, headers: {"content-type": "image/png", "Cache-Control": CARD_CACHE}});
}

/** The app with the chosen language (?lang= before the hash, as the app reads it) and the ref. */
const landing = (ref: string | null, lang: string | null) => (isWaitlistLang(lang) ? `/?lang=${lang}${appPath(ref).slice(1)}` : appPath(ref));

/** W-T72: GET ?stats=1 for the operator. Order: the CRON_SECRET bearer first (401), then the
 *  waitlist flag (404 / 503 as for every route), then the parameters (only stats=1, else 400).
 *  Read only; a database error is logged and answered 503 (never an empty count). */
async function stats(request: Request, p: URLSearchParams, deps: WaitlistDeps): Promise<Response> {
    const secret = deps.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return json(401, {error: "unauthorized"});
    const conf = waitlistConfig(deps.env);
    if (conf.state === "disabled") return json(404, {error: "disabled"});
    if (conf.state === "missing") {
        console.error("waitlist: missing configuration", conf.missing);
        return json(503, {error: "unavailable"});
    }
    // exactly one parameter, stats=1 (not even the "v" cache key paramsAllowed lets through)
    if ([...p.keys()].length !== 1 || p.get("stats") !== "1") return json(400, {error: "bad_request"}, NO_STORE_ONLY);
    try {
        const s = await deps.store().stats();
        return json(200, {generatedAt: new Date(deps.nowSec() * 1000).toISOString(), pointsEnabled: pointsConfig(deps.env).enabled, ...s}, NO_STORE_ONLY);
    } catch (e) {
        console.error("waitlist stats: read failed", e);
        return json(503, {error: "unavailable"}, NO_STORE_ONLY);
    }
}

export async function handleWaitlist(request: Request, deps: WaitlistDeps): Promise<Response> {
    // W-T72: the operator stats branch, before the flag check (its own order: secret, flag, params)
    if (request.method === "GET") {
        const sp = new URL(request.url).searchParams;
        if (sp.has("stats")) return stats(request, sp, deps);
    }
    const conf = waitlistConfig(deps.env);
    if (conf.state === "disabled") return json(404, {error: "disabled"});
    if (conf.state === "missing") {
        console.error("waitlist: missing configuration", conf.missing);
        return json(503, {error: "unavailable"});
    }
    const cfg = conf.config;
    const email = emailConfig(deps.env);
    if (!email.enabled && email.misconfigured) console.error("waitlist: FEATURE_WAITLIST_EMAIL is on but WAITLIST_CONTACT_EMAIL is missing; the email field stays off");
    // W-T70: points and missions. Off: every answer and the line order are exactly as before.
    const pts = pointsConfig(deps.env);
    if (pts.enabled && pts.repostMisconfigured) console.error("waitlist: WAITLIST_REPOST_POST_ID is not 1 to 20 digits; the repost mission stays off");
    const rank: WaitlistRank = pts.enabled ? "points" : "referrals";
    const pointsFields = pts.enabled ? {pointsEnabled: true, weights: POINT_WEIGHTS} : {};
    const emailFields = {emailEnabled: email.enabled, contact: email.enabled ? email.contact : null};
    /** My state (GET, and the answer of a mission POST): null when the account row is gone. */
    const meBody = async (xid: string): Promise<Record<string, unknown> | null> => {
        const me = await deps.store().me(xid, rank);
        if (!me) return null;
        const base = {
            joined: true,
            // the wallet message names the X account (walletMessage), so the page needs the id
            xUserId: xid,
            username: me.username,
            position: me.position,
            referrals: me.referrals,
            refCode: me.refCode,
            shareUrl: shareUrl(cfg.origin, me.refCode),
            wallet: me.wallet,
            email: maskEmail(me.email),
            ...emailFields,
        };
        if (!pts.enabled) return base;
        const followed = me.followed === true;
        const reposted = me.reposted === true;
        return {
            ...base,
            ...pointsFields,
            points: me.points ?? pointsOf({referrals: me.referrals, followed, reposted, wallet: me.wallet}),
            missions: {
                follow: {done: followed, url: followUrl()},
                repost: pts.repostId ? {done: reposted, url: repostUrl(pts.repostId)} : null,
                wallet: {done: me.wallet !== null},
            },
        };
    };
    const random = deps.random ?? defaultRandom;
    const now = deps.nowSec();
    const url = new URL(request.url);
    const p = url.searchParams;

    if (request.method === "GET" || request.method === "HEAD") {
        // W-T52: the card image of one referral code. A bad or unknown code, a database error or a
        // render error all redirect to the fixed card (errors are logged).
        if (p.has("card")) {
            if (!paramsAllowed(p, ["card"])) return json(400, {error: "bad_request"});
            return card(p.get("card"), cfg.origin, rank, deps);
        }
        // navigations (link previews, the /waitlist address): extra parameters are ignored
        if (p.has("share")) {
            const code = p.get("share");
            return new Response(waitlistShareHtml(cfg.origin, isRefCode(code) ? code : null), {
                status: 200,
                headers: {"content-type": "text/html; charset=utf-8", "Cache-Control": SHARE_CACHE},
            });
        }
        const action = p.get("action");
        if (action === "land") return redirect(landing(p.get("ref"), p.get("lang")));
        if (action === "start") {
            if (!paramsAllowed(p, ["action", "ref", "lang"])) return json(400, {error: "bad_request"});
            const ref = isRefCode(p.get("ref")) ? p.get("ref") : null;
            const lang = isWaitlistLang(p.get("lang")) ? p.get("lang") : null;
            const state = b64url(random(16));
            const {verifier, challenge} = await pkcePair(random);
            const cookie = await signCookie({state, verifier, ref, lang, exp: now + OAUTH_TTL_SEC} satisfies OAuthPayload, cfg.sessionSecret);
            return redirect(authorizeUrl({clientId: cfg.clientId, origin: cfg.origin, state, codeChallenge: challenge}), [setCookie(OAUTH_COOKIE, cookie, OAUTH_TTL_SEC)]);
        }
        if (action === "callback") {
            if (!paramsAllowed(p, ["action", "code", "state", "error", "error_description"])) return json(400, {error: "bad_request"});
            const clear = clearCookie(OAUTH_COOKIE);
            const raw = readCookie(request, OAUTH_COOKIE);
            const o = await verifyCookie<OAuthPayload>(raw, cfg.sessionSecret, now);
            const code = p.get("code");
            const state = p.get("state");
            // W-T73: one reason per denial, logged once (never the code, the state, the cookie or
            // X's error_description); the answer is the same for every reason
            const reason = p.has("error")
                ? "x_error"
                : !code || !state
                  ? "missing_code_or_state"
                  : !raw
                    ? "no_cookie"
                    : !o || typeof o.state !== "string" || typeof o.verifier !== "string"
                      ? "bad_cookie"
                      : !sameString(o.state, state)
                        ? "state_mismatch"
                        : null;
            if (reason || !o || !code) {
                const xe = p.get("error");
                console.warn("waitlist: callback denied", {reason, xError: reason === "x_error" ? (xe !== null && /^[a-z_]{1,40}$/.test(xe) ? xe : "other") : null});
                return redirect("/#/waitlist?error=denied", [clear]);
            }
            const user = await xSignIn(cfg, code, o.verifier, deps.fetch);
            if (user === "x") return redirect("/#/waitlist?error=x", [clear]);
            try {
                const store = deps.store();
                let joined = false;
                for (let i = 0; i < MAX_REF_DRAWS && !joined; i++) {
                    const r = await store.join({xid: user.id, username: user.username, xCreatedAt: user.createdAt, followers: user.followers, refCode: refCodeFrom(random), ref: o.ref, lang: o.lang});
                    joined = r !== "ref_code_taken";
                }
                if (!joined) {
                    console.error(`waitlist: no free ref code after ${MAX_REF_DRAWS} draws`);
                    return redirect("/#/waitlist?error=x", [clear]);
                }
            } catch (e) {
                console.error("waitlist: join failed", e);
                return redirect("/#/waitlist?error=x", [clear]);
            }
            const session = await signCookie({xid: user.id, exp: now + SESSION_TTL_SEC} satisfies SessionPayload, cfg.sessionSecret);
            return redirect("/#/waitlist", [clear, setCookie(SESSION_COOKIE, session, SESSION_TTL_SEC)]);
        }
        // my state
        const c = cors(request);
        if (!c.allowed) return forbiddenOrigin(c);
        if (!paramsAllowed(p, [])) return json(400, {error: "bad_request"}, c.headers);
        const s = await verifyCookie<SessionPayload>(readCookie(request, SESSION_COOKIE), cfg.sessionSecret, now);
        if (!s) return json(200, {joined: false, ...emailFields, ...pointsFields}, {...c.headers, ...NO_STORE});
        try {
            const body = await meBody(s.xid);
            if (!body) return json(200, {joined: false, ...emailFields, ...pointsFields}, {...c.headers, ...NO_STORE});
            return json(200, body, {...c.headers, ...NO_STORE});
        } catch (e) {
            console.error("waitlist: read failed", e);
            return json(503, {error: "unavailable"}, {...c.headers, ...NO_STORE});
        }
    }

    if (request.method !== "POST") return json(405, {error: "method_not_allowed"});
    const c = cors(request);
    if (!c.allowed) return forbiddenOrigin(c);
    const h = {...c.headers, ...NO_STORE};
    if (!paramsAllowed(p, [])) return json(400, {error: "bad_request"}, h);
    let body: {action?: unknown; wallet?: unknown; signature?: unknown; email?: unknown; consent?: unknown; mission?: unknown};
    try {
        const text = await request.text();
        if (text.length > MAX_POST) return json(413, {error: "too_large"}, h);
        body = JSON.parse(text);
        if (!body || typeof body !== "object") throw new Error("not an object");
    } catch {
        return json(400, {error: "bad_request"}, h);
    }
    if (body.action === "logout") {
        const res = json(200, {ok: true}, h);
        res.headers.append("Set-Cookie", clearCookie(SESSION_COOKIE));
        return res;
    }
    const s = await verifyCookie<SessionPayload>(readCookie(request, SESSION_COOKIE), cfg.sessionSecret, now);
    if (!s) return json(401, {error: "no_session"}, h);
    try {
        if (body.action === "wallet") {
            if (typeof body.wallet !== "string" || !isAddress(body.wallet) || typeof body.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.signature)) {
                return json(400, {error: "bad_request"}, h);
            }
            const wallet = body.wallet.toLowerCase();
            let signer: string;
            try {
                signer = await recoverMessageAddress({message: walletMessage(s.xid, wallet), signature: body.signature as `0x${string}`});
            } catch {
                return json(400, {error: "bad_signature"}, h);
            }
            if (signer.toLowerCase() !== wallet) return json(400, {error: "bad_signature"}, h);
            const r = await deps.store().setWallet(s.xid, wallet);
            if (r === "taken") return json(409, {error: "wallet_taken"}, h);
            if (r === "no_account") return json(401, {error: "no_session"}, h);
            return json(200, {ok: true, wallet}, h);
        }
        if (body.action === "email") {
            if (!email.enabled) return json(404, {error: "disabled"}, h);
            if (body.consent !== true) return json(400, {error: "consent_required"}, h);
            const e = normalizeEmail(body.email);
            if (!e) return json(400, {error: "bad_email"}, h);
            if (!(await deps.store().setEmail(s.xid, e))) return json(401, {error: "no_session"}, h);
            return json(200, {ok: true, email: maskEmail(e)}, h);
        }
        if (body.action === "mission") {
            // W-T70: pressing the button counts at once (no X API call); the first press is kept
            if (!pts.enabled) return json(404, {error: "disabled"}, h);
            if (!isMission(body.mission)) return json(400, {error: "bad_mission"}, h);
            if (body.mission === "repost" && !pts.repostId) return json(404, {error: "disabled"}, h);
            if (!(await deps.store().setMission(s.xid, body.mission))) return json(401, {error: "no_session"}, h);
            const state = await meBody(s.xid);
            if (!state) return json(401, {error: "no_session"}, h);
            return json(200, state, h);
        }
        if (body.action === "email-remove") {
            await deps.store().removeEmail(s.xid);
            return json(200, {ok: true, email: null}, h);
        }
    } catch (e) {
        // never the email itself: only the action and the error
        console.error(`waitlist: ${String(body.action)} failed`, e instanceof Error ? e.message : e);
        return json(503, {error: "unavailable"}, h);
    }
    return json(400, {error: "bad_request"}, h);
}
