import {describe, expect, it} from "vitest";
import {generatePrivateKey, privateKeyToAccount} from "viem/accounts";
import {actionPayload, buildActionMessage, buildSessionMessage, payloadHash, SESSION_TTL_SEC, SocialAction, verifyAuth} from "./session.js";
import {
    Address,
    cleanBody,
    CommentOut,
    handleDeleteComment,
    handleHideComment,
    handlePostComment,
    handleSetNickname,
    nicknameProblem,
    NICK_COOLDOWN_SEC,
    parseCommentQuery,
    SocialDeps,
} from "./social.js";

// Well-known Anvil test key for the wallet; the delegate is generated per run. Never on a real chain.
const wallet = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const delegate = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const W = wallet.address.toLowerCase() as Address;
const CURVE = ("0x" + "c1".repeat(20)) as Address;
const NOW = 1_800_000_000;

async function sessionProof(o: {expires?: number; signer?: typeof wallet; delegateAddr?: string} = {}) {
    const expires = o.expires ?? NOW + SESSION_TTL_SEC - 60;
    const d = o.delegateAddr ?? delegate.address;
    const signature = await (o.signer ?? wallet).signMessage({message: buildSessionMessage({wallet: W, delegate: d, expires})});
    return {delegate: d.toLowerCase(), expires, signature};
}
async function actionProof(action: SocialAction, payload: string, o: {issuedAt?: number; signer?: typeof delegate} = {}) {
    const issuedAt = o.issuedAt ?? NOW;
    const signature = await (o.signer ?? delegate).signMessage({message: buildActionMessage({action, payloadHash: payloadHash(payload), issuedAt})});
    return {issuedAt, signature};
}

function fakeDeps(o: {verified?: boolean; nickname?: {nickname: string; updatedAtSec: number} | null; taken?: boolean; curveKnown?: boolean; isCurve?: boolean; rate?: {sinceLastSec: number | null; last24h: number}; deleteOk?: boolean} = {}) {
    const calls: string[] = [];
    const c = (name: string) => calls.push(name);
    const comment: CommentOut = {id: 7, nickname: "말발굽", body: "hi", createdAt: "2026-11-14T00:00:00Z", holder: false, dev: false};
    const deps: SocialDeps = {
        db: {
            ensureSchema: async () => void c("ensureSchema"),
            nicknameOf: async () => (c("nicknameOf"), o.nickname === undefined ? {nickname: "말발굽", updatedAtSec: NOW - NICK_COOLDOWN_SEC - 1} : o.nickname),
            setNickname: async () => void c("setNickname"),
            nicknameTakenByOther: async () => (c("taken"), o.taken ?? false),
            curveKnown: async () => (c("curveKnown"), o.curveKnown ?? true),
            commentRate: async () => (c("commentRate"), o.rate ?? {sinceLastSec: null, last24h: 0}),
            insertComment: async (_c, _a, body) => (c("insert"), {...comment, body}),
            deleteComment: async () => (c("delete"), o.deleteOk ?? true),
            hideComment: async () => (c("hide"), true),
            listComments: async () => [],
        },
        chain: {
            isVerified: async () => (c("isVerified"), o.verified ?? true),
            isCurve: async () => (c("isCurve"), o.isCurve ?? false),
        },
        nowSec: NOW,
    };
    return {deps, calls};
}

async function nickBody(nickname: string, o: Parameters<typeof actionProof>[2] = {}, s: Parameters<typeof sessionProof>[0] = {}) {
    return {wallet: W, nickname, session: await sessionProof(s), action: await actionProof("set-nickname", actionPayload("set-nickname", {wallet: W, nickname}), o)};
}
async function commentBody(body: string, curve = CURVE) {
    return {wallet: W, curve, body, session: await sessionProof(), action: await actionProof("post-comment", actionPayload("post-comment", {wallet: W, curve, body}))};
}

