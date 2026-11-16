// Waitlist (W-T43): pure parts shared by the browser and the server. X OAuth 2.0 (Authorization Code
// with PKCE) addresses, the referral code format, the wallet-link message, the email rules, the
// position rule, the required environment and the share page. Leaf module (no Node imports, no relative imports), like
// disclosure.ts, so the page can import it.
//
// X docs (docs.x.com): authorize https://x.com/i/oauth2/authorize, token POST
// https://api.x.com/2/oauth2/token (confidential client: Basic client_id:client_secret),
// GET https://api.x.com/2/users/me with user.fields=created_at,public_metrics
// (data.id, data.username, data.created_at, data.public_metrics.followers_count).

export const X_AUTHORIZE = "https://x.com/i/oauth2/authorize";
export const X_TOKEN = "https://api.x.com/2/oauth2/token";
export const X_ME = "https://api.x.com/2/users/me?user.fields=created_at,public_metrics";
/** No offline.access: no refresh token, the access token is used once and dropped. */
export const X_SCOPE = "tweet.read users.read";

export const SESSION_COOKIE = "mapae_wl";
export const OAUTH_COOKIE = "mapae_wl_oauth";
export const SESSION_TTL_SEC = 30 * 24 * 3600;
export const OAUTH_TTL_SEC = 10 * 60;

/** Referral code: 8 characters, no look-alikes (0 O 1 I L). */
export const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const REF_LENGTH = 8;
const REF_RE = new RegExp(`^[${REF_ALPHABET}]{${REF_LENGTH}}$`);
export const isRefCode = (s: string | null | undefined): s is string => typeof s === "string" && REF_RE.test(s);

/** Uniform code from random bytes (rejection sampling: 31 symbols, bytes >= 248 are skipped).
 *  `bytes` supplies fresh random bytes on each call. */
export function refCodeFrom(bytes: (n: number) => Uint8Array): string {
    const limit = 256 - (256 % REF_ALPHABET.length);
    let out = "";
    while (out.length < REF_LENGTH) {
        for (const b of bytes(16)) {
            if (b >= limit) continue;
            out += REF_ALPHABET[b % REF_ALPHABET.length];
            if (out.length === REF_LENGTH) break;
        }
    }
    return out;
}

export const WAITLIST_LANGS = ["ko", "en"] as const;
export type WaitlistLang = (typeof WAITLIST_LANGS)[number];
export const isWaitlistLang = (s: string | null | undefined): s is WaitlistLang => s === "ko" || s === "en";

