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
    REF_ALPHABET,
    refCodeFrom,
    walletMessage,
    waitlistConfig,
    WaitlistEnv,
    WaitlistRow,
    waitlistShareHtml,
    shareImage,
    SHARE_TITLE,
    SHARE_DESCRIPTION,
    X_AUTHORIZE,
    X_ME,
    X_SCOPE,
    X_TOKEN,
} from "./waitlist.js";
import {b64url, fromB64url, handleWaitlist, MAX_REF_DRAWS, OAuthPayload, readCookie, signCookie, verifyCookie, WaitlistDeps, WaitlistStore} from "./waitlistApi.js";
import {WAITLIST_JOIN_SQL, WAITLIST_ME_SQL, WaitlistJoin, WaitlistMe} from "./db.js";

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
        expect(h).toContain('<meta property="og:image" content="https://mapae.fun/og-waitlist.png" />');
        expect(h).toContain('<meta name="twitter:image" content="https://mapae.fun/og-waitlist.png" />');
        expect(h).toContain('<meta property="og:image:width" content="1200" />');
        expect(h).toContain('<meta property="og:image:height" content="630" />');
        expect(h).toContain('<meta name="twitter:image:alt" content="MAPAE Waitlist" />');
        expect(h).not.toContain("logo.png");
        expect(SHARE_TITLE).toBe("MAPAE Waitlist");
        expect(SHARE_DESCRIPTION).toBe("Everyone starts from the same line.");
        const other = waitlistShareHtml("https://example.test", "ABCDEFGH");
        const imgs = [...other.matchAll(/(?:og:image|twitter:image)" content="([^"]+)"/g)].map((m) => m[1]);
        expect(imgs).toEqual(["https://example.test/og-waitlist.png", "https://example.test/og-waitlist.png"]);
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

type Row = WaitlistRow & {wallet: string | null; email: string | null};

function memStore() {
    let rows: Row[] = [];
    const store: WaitlistStore = {
        async join(j: WaitlistJoin) {
            if (rows.some((r) => r.refCode === j.refCode && r.xid !== j.xid)) return "ref_code_taken";
            const r = applyJoin(rows, {xid: j.xid, username: j.username, followers: j.followers, refCode: j.refCode, ref: j.ref});
            rows = r.rows.map((x) => ({wallet: null, email: null, ...x}) as Row);
            return {inserted: r.inserted};
        },
        async me(xid): Promise<WaitlistMe | null> {
            const r = rows.find((x) => x.xid === xid);
            return r ? {username: r.username, refCode: r.refCode, referrals: r.referrals, wallet: r.wallet, email: r.email, position: positionOf(rows, xid)!} : null;
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
    };
    return {store, rows: () => rows};
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
    const deps: WaitlistDeps = {env, store: () => db.store, fetch: x.f, nowSec: () => NOW, random: (k) => new Uint8Array(k).map((_, i) => (i + 7 * ++n) % 248)};
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
    return {db, x, call, cookies, signIn, me, post, setMode: (m: XMode) => (mode = m)};
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