describe("session messages and verification", () => {
    it("builds the fixed delegation and action messages", () => {
        expect(buildSessionMessage({wallet: "0xAB", delegate: "0xCD", expires: 5})).toBe("MAPAE session\nchain: 91342\nwallet: 0xab\ndelegate: 0xcd\nexpires: 5");
        expect(buildActionMessage({action: "post-comment", payloadHash: "0x12", issuedAt: 9})).toBe("MAPAE action\naction: post-comment\npayload: 0x12\nissuedAt: 9");
    });
    const payload = actionPayload("set-nickname", {wallet: W, nickname: "abc"});
    const run = async (s: Parameters<typeof sessionProof>[0], a: Parameters<typeof actionProof>[2], p = payload) =>
        verifyAuth({wallet: W, action: "set-nickname", payload: p, session: await sessionProof(s), proof: await actionProof("set-nickname", payload, a)}, NOW);
    it("accepts a valid session", async () => {
        expect(await run({}, {})).toEqual({ok: true, wallet: W});
    });
    it("rejects issuedAt outside +-5 minutes (step 2)", async () => {
        expect(await run({}, {issuedAt: NOW - 301})).toMatchObject({ok: false, step: 2});
        expect(await run({}, {issuedAt: NOW + 301})).toMatchObject({ok: false, step: 2});
    });
    it("rejects an action signed by another key and a payload hash mismatch (step 3)", async () => {
        expect(await run({}, {signer: other})).toMatchObject({ok: false, step: 3});
        expect(await run({}, {}, actionPayload("set-nickname", {wallet: W, nickname: "abd"}))).toMatchObject({ok: false, step: 3});
        expect(await run({delegateAddr: other.address}, {})).toMatchObject({ok: false, step: 3});
    });
    it("rejects expired, over-7-day and other-wallet delegations (step 4)", async () => {
        expect(await run({expires: NOW - 1}, {})).toMatchObject({ok: false, step: 4});
        expect(await run({expires: NOW + SESSION_TTL_SEC + 3600}, {})).toMatchObject({ok: false, step: 4});
        expect(await run({signer: other}, {})).toMatchObject({ok: false, step: 4});
    });
    it("steps 1-4 failing never call isVerified or the DB", async () => {
        const {deps, calls} = fakeDeps();
        expect((await handleSetNickname(await nickBody("말발굽2", {issuedAt: NOW - 999}), deps)).status).toBe(401);
        expect((await handleSetNickname(await nickBody("말발굽2", {signer: other}), deps)).status).toBe(401);
        expect((await handleSetNickname(await nickBody("말발굽2", {}, {expires: NOW - 1}), deps)).status).toBe(401);
        expect((await handleSetNickname({wallet: W, nickname: "x"}, deps)).status).toBe(400);
        expect(calls).toEqual([]);
    });
});

describe("nickname", () => {
    it("rules: length, characters, NFKC, banned words", () => {
        expect(nicknameProblem("가")).toBe("length");
        expect(nicknameProblem("a".repeat(17))).toBe("length");
        expect(nicknameProblem(" 말발굽 ")).toBeNull();
        expect(nicknameProblem("horse_01")).toBeNull();
        expect(nicknameProblem("말 발굽")).toBe("chars");
        expect(nicknameProblem("ㅋㅋㅋ")).toBe("chars"); // lone jamo are not complete syllables
        expect(nicknameProblem("ㅁㅏ패")).toBe("banned"); // NFKC composes the jamo into 마패
        expect(nicknameProblem("ＡＢＣ")).toBeNull(); // NFKC: full-width -> ABC
        expect(nicknameProblem("ＭＡＰＡＥfan")).toBe("banned");
        expect(nicknameProblem("TheDevGuy")).toBe("banned");
        expect(nicknameProblem("업비트짱")).toBe("banned");
    });
    it("sets a first nickname without cooldown", async () => {
        const {deps, calls} = fakeDeps({nickname: null});
        expect(await handleSetNickname(await nickBody("말발굽"), deps)).toEqual({status: 200, body: {nickname: "말발굽"}});
        expect(calls).toEqual(["isVerified", "ensureSchema", "nicknameOf", "taken", "setNickname"]);
    });
    it("rejects unverified wallets, case-insensitive duplicates and changes within 7 days", async () => {
        expect((await handleSetNickname(await nickBody("Horse"), fakeDeps({verified: false}).deps)).body).toEqual({error: "not_verified"});
        expect((await handleSetNickname(await nickBody("Horse"), fakeDeps({nickname: null, taken: true}).deps)).body).toEqual({error: "nickname_taken"});
        const recent = {nickname: "old", updatedAtSec: NOW - 100};
        expect(await handleSetNickname(await nickBody("Horse"), fakeDeps({nickname: recent}).deps)).toEqual({status: 429, body: {error: "nickname_cooldown", nextAt: recent.updatedAtSec + NICK_COOLDOWN_SEC}});
        expect((await handleSetNickname(await nickBody("관리자님"), fakeDeps().deps)).body).toEqual({error: "bad_nickname"});
    });
});

