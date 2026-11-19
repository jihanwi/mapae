import {describe, expect, it, vi} from "vitest";
import {privateKeyToAccount} from "viem/accounts";
import {
    applyJoin,
    authorizeUrl,
    emailConfig,
    isRefCode,
    maskEmail,
    normalizeEmail,
    positionOf,
    positionByPoints,
    pointsOf,
    pointsConfig,
    POINT_WEIGHTS,
    POINTS_REFERRAL,
    POINTS_FOLLOW,
    POINTS_REPOST,
    POINTS_WALLET,
    isMission,
    suspectOf,
    SUSPECT_MAX_ACCOUNT_AGE_DAYS,
    SUSPECT_MIN_FOLLOWERS,
    followUrl,
    repostUrl,
    REF_ALPHABET,
    refCodeFrom,
    walletMessage,
    waitlistConfig,
    WaitlistEnv,
    WaitlistRow,
    waitlistShareHtml,
    shareImage,
    cardImage,
    SHARE_TITLE,
    SHARE_DESCRIPTION,
    X_AUTHORIZE,
    X_ME,
    X_SCOPE,
    X_TOKEN,
} from "./waitlist.js";
import {b64url, fromB64url, handleWaitlist, MAX_REF_DRAWS, OAuthPayload, readCookie, signCookie, verifyCookie, WaitlistDeps, WaitlistStore} from "./waitlistApi.js";
import {pointsSql, suspectSql, WAITLIST_STATS_TOP_SQL, WAITLIST_STATS_TOTALS_SQL, WAITLIST_JOIN_SQL, WAITLIST_ME_POINTS_SQL, WAITLIST_ME_SQL, WAITLIST_POSITION_BY_CODE_POINTS_SQL, WaitlistJoin, WaitlistMe} from "./db.js";

const SECRET = "s".repeat(40);
const ORIGIN = "https://mapae-snowy.vercel.app";
const ENV: WaitlistEnv = {FEATURE_WAITLIST: "1", X_CLIENT_ID: "cid", X_CLIENT_SECRET: "csecret", WAITLIST_SESSION_SECRET: SECRET, WAITLIST_ORIGIN: ORIGIN};
const ENV_EMAIL: WaitlistEnv = {...ENV, FEATURE_WAITLIST_EMAIL: "1", WAITLIST_CONTACT_EMAIL: "hello@example.com"};
const NOW = 1_800_000_000;

describe("environment", () => {
    it("off unless the flag is 1; missing names listed (values never)", () => {
        expect(waitlistConfig({})).toEqual({state: "disabled"});
        expect(waitlistConfig({...ENV, FEATURE_WAITLIST: "true"})).toEqual({state: "disabled"});
        expect(waitlistConfig({FEATURE_WAITLIST: "1"})).toEqual({state: "missing", missing: ["X_CLIENT_ID", "X_CLIENT_SECRET", "WAITLIST_SESSION_SECRET", "WAITLIST_ORIGIN"]});
        expect(waitlistConfig({...ENV, WAITLIST_ORIGIN: "https://mapae.fun/"})).toMatchObject({state: "missing"});
        expect(waitlistConfig({...ENV, WAITLIST_SESSION_SECRET: "short"})).toMatchObject({state: "missing"});
        expect(waitlistConfig(ENV)).toEqual({state: "ok", config: {clientId: "cid", clientSecret: "csecret", sessionSecret: SECRET, origin: ORIGIN}});
    });
    it("email: on only with the flag AND a contact address", () => {
        expect(emailConfig(ENV)).toEqual({enabled: false, misconfigured: false});
        expect(emailConfig({...ENV, FEATURE_WAITLIST_EMAIL: "1"})).toEqual({enabled: false, misconfigured: true});
        expect(emailConfig({...ENV, WAITLIST_CONTACT_EMAIL: "a@b.co"})).toEqual({enabled: false, misconfigured: false});
        expect(emailConfig(ENV_EMAIL)).toEqual({enabled: true, contact: "hello@example.com"});
    });
});