/** The message a wallet signs (EIP-191) to be linked to an X account. */
export function walletMessage(xUserId: string, wallet: string): string {
    return ["MAPAE waitlist", `x: ${xUserId}`, `wallet: ${wallet.toLowerCase()}`].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------------------------

export const WAITLIST_ENV = ["X_CLIENT_ID", "X_CLIENT_SECRET", "WAITLIST_SESSION_SECRET", "WAITLIST_ORIGIN"] as const;
export type WaitlistEnv = Partial<Record<"FEATURE_WAITLIST" | "FEATURE_WAITLIST_EMAIL" | "WAITLIST_CONTACT_EMAIL" | (typeof WAITLIST_ENV)[number], string>>;
export type WaitlistConfig = {clientId: string; clientSecret: string; sessionSecret: string; origin: string};
/** Minimum length of WAITLIST_SESSION_SECRET (32 bytes as text). */
export const MIN_SECRET_LENGTH = 32;

/** disabled: the flag is not "1". missing: names of required values that are absent or invalid
 *  (an origin that is not https://host without a trailing slash, a short secret). */
export function waitlistConfig(env: WaitlistEnv): {state: "disabled"} | {state: "missing"; missing: string[]} | {state: "ok"; config: WaitlistConfig} {
    if (env.FEATURE_WAITLIST !== "1") return {state: "disabled"};
    const missing: string[] = WAITLIST_ENV.filter((k) => !env[k]);
    const origin = env.WAITLIST_ORIGIN ?? "";
    if (origin && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) missing.push("WAITLIST_ORIGIN (https://host, no trailing slash)");
    const secret = env.WAITLIST_SESSION_SECRET ?? "";
    if (secret && secret.length < MIN_SECRET_LENGTH) missing.push(`WAITLIST_SESSION_SECRET (at least ${MIN_SECRET_LENGTH} characters)`);
    if (missing.length > 0) return {state: "missing", missing};
    return {state: "ok", config: {clientId: env.X_CLIENT_ID!, clientSecret: env.X_CLIENT_SECRET!, sessionSecret: secret, origin}};
}

/** The optional email field: on only with FEATURE_WAITLIST_EMAIL = "1" AND a contact address (a
 *  privacy notice without a contact is never shown). `misconfigured` asks the caller to log it. */
export function emailConfig(env: WaitlistEnv): {enabled: true; contact: string} | {enabled: false; misconfigured: boolean} {
    const contact = (env.WAITLIST_CONTACT_EMAIL ?? "").trim();
    if (env.FEATURE_WAITLIST_EMAIL !== "1") return {enabled: false, misconfigured: false};
    if (!contact) return {enabled: false, misconfigured: true};
    return {enabled: true, contact};
}

// ---------------------------------------------------------------------------------------------
// Email (stored only; nothing is sent from this repository)
// ---------------------------------------------------------------------------------------------

export const EMAIL_MAX = 254;

/** Trimmed, lowercased address, or null when it fails the shape check: one "@", both sides
 *  non-empty, a dot in the domain (not at its start or end), no whitespace, at most 254 characters. */
export function normalizeEmail(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const e = raw.trim().toLowerCase();
    if (e.length === 0 || e.length > EMAIL_MAX || /\s/.test(e)) return null;
    const parts = e.split("@");
    if (parts.length !== 2) return null;
    const [local, domain] = parts;
    if (!local || !domain) return null;
    const dot = domain.indexOf(".");
    if (dot <= 0 || domain.endsWith(".")) return null;
    return e;
}

/** "j***@gmail.com": first character of the local part, then ***. Only this form ever leaves the server. */
export function maskEmail(email: string | null | undefined): string | null {
    if (!email) return null;
    const at = email.lastIndexOf("@");
    if (at <= 0) return "***";
    return `${email[0]}***${email.slice(at)}`;
}

export const redirectUri = (origin: string) => `${origin}/waitlist/callback`;
export const shareUrl = (origin: string, code: string) => `${origin}/w/${code}`;

export function authorizeUrl(p: {clientId: string; origin: string; state: string; codeChallenge: string}): string {
    const q = new URLSearchParams({
        response_type: "code",
        client_id: p.clientId,
        redirect_uri: redirectUri(p.origin),
        scope: X_SCOPE,
        state: p.state,
        code_challenge: p.codeChallenge,
        code_challenge_method: "S256",
    });
    return `${X_AUTHORIZE}?${q.toString()}`;
}

// ---------------------------------------------------------------------------------------------
// Position and the join rule (the SQL in db.ts does the same; these are the reference)
// ---------------------------------------------------------------------------------------------

export type WaitlistRow = {xid: string; seq: number; refCode: string; referredBy: string | null; referrals: number; username: string; followers: number | null};

/** 1 + rows with more referrals + rows with as many referrals that joined earlier. */
export function positionOf(rows: readonly Pick<WaitlistRow, "xid" | "seq" | "referrals">[], xid: string): number | null {
    const me = rows.find((r) => r.xid === xid);
    if (!me) return null;
    return 1 + rows.filter((r) => r.referrals > me.referrals || (r.referrals === me.referrals && r.seq < me.seq)).length;
}

/** A join applied to a table: a new account is added (its ref counts only when it is an existing
 *  code of another account); an account that is already there only refreshes username and
 *  followers (referred_by and referrals never change). */
export function applyJoin(rows: WaitlistRow[], j: {xid: string; username: string; followers: number | null; refCode: string; ref: string | null}): {rows: WaitlistRow[]; inserted: boolean} {
    const existing = rows.find((r) => r.xid === j.xid);
    if (existing) return {rows: rows.map((r) => (r.xid === j.xid ? {...r, username: j.username, followers: j.followers} : r)), inserted: false};
    const owner = j.ref ? rows.find((r) => r.refCode === j.ref && r.xid !== j.xid) : undefined;
    const seq = rows.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
    const next = rows.map((r) => (owner && r.xid === owner.xid ? {...r, referrals: r.referrals + 1} : r));
    next.push({xid: j.xid, seq, refCode: j.refCode, referredBy: owner ? owner.refCode : null, referrals: 0, username: j.username, followers: j.followers});
    return {rows: next, inserted: true};
}

// ---------------------------------------------------------------------------------------------
// Share page (GET /w/:code): no DB read
// ---------------------------------------------------------------------------------------------

export const SHARE_TITLE = "MAPAE Waitlist";
export const SHARE_DESCRIPTION = "Everyone starts from the same line.";
const ESC: Record<string, string> = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** The app address the share page and /waitlist forward to (ref only when it is a valid code). */
export const appPath = (ref: string | null) => (isRefCode(ref) ? `/#/waitlist?ref=${ref}` : "/#/waitlist");

export function waitlistShareHtml(origin: string, code: string | null): string {
    const app = appPath(code);
    const page = isRefCode(code) ? shareUrl(origin, code) : `${origin}/waitlist`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(SHARE_TITLE)}</title>
<meta name="description" content="${esc(SHARE_DESCRIPTION)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="MAPAE" />
<meta property="og:title" content="${esc(SHARE_TITLE)}" />
<meta property="og:description" content="${esc(SHARE_DESCRIPTION)}" />
<meta property="og:url" content="${esc(page)}" />
<meta property="og:image" content="${esc(`${origin}/logo.png`)}" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${esc(SHARE_TITLE)}" />
<meta name="twitter:description" content="${esc(SHARE_DESCRIPTION)}" />
<meta name="twitter:image" content="${esc(`${origin}/logo.png`)}" />
<meta http-equiv="refresh" content="0;url=${esc(app)}" />
</head>
<body>
<p><a href="${esc(app)}">${esc(SHARE_TITLE)}</a></p>
</body>
</html>
`;
}