describe("comments", () => {
    it("cleans the body: trim, control characters, at most two newlines", () => {
        expect(cleanBody("  hi\u0007 there \r\n\r\n\r\n\nend  ")).toBe("hi there \n\nend");
        expect(cleanBody("a\tb")).toBe("a\tb");
    });
    it("posts for a verified wallet with a nickname", async () => {
        const {deps, calls} = fakeDeps();
        const r = await handlePostComment(await commentBody(" hello "), deps);
        expect(r.status).toBe(201);
        expect((r.body as CommentOut).body).toBe("hello");
        expect(calls).toEqual(["isVerified", "ensureSchema", "curveKnown", "nicknameOf", "commentRate", "insert"]);
    });
    it("length 1..280 after cleaning", async () => {
        expect((await handlePostComment(await commentBody("   "), fakeDeps().deps)).body).toEqual({error: "bad_body"});
        expect((await handlePostComment(await commentBody("a".repeat(281)), fakeDeps().deps)).body).toEqual({error: "bad_body"});
        expect((await handlePostComment(await commentBody("가".repeat(280)), fakeDeps().deps)).status).toBe(201);
    });
    it("not_verified, nickname_required, too_fast, daily_limit", async () => {
        expect((await handlePostComment(await commentBody("hi"), fakeDeps({verified: false}).deps)).body).toEqual({error: "not_verified"});
        expect((await handlePostComment(await commentBody("hi"), fakeDeps({nickname: null}).deps)).body).toEqual({error: "nickname_required"});
        expect((await handlePostComment(await commentBody("hi"), fakeDeps({rate: {sinceLastSec: 9, last24h: 1}}).deps)).body).toEqual({error: "too_fast"});
        expect((await handlePostComment(await commentBody("hi"), fakeDeps({rate: {sinceLastSec: 11, last24h: 50}}).deps)).body).toEqual({error: "daily_limit"});
    });
    it("not_curve when neither the index nor the chain knows it; a just-launched curve passes on chain", async () => {
        expect((await handlePostComment(await commentBody("hi"), fakeDeps({curveKnown: false, isCurve: false}).deps)).body).toEqual({error: "not_curve"});
        expect((await handlePostComment(await commentBody("hi"), fakeDeps({curveKnown: false, isCurve: true}).deps)).status).toBe(201);
    });
    it("delete is limited to the author (the DB update matches author)", async () => {
        const body = async (id: number) => ({wallet: W, id, session: await sessionProof(), action: await actionProof("delete-comment", actionPayload("delete-comment", {wallet: W, id}))});
        expect(await handleDeleteComment(await body(7), fakeDeps().deps)).toEqual({status: 200, body: {ok: true}});
        expect(await handleDeleteComment(await body(8), fakeDeps({deleteOk: false}).deps)).toEqual({status: 404, body: {error: "not_found"}});
    });
    it("hide checks the bearer secret before anything else", async () => {
        const {deps, calls} = fakeDeps();
        expect((await handleHideComment("Bearer x", "y", {id: 1, hidden: true}, deps)).status).toBe(401);
        expect((await handleHideComment("Bearer ", "", {id: 1, hidden: true}, deps)).status).toBe(401);
        expect((await handleHideComment(null, "y", {id: 1, hidden: true}, deps)).status).toBe(401);
        expect(calls).toEqual([]);
        expect(await handleHideComment("Bearer y", "y", {id: 1, hidden: true}, deps)).toEqual({status: 200, body: {ok: true, id: 1, hidden: true}});
    });
    it("validates list query params", () => {
        expect(parseCommentQuery(new URLSearchParams(`curve=${CURVE}`))).toEqual({curve: CURVE, before: undefined, limit: 30});
        expect(parseCommentQuery(new URLSearchParams(`curve=${CURVE}&before=12&limit=50`))).toEqual({curve: CURVE, before: 12, limit: 50});
        expect(parseCommentQuery(new URLSearchParams(`curve=${CURVE}&limit=51`))).toBeNull();
        expect(parseCommentQuery(new URLSearchParams(`curve=0x12`))).toBeNull();
    });
});