describe("pure rules", () => {
    it("ref code: 8 characters from the alphabet without look-alikes; uniform draw", () => {
        expect(REF_ALPHABET).not.toMatch(/[01ILO]/);
        expect(isRefCode("ABCDEFGH")).toBe(true);
        expect(isRefCode("ABCDEFG")).toBe(false);
        expect(isRefCode("ABCDEFGI")).toBe(false);
        expect(isRefCode("abcdefgh")).toBe(false);
        expect(isRefCode(null)).toBe(false);
        const c = refCodeFrom((n) => crypto.getRandomValues(new Uint8Array(n)));
        expect(isRefCode(c)).toBe(true);
        // bytes over the rejection limit are skipped
        expect(refCodeFrom((n) => new Uint8Array(n).fill(250).map((v, i) => (i % 2 ? 0 : v)))).toBe("AAAAAAAA");
    });
    it("wallet message", () => {
        expect(walletMessage("123", "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD")).toBe("MAPAE waitlist\nx: 123\nwallet: 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    });
    it("position: more referrals first, then join order", () => {
        const rows = [{xid: "a", seq: 1, referrals: 0}, {xid: "b", seq: 2, referrals: 2}, {xid: "c", seq: 3, referrals: 0}, {xid: "d", seq: 4, referrals: 2}];
        expect(["a", "b", "c", "d"].map((x) => positionOf(rows, x))).toEqual([3, 1, 4, 2]);
        expect(positionOf(rows, "zz")).toBeNull();
    });
    it("join: a new account with a real code of another account bumps it; self, unknown codes and re-logins do not", () => {
        let t: WaitlistRow[] = [];
        const join = (xid: string, ref: string | null, refCode = `C${xid}`.padEnd(8, "Z")) => {
            const r = applyJoin(t, {xid, username: xid, followers: 1, refCode, ref});
            t = r.rows;
            return r.inserted;
        };
        expect(join("A", null)).toBe(true);
        const codeA = t[0].refCode;
        expect(join("B", codeA)).toBe(true);
        expect(t.find((r) => r.xid === "A")!.referrals).toBe(1);
        expect(join("B", codeA)).toBe(false); // B signs in again
        expect(t.find((r) => r.xid === "A")!.referrals).toBe(1);
        expect(join("A", codeA)).toBe(false); // A through its own link
        expect(t.find((r) => r.xid === "A")!.referrals).toBe(1);
        expect(join("C", "NOPENOPE")).toBe(true); // unknown code
        expect(t.find((r) => r.xid === "C")!.referredBy).toBeNull();
        expect(t.reduce((a, r) => a + r.referrals, 0)).toBe(1);
        // a re-login refreshes username and followers only
        t = applyJoin(t, {xid: "B", username: "B2", followers: 9, refCode: "QQQQQQQQ", ref: null}).rows;
        expect(t.find((r) => r.xid === "B")).toMatchObject({username: "B2", followers: 9, referredBy: codeA, refCode: "CBZZZZZZ"});
    });
    it("the SQL follows the same rule in one statement", () => {
        expect(WAITLIST_JOIN_SQL).toContain("ON CONFLICT (x_user_id) DO NOTHING");
        expect(WAITLIST_JOIN_SQL).toContain("o.x_user_id <> $1::text");
        expect(WAITLIST_JOIN_SQL).toContain("NOT EXISTS (SELECT 1 FROM ins)");
        expect(WAITLIST_JOIN_SQL).toMatch(/SET username = \$2::text, followers = \$4::int/);
        expect(WAITLIST_ME_SQL).toContain("o.referrals > m.referrals OR (o.referrals = m.referrals AND o.seq < m.seq)");
    });
    it("email: trimmed and lowercased; one @, both sides, a dot in the domain, no spaces, 254 at most", () => {
        expect(normalizeEmail("  Jo@Gmail.COM ")).toBe("jo@gmail.com");
        expect(normalizeEmail("a b@c.de")).toBeNull();
        expect(normalizeEmail("a@@c.de")).toBeNull();
        expect(normalizeEmail("a@b@c.de")).toBeNull();
        expect(normalizeEmail("a@localhost")).toBeNull();
        expect(normalizeEmail("a@.de")).toBeNull();
        expect(normalizeEmail("a@de.")).toBeNull();
        expect(normalizeEmail("@c.de")).toBeNull();
        expect(normalizeEmail(42)).toBeNull();
        const local = "a".repeat(254 - "@c.de".length);
        expect(normalizeEmail(`${local}@c.de`)).toHaveLength(254);
        expect(normalizeEmail(`${local}a@c.de`)).toBeNull();
    });
    it("email masking", () => {
        expect(maskEmail("jane@gmail.com")).toBe("j***@gmail.com");
        expect(maskEmail("j@x.io")).toBe("j***@x.io");
        expect(maskEmail(null)).toBeNull();
    });
    it("X addresses and scope", () => {
        expect(X_AUTHORIZE).toBe("https://x.com/i/oauth2/authorize");
        expect(X_TOKEN).toBe("https://api.x.com/2/oauth2/token");
        expect(X_ME).toBe("https://api.x.com/2/users/me?user.fields=created_at,public_metrics");
        expect(X_SCOPE).toBe("tweet.read users.read");
        const u = new URL(authorizeUrl({clientId: "cid", origin: ORIGIN, state: "st", codeChallenge: "ch"}));
        expect(Object.fromEntries(u.searchParams)).toEqual({response_type: "code", client_id: "cid", redirect_uri: `${ORIGIN}/waitlist/callback`, scope: "tweet.read users.read", state: "st", code_challenge: "ch", code_challenge_method: "S256"});
    });
    it("share HTML: OG tags, the origin given, ref only when valid", () => {
        const h = waitlistShareHtml("https://mapae.fun", "ABCDEFGH");
        expect(h).toContain('<meta property="og:title" content="MAPAE Waitlist" />');
        expect(h).toContain('content="Everyone starts from the same line."');
        expect(h).toContain("/#/waitlist?ref=ABCDEFGH");
        expect(h).not.toContain("vercel.app");
        expect(waitlistShareHtml("https://mapae.fun", null)).toContain('url=/#/waitlist"');
    });
    it("W-T49: the large share card, its image only on the origin given (WAITLIST_ORIGIN)", () => {
        const h = waitlistShareHtml("https://mapae.fun", "ABCDEFGH");
        expect(h).toContain('<meta name="twitter:card" content="summary_large_image" />');
        // W-T52: a valid code shows its own card
        expect(h).toContain('<meta property="og:image" content="https://mapae.fun/api/waitlist?card=ABCDEFGH" />');
        expect(h).toContain('<meta name="twitter:image" content="https://mapae.fun/api/waitlist?card=ABCDEFGH" />');
        expect(h).toContain('<meta property="og:image:width" content="1200" />');
        expect(h).toContain('<meta property="og:image:height" content="630" />');
        expect(h).toContain('<meta name="twitter:image:alt" content="MAPAE Waitlist" />');
        expect(h).not.toContain("logo.png");
        expect(SHARE_TITLE).toBe("MAPAE Waitlist");
        expect(SHARE_DESCRIPTION).toBe("Everyone starts from the same line.");
        const imgsOf = (html: string) => [...html.matchAll(/(?:og:image|twitter:image)" content="([^"]+)"/g)].map((m) => m[1]);
        expect(imgsOf(waitlistShareHtml("https://example.test", "ABCDEFGH"))).toEqual([
            "https://example.test/api/waitlist?card=ABCDEFGH",
            "https://example.test/api/waitlist?card=ABCDEFGH",
        ]);
        // no valid code: the fixed card, still on the origin given
        expect(imgsOf(waitlistShareHtml("https://example.test", null))).toEqual(["https://example.test/og-waitlist.png", "https://example.test/og-waitlist.png"]);
        expect(cardImage("https://mapae.fun", "ABCDEFGH")).toBe("https://mapae.fun/api/waitlist?card=ABCDEFGH");
        expect(shareImage("https://mapae.fun")).toBe("https://mapae.fun/og-waitlist.png");
    });
});

describe("signed cookies", () => {
    it("round trip, expiry, tampering, wrong secret", async () => {
        const c = await signCookie({xid: "1", exp: NOW + 10}, SECRET);
        expect(await verifyCookie(c, SECRET, NOW)).toEqual({xid: "1", exp: NOW + 10});
        expect(await verifyCookie(c, SECRET, NOW + 10)).toBeNull();
        expect(await verifyCookie(c, "t".repeat(40), NOW)).toBeNull();
        const [body, mac] = c.split(".");
        const forged = b64url(new TextEncoder().encode(JSON.stringify({xid: "2", exp: NOW + 10})));
        expect(await verifyCookie(`${forged}.${mac}`, SECRET, NOW)).toBeNull();
        expect(await verifyCookie(`${body}.${mac.slice(0, -2)}AA`, SECRET, NOW)).toBeNull();
        expect(await verifyCookie(`${body}`, SECRET, NOW)).toBeNull();
        expect(await verifyCookie(undefined, SECRET, NOW)).toBeNull();
        expect(fromB64url("!!")).toBeNull();
    });
});

// ---------------------------------------------------------------------------------------------
// Handler with a fake store and fake X
// ---------------------------------------------------------------------------------------------

type Row = WaitlistRow & {wallet: string | null; email: string | null; followed: boolean; reposted: boolean};

function memStore() {
    let rows: Row[] = [];
    const store: WaitlistStore = {
        async join(j: WaitlistJoin) {
            if (rows.some((r) => r.refCode === j.refCode && r.xid !== j.xid)) return "ref_code_taken";
            const r = applyJoin(rows, {xid: j.xid, username: j.username, followers: j.followers, refCode: j.refCode, ref: j.ref});
            rows = r.rows.map((x) => ({wallet: null, email: null, followed: false, reposted: false, ...x}) as Row);
            return {inserted: r.inserted};
        },
        async me(xid, rank): Promise<WaitlistMe | null> {
            ranks.push(rank);
            const r = rows.find((x) => x.xid === xid);
            if (!r) return null;
            const base = {username: r.username, refCode: r.refCode, referrals: r.referrals, wallet: r.wallet, email: r.email};
            if (rank === "referrals") return {...base, position: positionOf(rows, xid)!};
            return {...base, followed: r.followed, reposted: r.reposted, points: pointsOf(r), position: positionByPoints(rows, xid)!};
        },
        async setMission(xid, mission) {
            const r = rows.find((x) => x.xid === xid);
            if (!r) return false;
            if (mission === "follow") r.followed = true;
            else r.reposted = true;
            return true;
        },
        async setWallet(xid, wallet) {
            if (rows.some((r) => r.wallet === wallet && r.xid !== xid)) return "taken";
            const r = rows.find((x) => x.xid === xid);
            if (!r) return "no_account";
            r.wallet = wallet;
            return "ok";
        },
        async setEmail(xid, email) {
            const r = rows.find((x) => x.xid === xid);
            if (!r) return false;
            r.email = email;
            return true;
        },
        async removeEmail(xid) {
            const r = rows.find((x) => x.xid === xid);
            if (r) r.email = null;
        },
        stats: () => statsOf(),
        async positionByCode(code, rank) {
            positionCalls++;
            ranks.push(rank);
            if (failPosition) throw new Error("db down");
            const r = rows.find((x) => x.refCode === code);
            return r ? (rank === "points" ? positionByPoints(rows, r.xid)! : positionOf(rows, r.xid)!) : null;
        },
    };
    const ranks: string[] = [];
    // W-T72: the operator stats, counted from the rows (handles only, as the SQL answers)
    async function statsOf() {
        statsCalls++;
        if (failStats) throw new Error("db down");
        const top = rows.filter((r) => r.referrals > 0).sort((a, b) => b.referrals - a.referrals || a.seq - b.seq).slice(0, 10);
        return {
            total: rows.length,
            withWallet: rows.filter((r) => r.wallet).length,
            withEmail: rows.filter((r) => r.email).length,
            followed: rows.filter((r) => r.followed).length,
            reposted: rows.filter((r) => r.reposted).length,
            referred: rows.filter((r) => r.referredBy).length,
            byDay: [{day: "2026-11-23", joined: rows.length}],
            byLang: [{lang: "ko", joined: rows.length}],
            referralBuckets: {"0": rows.filter((r) => r.referrals === 0).length, "1": 0, "2-4": 0, "5-9": 0, "10+": 0},
            suspect: {youngAccount: 0, lowFollowers: 0, either: 0, unknown: rows.length, referredAndEither: 0},
            topReferrers: top.map((r) => ({username: r.username, referrals: r.referrals, suspectReferrals: 0, points: pointsOf(r)})),
        };
    }
    let statsCalls = 0;
    let failStats = false;
    let positionCalls = 0;
    let failPosition = false;
    return {store, rows: () => rows, ranks, positionCalls: () => positionCalls, failPosition: (v: boolean) => (failPosition = v), statsCalls: () => statsCalls, failStats: (v: boolean) => (failStats = v)};
}

type XMode = "ok" | "token500" | "me500" | "meMissing";
function fakeX(users: Record<string, {id: string; username: string}>, mode: () => XMode) {
    const calls: string[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        if (url === X_TOKEN) {
            if (mode() === "token500") return new Response(JSON.stringify({error: "server"}), {status: 500});
            const code = new URLSearchParams(String(init!.body)).get("code")!;
            expect((init!.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("cid:csecret")}`);
            return new Response(JSON.stringify({access_token: `tok-${code}`, token_type: "bearer"}), {status: 200});
        }
        if (url === X_ME) {
            if (mode() === "me500") return new Response("{}", {status: 500});
            const tok = (init!.headers as Record<string, string>).Authorization.replace("Bearer tok-", "");
            const u = users[tok];
            if (mode() === "meMissing") return new Response(JSON.stringify({data: {id: u.id}}), {status: 200});
            return new Response(JSON.stringify({data: {id: u.id, username: u.username, name: u.username, created_at: "2020-01-01T00:00:00.000Z", public_metrics: {followers_count: 12}}}), {status: 200});
        }
        return new Response("not found", {status: 404});
    }) as typeof fetch;
    return {f, calls};
}

function harness(env: WaitlistEnv = ENV) {
    const db = memStore();
    let mode: XMode = "ok";
    const x = fakeX({codeA: {id: "100", username: "alice"}, codeB: {id: "200", username: "bob"}}, () => mode);
    let n = 0;
    const rendered: number[] = [];
    let failRender = false;
    const renderCard = async (position: number) => {
        rendered.push(position);
        if (failRender) throw new Error("render");
        return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    };
    const deps: WaitlistDeps = {env, store: () => db.store, fetch: x.f, nowSec: () => NOW, random: (k) => new Uint8Array(k).map((_, i) => (i + 7 * ++n) % 248), renderCard};
    const call = (path: string, init: RequestInit = {}) => handleWaitlist(new Request(`${ORIGIN}${path}`, init), deps);
    const cookies = (r: Response) => r.headers.getSetCookie();
    const cookieValue = (r: Response, name: string) => cookies(r).find((c) => c.startsWith(`${name}=`))!.split(";")[0].slice(name.length + 1);
    /** start -> callback with the X code of `who`; returns the session cookie value */
    const signIn = async (who: "codeA" | "codeB", q = "") => {
        const s = await call(`/api/waitlist?action=start${q}`);
        const state = new URL(s.headers.get("location")!).searchParams.get("state")!;
        const oauth = cookieValue(s, "mapae_wl_oauth");
        const cb = await call(`/api/waitlist?action=callback&code=${who}&state=${state}`, {headers: {cookie: `mapae_wl_oauth=${oauth}`}});
        return {cb, session: cb.headers.getSetCookie().some((c) => c.startsWith("mapae_wl=")) ? cookieValue(cb, "mapae_wl") : null};
    };
    const me = async (session: string | null) => (await call("/api/waitlist", {headers: session ? {cookie: `mapae_wl=${session}`} : {}})).json();
    const post = (session: string | null, body: unknown) =>
        call("/api/waitlist", {method: "POST", headers: {"content-type": "application/json", ...(session ? {cookie: `mapae_wl=${session}`} : {})}, body: JSON.stringify(body)});
    return {db, x, call, cookies, signIn, me, post, setMode: (m: XMode) => (mode = m), rendered, failRender: (v: boolean) => (failRender = v)};
}

describe("handler: flags and parameters", () => {
    it("off: 404 disabled on every route; missing config: 503 with the names logged", async () => {
        const off = harness({});
        for (const path of ["/api/waitlist", "/api/waitlist?action=start", "/api/waitlist?share=ABCDEFGH"]) {
            const r = await off.call(path);
            expect(r.status).toBe(404);
            expect(await r.json()).toEqual({error: "disabled"});
        }
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const r = await harness({FEATURE_WAITLIST: "1", X_CLIENT_ID: "cid"}).call("/api/waitlist");
        expect(r.status).toBe(503);
        expect(JSON.stringify(err.mock.calls)).toContain("X_CLIENT_SECRET");
        expect(JSON.stringify(err.mock.calls)).not.toContain("cid\"");
        err.mockRestore();
    });
    it("unknown parameters: 400 (start, me, callback keeps X's parameters)", async () => {
        const h = harness();
        expect((await h.call("/api/waitlist?action=start&x=1")).status).toBe(400);
        expect((await h.call("/api/waitlist?x=1")).status).toBe(400);
        expect((await h.call("/api/waitlist?action=callback&code=a&state=b&foo=1")).status).toBe(400);
        expect((await h.call("/api/waitlist?action=callback&error=access_denied&error_description=no&state=b")).status).toBe(302);
    });
    it("not joined: joined false and the email flags", async () => {
        const h = harness();
        const r = await h.call("/api/waitlist");
        expect(r.headers.get("cache-control")).toBe("private, no-store");
        expect(await r.json()).toEqual({joined: false, emailEnabled: false, contact: null});
        expect(await harness(ENV_EMAIL).me(null)).toEqual({joined: false, emailEnabled: true, contact: "hello@example.com"});
    });
});

describe("handler: X sign-in", () => {
    it("start: 302 to X with S256, redirect_uri from WAITLIST_ORIGIN, signed 10 min cookie with ref and lang", async () => {
        const h = harness();
        const r = await h.call("/api/waitlist?action=start&ref=ABCDEFGH&lang=en", {headers: {host: "evil.example"}});
        expect(r.status).toBe(302);
        const loc = new URL(r.headers.get("location")!);
        expect(`${loc.origin}${loc.pathname}`).toBe("https://x.com/i/oauth2/authorize");
        expect(loc.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/waitlist/callback`);
        expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
        expect(loc.searchParams.get("scope")).toBe("tweet.read users.read");
        const set = h.cookies(r)[0];
        expect(set).toMatch(/^mapae_wl_oauth=[^;]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
        const p = await verifyCookie<OAuthPayload>(readCookie(new Request(ORIGIN, {headers: {cookie: set.split(";")[0]}}), "mapae_wl_oauth"), SECRET, NOW);
        expect(p).toMatchObject({ref: "ABCDEFGH", lang: "en", state: loc.searchParams.get("state")});
        // the challenge is S256 of the verifier
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(p!.verifier)));
        expect(loc.searchParams.get("code_challenge")).toBe(b64url(digest));
        // a bad ref or lang is dropped, not stored
        const r2 = await h.call("/api/waitlist?action=start&ref=bad&lang=fr");
        const p2 = await verifyCookie<OAuthPayload>(h.cookies(r2)[0].split(";")[0].slice("mapae_wl_oauth=".length), SECRET, NOW);
        expect(p2).toMatchObject({ref: null, lang: null});
    });
    it("callback: one token exchange and one users/me, join, 30-day session, 302 /#/waitlist; no token stored", async () => {
        const h = harness();
        const {cb, session} = await h.signIn("codeA");
        expect(cb.status).toBe(302);
        expect(cb.headers.get("location")).toBe("/#/waitlist");
        expect(h.cookies(cb).find((c) => c.startsWith("mapae_wl="))).toMatch(/Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/);
        expect(h.cookies(cb).find((c) => c.startsWith("mapae_wl_oauth="))).toContain("Max-Age=0");
        expect(h.x.calls).toEqual([X_TOKEN, X_ME]);
        expect(JSON.stringify(h.db.rows())).not.toContain("tok-");
        const m = await h.me(session);
        expect(m).toMatchObject({joined: true, username: "alice", position: 1, referrals: 0, wallet: null, email: null, emailEnabled: false, contact: null});
        expect(isRefCode(m.refCode)).toBe(true);
        expect(m.shareUrl).toBe(`${ORIGIN}/w/${m.refCode}`);
        expect(h.db.rows()[0]).toMatchObject({followers: 12});
    });
    it("referrals: B through A's link counts once; B again and A through its own link do not", async () => {
        const h = harness();
        const a = await h.signIn("codeA");
        const codeA = (await h.me(a.session)).refCode;
        const b = await h.signIn("codeB", `&ref=${codeA}`);
        expect((await h.me(a.session)).referrals).toBe(1);
        await h.signIn("codeB", `&ref=${codeA}`);
        await h.signIn("codeA", `&ref=${codeA}`);
        expect((await h.me(a.session)).referrals).toBe(1);
        expect((await h.me(a.session)).position).toBe(1);
        expect((await h.me(b.session)).position).toBe(2);
    });
    it("denied, state mismatch, missing cookie -> error=denied; X 500 or missing users/me fields -> error=x (logged)", async () => {
        const h = harness();
        const s = await h.call("/api/waitlist?action=start");
        const state = new URL(s.headers.get("location")!).searchParams.get("state")!;
        const oauth = h.cookies(s)[0].split(";")[0];
        const cb = (q: string, cookie = oauth) => h.call(`/api/waitlist?action=callback${q}`, {headers: {cookie}});
        expect((await cb(`&error=access_denied&state=${state}`)).headers.get("location")).toBe("/#/waitlist?error=denied");
        expect((await cb(`&code=codeA&state=WRONG${state.slice(5)}`)).headers.get("location")).toBe("/#/waitlist?error=denied");
        expect((await cb(`&code=codeA&state=${state}`, "")).headers.get("location")).toBe("/#/waitlist?error=denied");
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        for (const m of ["token500", "me500", "meMissing"] as const) {
            h.setMode(m);
            const r = await cb(`&code=codeA&state=${state}`);
            expect(r.headers.get("location"), m).toBe("/#/waitlist?error=x");
            expect(h.cookies(r).some((c) => c.startsWith("mapae_wl=")), m).toBe(false);
        }
        expect(err).toHaveBeenCalled();
        expect(JSON.stringify(err.mock.calls)).not.toContain("csecret");
        err.mockRestore();
        expect(h.db.rows()).toHaveLength(0);
    });
    it("ref code collisions: drawn again, at most 5 times, then error=x", async () => {
        const h = harness();
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const store = h.db.store;
        let tries = 0;
        store.join = async () => (tries++, "ref_code_taken");
        const {cb} = await h.signIn("codeA");
        expect(tries).toBe(MAX_REF_DRAWS);
        expect(cb.headers.get("location")).toBe("/#/waitlist?error=x");
        err.mockRestore();
    });
    it("land and share: forward to the app, extra parameters ignored, no DB read", async () => {
        const h = harness();
        const spy = vi.fn(h.db.store.me);
        h.db.store.me = spy;
        expect((await h.call("/api/waitlist?action=land&ref=ABCDEFGH&lang=en&utm=1")).headers.get("location")).toBe("/?lang=en#/waitlist?ref=ABCDEFGH");
        expect((await h.call("/api/waitlist?action=land&ref=bad")).headers.get("location")).toBe("/#/waitlist");
        const s = await h.call("/api/waitlist?share=ABCDEFGH");
        expect(s.headers.get("content-type")).toContain("text/html");
        expect(await s.text()).toContain(`${ORIGIN}/w/ABCDEFGH`);
        expect(spy).not.toHaveBeenCalled();
    });
});

describe("handler: wallet, email, logout", () => {
    const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    it("wallet: one signature, then 409 for another account; a bad signature is 400", async () => {
        const h = harness();
        const a = await h.signIn("codeA");
        const b = await h.signIn("codeB");
        const w = acct.address.toLowerCase();
        expect((await h.post(a.session, {action: "wallet", wallet: acct.address, signature: await acct.signMessage({message: walletMessage("200", w)})})).status).toBe(400);
        const ok = await h.post(a.session, {action: "wallet", wallet: acct.address, signature: await acct.signMessage({message: walletMessage("100", w)})});
        expect(ok.status).toBe(200);
        expect((await h.me(a.session)).wallet).toBe(w);
        const taken = await h.post(b.session, {action: "wallet", wallet: acct.address, signature: await acct.signMessage({message: walletMessage("200", w)})});
        expect(taken.status).toBe(409);
        expect(await taken.json()).toEqual({error: "wallet_taken"});
        expect((await h.post(null, {action: "wallet", wallet: acct.address, signature: "0x00"})).status).toBe(401);
    });
    it("email off: 404; remove still works", async () => {
        const h = harness();
        const a = await h.signIn("codeA");
        expect((await h.post(a.session, {action: "email", email: "a@b.co", consent: true})).status).toBe(404);
        expect((await h.post(a.session, {action: "email-remove"})).status).toBe(200);
    });
    it("email on: consent required, shape checked, only the masked form leaves; remove clears it", async () => {
        const h = harness(ENV_EMAIL);
        const a = await h.signIn("codeA");
        const no = await h.post(a.session, {action: "email", email: "jane@gmail.com"});
        expect(no.status).toBe(400);
        expect(await no.json()).toEqual({error: "consent_required"});
        expect(await (await h.post(a.session, {action: "email", email: "jane@gmail", consent: true})).json()).toEqual({error: "bad_email"});
        const ok = await h.post(a.session, {action: "email", email: " Jane@Gmail.com ", consent: true});
        const okText = await ok.text();
        expect(okText).not.toContain("jane@");
        expect(JSON.parse(okText)).toEqual({ok: true, email: "j***@gmail.com"});
        const m = await h.me(a.session);
        expect(m.email).toBe("j***@gmail.com");
        expect(JSON.stringify(m)).not.toContain("jane");
        expect(h.db.rows()[0].email).toBe("jane@gmail.com");
        await h.post(a.session, {action: "email-remove"});
        expect((await h.me(a.session)).email).toBeNull();
    });
    it("logout clears the session cookie; POST from another origin is refused", async () => {
        const h = harness();
        const r = await h.post(null, {action: "logout"});
        expect(r.headers.getSetCookie()[0]).toMatch(/^mapae_wl=; Path=\/; Max-Age=0/);
        const x = await h.call("/api/waitlist", {method: "POST", headers: {origin: "https://evil.example", host: "mapae-snowy.vercel.app"}, body: JSON.stringify({action: "logout"})});
        expect(x.status).toBe(403);
    });
});

describe("W-T52: card image (?card=<code>)", () => {
    const FALLBACK = `${ORIGIN}/og-waitlist.png`;
    it("a joined code: 200 PNG with the position, cached 5 minutes, one query", async () => {
        const h = harness();
        await h.signIn("codeA");
        const code = h.db.rows()[0].refCode;
        const r = await h.call(`/api/waitlist?card=${code}`);
        expect(r.status).toBe(200);
        expect(r.headers.get("content-type")).toBe("image/png");
        expect(r.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=600");
        expect(h.rendered).toEqual([1]);
        expect(h.db.positionCalls()).toBe(1);
        expect(new Uint8Array(await r.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    });
    it("bad format, unknown code, database error, render error: 302 to the fixed card", async () => {
        const h = harness();
        await h.signIn("codeA");
        const code = h.db.rows()[0].refCode;
        for (const q of ["card=abc", "card=", "card=ZZZZZZZZ"]) {
            const r = await h.call(`/api/waitlist?${q}`);
            expect(r.status, q).toBe(302);
            expect(r.headers.get("location")).toBe(FALLBACK);
        }
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        h.db.failPosition(true);
        const d = await h.call(`/api/waitlist?card=${code}`);
        expect(d.status).toBe(302);
        expect(d.headers.get("location")).toBe(FALLBACK);
        expect(JSON.stringify(err.mock.calls)).toContain("position query failed");
        h.db.failPosition(false);
        h.failRender(true);
        const f = await h.call(`/api/waitlist?card=${code}`);
        expect(f.status).toBe(302);
        expect(JSON.stringify(err.mock.calls)).toContain("render failed");
        err.mockRestore();
    });
    it("card with another parameter: 400; waitlist off: 404", async () => {
        const h = harness();
        expect((await h.call("/api/waitlist?card=ABCDEFGH&x=1")).status).toBe(400);
        expect((await h.call("/api/waitlist?card=ABCDEFGH&share=ABCDEFGH")).status).toBe(400);
        const off = await harness({}).call("/api/waitlist?card=ABCDEFGH");
        expect(off.status).toBe(404);
        expect(await off.json()).toEqual({error: "disabled"});
    });
    it("the share page itself still reads no database", async () => {
        const h = harness();
        const r = await h.call("/api/waitlist?share=ABCDEFGH");
        expect(r.status).toBe(200);
        expect(await r.text()).toContain(`${ORIGIN}/api/waitlist?card=ABCDEFGH`);
        expect(h.db.positionCalls()).toBe(0);
    });
});

// ---------------------------------------------------------------------------------------------
// W-T70: points and missions (FEATURE_WAITLIST_POINTS)
// ---------------------------------------------------------------------------------------------

const ENV_POINTS: WaitlistEnv = {...ENV, FEATURE_WAITLIST_POINTS: "1"};
const ENV_POINTS_REPOST: WaitlistEnv = {...ENV_POINTS, WAITLIST_REPOST_POST_ID: "1888000000000000001"};
const pr = (xid: string, seq: number, referrals: number, followed = false, reposted = false, wallet: string | null = null) => ({xid, seq, referrals, followed, reposted, wallet});

describe("W-T70 points: pure rules", () => {
    it("weights live in one place and the API answer carries the same values", () => {
        expect([POINTS_REFERRAL, POINTS_FOLLOW, POINTS_REPOST, POINTS_WALLET]).toEqual([10, 5, 5, 5]);
        expect(POINT_WEIGHTS).toEqual({referral: POINTS_REFERRAL, follow: POINTS_FOLLOW, repost: POINTS_REPOST, wallet: POINTS_WALLET});
    });
    it("points: referrals 0/1/3 with the mission and wallet combinations", () => {
        for (const [ref, base] of [[0, 0], [1, 10], [3, 30]] as const) {
            expect(pointsOf({referrals: ref, followed: false, reposted: false, wallet: null})).toBe(base);
            expect(pointsOf({referrals: ref, followed: true, reposted: false, wallet: null})).toBe(base + 5);
            expect(pointsOf({referrals: ref, followed: false, reposted: true, wallet: null})).toBe(base + 5);
            expect(pointsOf({referrals: ref, followed: false, reposted: false, wallet: "0xabc"})).toBe(base + 5);
            expect(pointsOf({referrals: ref, followed: true, reposted: true, wallet: "0xabc"})).toBe(base + 15);
        }
    });
    it("position: more points first, ties by seq; one referral ties with two missions", () => {
        const rows = [pr("a", 1, 1), pr("b", 2, 0, true, false, "0xb"), pr("c", 3, 0, true, true, "0xc"), pr("d", 4, 0)];
        // c 15, a 10 (seq 1), b 10 (seq 2), d 0
        expect(["a", "b", "c", "d"].map((x) => positionByPoints(rows, x))).toEqual([2, 3, 1, 4]);
        // B joined first: B ahead of A at the same 10 points
        const flipped = [pr("b", 1, 0, true, false, "0xb"), pr("a", 2, 1)];
        expect([positionByPoints(flipped, "b"), positionByPoints(flipped, "a")]).toEqual([1, 2]);
        expect(positionByPoints(rows, "zz")).toBeNull();
    });
    it("flag off: the referral rule, a wallet or missions do not move anyone", () => {
        const rows = [pr("a", 1, 0, true, true, "0xa"), pr("b", 2, 0)];
        expect([positionOf(rows, "a"), positionOf(rows, "b")]).toEqual([1, 2]);
        const rows2 = [pr("a", 1, 0, true, true, "0xa"), pr("b", 2, 1)];
        expect([positionOf(rows2, "b"), positionOf(rows2, "a")]).toEqual([1, 2]);
    });
    it("config: off unless the flag is 1; the repost mission off without a valid post id", () => {
        expect(pointsConfig(ENV)).toEqual({enabled: false});
        expect(pointsConfig({...ENV, FEATURE_WAITLIST_POINTS: "true"})).toEqual({enabled: false});
        expect(pointsConfig(ENV_POINTS)).toEqual({enabled: true, repostId: null, repostMisconfigured: false});
        expect(pointsConfig({...ENV_POINTS, WAITLIST_REPOST_POST_ID: ""})).toEqual({enabled: true, repostId: null, repostMisconfigured: false});
        expect(pointsConfig(ENV_POINTS_REPOST)).toEqual({enabled: true, repostId: "1888000000000000001", repostMisconfigured: false});
        for (const bad of ["abc", "12a", "1".repeat(21), " 123", "https://x.com/a/status/1"]) {
            expect(pointsConfig({...ENV_POINTS, WAITLIST_REPOST_POST_ID: bad}), bad).toEqual({enabled: true, repostId: null, repostMisconfigured: true});
        }
    });
    it("missions and intents", () => {
        expect(isMission("follow") && isMission("repost")).toBe(true);
        expect(isMission("wallet")).toBe(false);
        expect(isMission(undefined)).toBe(false);
        expect(followUrl()).toBe("https://x.com/intent/follow?screen_name=MapaeGiwa");
        expect(repostUrl("123")).toBe("https://x.com/intent/retweet?tweet_id=123");
    });
    it("SQL: the points are built from the constants; the referral SQL is unchanged", () => {
        expect(pointsSql("o")).toBe(
            `(o.referrals * ${POINTS_REFERRAL} + (CASE WHEN o.followed_at IS NOT NULL THEN ${POINTS_FOLLOW} ELSE 0 END) + (CASE WHEN o.reposted_at IS NOT NULL THEN ${POINTS_REPOST} ELSE 0 END) + (CASE WHEN o.wallet IS NOT NULL THEN ${POINTS_WALLET} ELSE 0 END))`,
        );
        expect(WAITLIST_ME_POINTS_SQL).toContain(`${pointsSql("o")} > ${pointsSql("m")} OR (${pointsSql("o")} = ${pointsSql("m")} AND o.seq < m.seq)`);
        expect(WAITLIST_POSITION_BY_CODE_POINTS_SQL).toContain(`${pointsSql("o")} > ${pointsSql("m")}`);
        expect(WAITLIST_ME_SQL).toContain("o.referrals > m.referrals OR (o.referrals = m.referrals AND o.seq < m.seq)");
        expect(WAITLIST_ME_SQL).not.toContain("followed_at");
    });
});

describe("W-T70 points: handler", () => {
    const OLD_KEYS = ["joined", "xUserId", "username", "position", "referrals", "refCode", "shareUrl", "wallet", "email", "emailEnabled", "contact"];
    it("flag off: GET answers have exactly the old keys, the referral rank is used, mission is 404", async () => {
        const h = harness();
        expect(await h.me(null)).toEqual({joined: false, emailEnabled: false, contact: null});
        const {session} = await h.signIn("codeA");
        await h.db.store.setWallet("100", "0x" + "a".repeat(40));
        const m = await h.me(session);
        expect(Object.keys(m)).toEqual(OLD_KEYS);
        expect(h.db.ranks.every((r) => r === "referrals")).toBe(true);
        const r = await h.post(session, {action: "mission", mission: "follow"});
        expect(r.status).toBe(404);
        expect(await r.json()).toEqual({error: "disabled"});
        expect(h.db.rows()[0].followed).toBe(false);
    });
    it("flag on, not joined: pointsEnabled and weights after the old keys", async () => {
        expect(await harness(ENV_POINTS).me(null)).toEqual({joined: false, emailEnabled: false, contact: null, pointsEnabled: true, weights: {referral: 10, follow: 5, repost: 5, wallet: 5}});
    });
    it("flag on, joined: points, missions (repost null without a post id), wallet done", async () => {
        const h = harness(ENV_POINTS);
        const {session} = await h.signIn("codeA");
        const m = await h.me(session);
        expect(Object.keys(m)).toEqual([...OLD_KEYS, "pointsEnabled", "weights", "points", "missions"]);
        expect(m).toMatchObject({points: 0, missions: {follow: {done: false, url: "https://x.com/intent/follow?screen_name=MapaeGiwa"}, repost: null, wallet: {done: false}}});
        await h.db.store.setWallet("100", "0x" + "a".repeat(40));
        expect(await h.me(session)).toMatchObject({points: 5, missions: {wallet: {done: true}}});
        expect(h.db.ranks.filter((r) => r === "points").length).toBeGreaterThan(0);
        expect(h.db.ranks).not.toContain("referrals");
    });
    it("mission: counts once, answers my state; bad mission 400; repost off 404; no session 401", async () => {
        const h = harness(ENV_POINTS);
        const {session} = await h.signIn("codeA");
        const r = await h.post(session, {action: "mission", mission: "follow"});
        expect(r.status).toBe(200);
        expect(r.headers.get("cache-control")).toBe("private, no-store");
        const st = await r.json();
        expect(st).toMatchObject({joined: true, points: 5, position: 1, missions: {follow: {done: true}}});
        expect(Object.keys(st)).toEqual(Object.keys(await h.me(session)));
        expect(await (await h.post(session, {action: "mission", mission: "follow"})).json()).toMatchObject({points: 5});
        for (const mission of ["wallet", "like", undefined, 1]) {
            const b = await h.post(session, {action: "mission", mission});
            expect(b.status).toBe(400);
            expect(await b.json()).toEqual({error: "bad_mission"});
        }
        const rp = await h.post(session, {action: "mission", mission: "repost"});
        expect(rp.status).toBe(404);
        expect(await rp.json()).toEqual({error: "disabled"});
        expect(h.db.rows()[0].reposted).toBe(false);
        const none = await h.post(null, {action: "mission", mission: "follow"});
        expect(none.status).toBe(401);
        expect(await none.json()).toEqual({error: "no_session"});
    });
    it("repost mission with a post id: url, counts once; removing the id keeps the 5 points", async () => {
        const h = harness(ENV_POINTS_REPOST);
        const {session} = await h.signIn("codeA");
        expect((await h.me(session)).missions.repost).toEqual({done: false, url: "https://x.com/intent/retweet?tweet_id=1888000000000000001"});
        const st = await (await h.post(session, {action: "mission", mission: "repost"})).json();
        expect(st).toMatchObject({points: 5, missions: {repost: {done: true}}});
        // the same row read after WAITLIST_REPOST_POST_ID is removed: no repost line, the 5 points stay
        const later = harness(ENV_POINTS);
        const l = await later.signIn("codeA");
        (later.db.rows()[0] as {reposted: boolean}).reposted = true;
        const ml = await later.me(l.session);
        expect(ml.missions.repost).toBeNull();
        expect(ml.points).toBe(5);
    });
    it("a misconfigured post id is logged by name only and the repost mission is off", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const h = harness({...ENV_POINTS, WAITLIST_REPOST_POST_ID: "not-a-number-777"});
        const {session} = await h.signIn("codeA");
        expect((await h.me(session)).missions.repost).toBeNull();
        expect(JSON.stringify(err.mock.calls)).toContain("WAITLIST_REPOST_POST_ID");
        expect(JSON.stringify(err.mock.calls)).not.toContain("not-a-number-777");
        err.mockRestore();
    });
    it("tie at 10 points: one referral (A, joined first) ahead of follow + wallet (B); the card uses the same rank", async () => {
        const h = harness(ENV_POINTS);
        const a = await h.signIn("codeA");
        const b = await h.signIn("codeB");
        const codeA = (await h.me(a.session)).refCode;
        // a third account joins through A's link
        h.db.store.join({xid: "300", username: "carol", xCreatedAt: null, followers: 1, refCode: "ZZZZZZZZ", ref: codeA, lang: null});
        await h.post(b.session, {action: "mission", mission: "follow"});
        await h.db.store.setWallet("200", "0x" + "b".repeat(40));
        const ma = await h.me(a.session);
        const mb = await h.me(b.session);
        expect([ma.points, mb.points]).toEqual([10, 10]);
        expect([ma.position, mb.position]).toEqual([1, 2]);
        const cardB = await h.call(`/api/waitlist?card=${mb.refCode}`);
        expect(cardB.status).toBe(200);
        expect(h.rendered.at(-1)).toBe(2);
        expect(h.db.ranks).not.toContain("referrals");
    });
});

// ---------------------------------------------------------------------------------------------
// W-T72: operator stats (GET ?stats=1 with the CRON_SECRET bearer)
// ---------------------------------------------------------------------------------------------

const CRON = "c".repeat(40);
const ENV_STATS: WaitlistEnv = {...ENV, CRON_SECRET: CRON};

describe("W-T72 stats: the suspect rule", () => {
    const joined = new Date("2026-11-23T00:00:00Z");
    const daysBefore = (d: number) => new Date(joined.getTime() - d * 86_400_000);
    it("account age 29 days is young, 30 is not; 9 followers is low, 10 is not; NULL is unknown", () => {
        expect([SUSPECT_MAX_ACCOUNT_AGE_DAYS, SUSPECT_MIN_FOLLOWERS]).toEqual([30, 10]);
        expect(suspectOf({xCreatedAt: daysBefore(29), joinedAt: joined, followers: 100})).toEqual({unknown: false, youngAccount: true, lowFollowers: false, either: true});
        expect(suspectOf({xCreatedAt: daysBefore(30), joinedAt: joined, followers: 100})).toEqual({unknown: false, youngAccount: false, lowFollowers: false, either: false});
        expect(suspectOf({xCreatedAt: daysBefore(400), joinedAt: joined, followers: 9})).toEqual({unknown: false, youngAccount: false, lowFollowers: true, either: true});
        expect(suspectOf({xCreatedAt: daysBefore(400), joinedAt: joined, followers: 10})).toMatchObject({either: false});
        expect(suspectOf({xCreatedAt: null, joinedAt: joined, followers: 1})).toEqual({unknown: true});
        expect(suspectOf({xCreatedAt: daysBefore(1), joinedAt: joined, followers: null})).toEqual({unknown: true});
    });
    it("the SQL uses the same constants and returns no ids, codes, wallets or emails", () => {
        expect(suspectSql("r")).toContain(`interval '${SUSPECT_MAX_ACCOUNT_AGE_DAYS} days'`);
        expect(suspectSql("r")).toContain(`r.followers < ${SUSPECT_MIN_FOLLOWERS}`);
        expect(suspectSql("r")).toContain("r.x_created_at IS NOT NULL AND r.followers IS NOT NULL");
        expect(WAITLIST_STATS_TOP_SQL).toContain(pointsSql("m"));
        const select = WAITLIST_STATS_TOP_SQL.slice(0, WAITLIST_STATS_TOP_SQL.indexOf("FROM mapae_waitlist m"));
        for (const col of ["x_user_id", "ref_code AS", "email", "m.wallet,"]) expect(select).not.toContain(col);
        expect(WAITLIST_STATS_TOTALS_SQL).not.toMatch(/SELECT[^]*\bemail\b AS/);
    });
});

describe("W-T72 stats: handler", () => {
    const get = (h: ReturnType<typeof harness>, q: string, auth?: string) => h.call(`/api/waitlist?${q}`, {headers: auth ? {authorization: auth} : {}});
    it("401 without the bearer, with a wrong one, or with no CRON_SECRET set", async () => {
        const h = harness(ENV_STATS);
        for (const auth of [undefined, "Bearer wrong", CRON, `bearer ${CRON}`]) {
            const r = await get(h, "stats=1", auth);
            expect(r.status, String(auth)).toBe(401);
            expect(await r.json()).toEqual({error: "unauthorized"});
        }
        const noSecret = await get(harness(ENV), "stats=1", "Bearer ");
        expect(noSecret.status).toBe(401);
        expect((await get(harness(ENV), "stats=1", `Bearer ${CRON}`)).status).toBe(401);
        expect(h.db.statsCalls()).toBe(0);
    });
    it("order: the secret before the flag (flag off: 401 without it, 404 with it)", async () => {
        const off = harness({CRON_SECRET: CRON});
        expect((await get(off, "stats=1")).status).toBe(401);
        const r = await get(off, "stats=1", `Bearer ${CRON}`);
        expect(r.status).toBe(404);
        expect(await r.json()).toEqual({error: "disabled"});
    });
    it("400 unless the query is exactly stats=1", async () => {
        const h = harness(ENV_STATS);
        for (const q of ["stats=2", "stats=1&card=x", "stats=", "stats=1&stats=1", "stats=1&v=1"]) {
            const r = await get(h, q, `Bearer ${CRON}`);
            expect(r.status, q).toBe(400);
            expect(await r.json()).toEqual({error: "bad_request"});
        }
        expect(h.db.statsCalls()).toBe(0);
    });
    it("200 no-store, one store read, no handle sign, address, email or wallet in the answer", async () => {
        const h = harness({...ENV_STATS, FEATURE_WAITLIST_POINTS: "1"});
        const a = await h.signIn("codeA");
        const codeA = (await h.me(a.session)).refCode;
        await h.signIn("codeB", `&ref=${codeA}`);
        await h.db.store.setWallet("100", "0x" + "a".repeat(40));
        await h.db.store.setEmail("100", "alice@example.com");
        const r = await get(h, "stats=1", `Bearer ${CRON}`);
        expect(r.status).toBe(200);
        expect(r.headers.get("cache-control")).toBe("no-store");
        expect(h.db.statsCalls()).toBe(1);
        const text = await r.text();
        const body = JSON.parse(text);
        expect(body).toMatchObject({generatedAt: new Date(NOW * 1000).toISOString(), pointsEnabled: true, total: 2, withWallet: 1, withEmail: 1, referred: 1});
        expect(body.topReferrers).toEqual([{username: "alice", referrals: 1, suspectReferrals: 0, points: 15}]);
        expect(text).not.toContain("@");
        expect(text).not.toContain("0x");
        expect(text).not.toContain(codeA);
        expect(text).not.toContain('"100"');
        expect(text).not.toMatch(/"(email|wallet|xUserId|x_user_id|refCode|ref_code)"/);
        expect(Object.keys(body)).toEqual(["generatedAt", "pointsEnabled", "total", "withWallet", "withEmail", "followed", "reposted", "referred", "byDay", "byLang", "referralBuckets", "suspect", "topReferrers"]);
    });
    it("a store error: 503 and logged (no empty count)", async () => {
        const h = harness(ENV_STATS);
        h.db.failStats(true);
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const r = await get(h, "stats=1", `Bearer ${CRON}`);
        expect(r.status).toBe(503);
        expect(await r.json()).toEqual({error: "unavailable"});
        expect(err).toHaveBeenCalled();
        expect(JSON.stringify(err.mock.calls)).not.toContain(CRON);
        err.mockRestore();
    });
    it("HEAD and POST do not take the branch; GET without stats is unchanged", async () => {
        const h = harness(ENV_STATS);
        const head = await h.call("/api/waitlist?stats=1", {method: "HEAD", headers: {authorization: `Bearer ${CRON}`}});
        expect(head.status).toBe(400);
        expect(h.db.statsCalls()).toBe(0);
        expect(await h.me(null)).toEqual({joined: false, emailEnabled: false, contact: null});
    });
});
