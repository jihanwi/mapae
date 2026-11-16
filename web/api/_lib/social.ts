// Pure rules and handlers for nicknames and comments. DB and chain reads are injected.
// Server-side order for every write: 1) shape, 2-4) session (session.ts), 5) isVerified, then
// the action's own checks. Steps 1-4 never call the chain or the DB.
import {actionPayload, authShapeOk, SessionProof, ActionProof, verifyAuth, SocialAction} from "./session.js";

export type Address = `0x${string}`;
export type Result = {status: number; body: unknown};
const err = (status: number, error: string, extra: Record<string, unknown> = {}): Result => ({status, body: {error, ...extra}});
const lc = (s: string) => s.toLowerCase() as Address;

// ---------------------------------------------------------------------------------------------
// Nickname rules
// ---------------------------------------------------------------------------------------------

export const NICK_MIN = 2;
export const NICK_MAX = 16;
export const NICK_COOLDOWN_SEC = 7 * 24 * 3600;
export const BANNED = ["mapae", "마패", "admin", "운영자", "관리자", "official", "공식", "dev", "giwa", "upbit", "업비트"];

/** NFKC, trimmed. */
export const normalizeNickname = (s: string) => s.normalize("NFKC").trim();

export type NickProblem = "length" | "chars" | "banned";
/** null when valid. Checked on the normalized value. */
export function nicknameProblem(raw: string): NickProblem | null {
    const n = normalizeNickname(raw);
    const len = [...n].length;
    if (len < NICK_MIN || len > NICK_MAX) return "length";
    if (!/^[가-힣A-Za-z0-9_]+$/.test(n)) return "chars";
    const l = n.toLowerCase();
    if (BANNED.some((b) => l.includes(b))) return "banned";
    return null;
}

// ---------------------------------------------------------------------------------------------
// Comment rules
// ---------------------------------------------------------------------------------------------

export const BODY_MAX = 280;
export const TOO_FAST_SEC = 10;
export const DAILY_LIMIT = 50;

/** Control characters removed (newline and tab kept as text), bidi controls and zero-width spaces
 *  removed (U+061C, U+200B, U+200E, U+200F, U+202A-U+202E, U+2060, U+2066-U+2069, U+FEFF; ZWNJ
 *  U+200C and ZWJ U+200D are kept for emoji sequences), at most 2 consecutive newlines, trimmed.
 *  Signatures are checked against the raw body; this only shapes what is stored and measured. */
export function cleanBody(raw: string): string {
    return raw
        .replace(/\r\n?/g, "\n")
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
        .replace(/[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
export const bodyLength = (s: string) => [...s].length;

// ---------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------

export type CommentOut = {id: number; nickname: string; body: string; author: string; createdAt: string; holder: boolean; dev: boolean};

export interface SocialDb {
    ensureSchema(): Promise<void>;
    nicknameOf(address: Address): Promise<{nickname: string; updatedAtSec: number} | null>;
    /** Throws {code: "23505"} style errors are mapped by the caller via `isUniqueViolation`. */
    setNickname(address: Address, nickname: string, nicknameLc: string): Promise<void>;
    nicknameTakenByOther(nicknameLc: string, address: Address): Promise<boolean>;
    curveKnown(curve: Address): Promise<boolean>;
    /** Seconds since the author's last comment (null if none) and comments in the last 24 h, in one query. */
    commentRate(author: Address): Promise<{sinceLastSec: number | null; last24h: number}>;
    insertComment(curve: Address, author: Address, body: string): Promise<CommentOut>;
    /** true when a row of this author was marked deleted. */
    deleteComment(id: number, author: Address): Promise<boolean>;
    hideComment(id: number, hidden: boolean): Promise<boolean>;
    listComments(curve: Address, before: number | undefined, limit: number): Promise<CommentOut[]>;
}

export interface SocialChain {
    isVerified(wallet: Address): Promise<boolean>;
    isCurve(curve: Address): Promise<boolean>;
}

export type SocialDeps = {db: SocialDb; chain: SocialChain; nowSec: number};

export const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as {code?: string}).code === "23505";

/** Steps 1 (auth shape) to 5. Returns the wallet or an error result. */
async function authorize(b: Record<string, unknown>, action: SocialAction, payload: string, deps: SocialDeps): Promise<{wallet: Address} | Result> {
    const r = await verifyAuth({wallet: String(b.wallet), action, payload, session: b.session as SessionProof, proof: b.action as ActionProof}, deps.nowSec);
    if (!r.ok) return err(401, r.code);
    // 5) only now touch the chain
    if (!(await deps.chain.isVerified(r.wallet))) return err(403, "not_verified");
    return {wallet: r.wallet};
}

const asObj = (body: unknown): Record<string, unknown> | null => (typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null);

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

export async function handleSetNickname(body: unknown, deps: SocialDeps): Promise<Result> {
    const b = asObj(body);
    // 1) shape and length
    if (!b || typeof b.nickname !== "string" || !authShapeOk(b.wallet, b.session, b.action)) return err(400, "bad_request");
    if (b.nickname.length > 64 || nicknameProblem(b.nickname)) return err(400, "bad_nickname");
    const payload = actionPayload("set-nickname", {wallet: String(b.wallet), nickname: b.nickname});
    const auth = await authorize(b, "set-nickname", payload, deps);
    if ("status" in auth) return auth;
    const nickname = normalizeNickname(b.nickname);
    const nickLc = nickname.toLowerCase();
    await deps.db.ensureSchema();
    const current = await deps.db.nicknameOf(auth.wallet);
    if (current && current.nickname === nickname) return {status: 200, body: {nickname}};
    if (current && deps.nowSec - current.updatedAtSec < NICK_COOLDOWN_SEC) {
        return err(429, "nickname_cooldown", {nextAt: current.updatedAtSec + NICK_COOLDOWN_SEC});
    }
    if (await deps.db.nicknameTakenByOther(nickLc, auth.wallet)) return err(409, "nickname_taken");
    try {
        await deps.db.setNickname(auth.wallet, nickname, nickLc);
    } catch (e) {
        if (isUniqueViolation(e)) return err(409, "nickname_taken");
        throw e;
    }
    return {status: 200, body: {nickname}};
}

export async function handlePostComment(body: unknown, deps: SocialDeps): Promise<Result> {
    const b = asObj(body);
    if (!b || typeof b.body !== "string" || typeof b.curve !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(b.curve) || !authShapeOk(b.wallet, b.session, b.action)) {
        return err(400, "bad_request");
    }
    const text = cleanBody(b.body);
    if (b.body.length > 4 * BODY_MAX || bodyLength(text) < 1 || bodyLength(text) > BODY_MAX) return err(400, "bad_body");
    const payload = actionPayload("post-comment", {wallet: String(b.wallet), curve: b.curve, body: b.body});
    const auth = await authorize(b, "post-comment", payload, deps);
    if ("status" in auth) return auth;
    const curve = lc(b.curve);
    await deps.db.ensureSchema();
    if (!(await deps.db.curveKnown(curve)) && !(await deps.chain.isCurve(curve))) return err(404, "not_curve");
    if (!(await deps.db.nicknameOf(auth.wallet))) return err(409, "nickname_required");
    const rate = await deps.db.commentRate(auth.wallet);
    if (rate.sinceLastSec !== null && rate.sinceLastSec < TOO_FAST_SEC) return err(429, "too_fast");
    if (rate.last24h >= DAILY_LIMIT) return err(429, "daily_limit");
    return {status: 201, body: await deps.db.insertComment(curve, auth.wallet, text)};
}

export async function handleDeleteComment(body: unknown, deps: SocialDeps): Promise<Result> {
    const b = asObj(body);
    if (!b || !Number.isSafeInteger(b.id) || (b.id as number) <= 0 || !authShapeOk(b.wallet, b.session, b.action)) return err(400, "bad_request");
    const payload = actionPayload("delete-comment", {wallet: String(b.wallet), id: b.id as number});
    const auth = await authorize(b, "delete-comment", payload, deps);
    if ("status" in auth) return auth;
    await deps.db.ensureSchema();
    if (!(await deps.db.deleteComment(b.id as number, auth.wallet))) return err(404, "not_found");
    return {status: 200, body: {ok: true}};
}

/** Constant-time comparison (length is not secret). */
function same(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
}

/** Operator hide. The bearer check comes before anything else; an empty secret always fails. */
export async function handleHideComment(authorization: string | null, secret: string | undefined, body: unknown, deps: {db: Pick<SocialDb, "ensureSchema" | "hideComment">}): Promise<Result> {
    if (!secret || !authorization || !same(authorization, `Bearer ${secret}`)) return err(401, "unauthorized");
    const b = asObj(body);
    if (!b || !Number.isSafeInteger(b.id) || typeof b.hidden !== "boolean") return err(400, "bad_request");
    await deps.db.ensureSchema();
    if (!(await deps.db.hideComment(b.id as number, b.hidden))) return err(404, "not_found");
    return {status: 200, body: {ok: true, id: b.id, hidden: b.hidden}};
}

export function parseCommentQuery(p: URLSearchParams): {curve: Address; before: number | undefined; limit: number} | null {
    const curve = p.get("curve");
    const before = p.get("before");
    const limit = p.get("limit");
    if (!curve || !/^0x[0-9a-fA-F]{40}$/.test(curve)) return null;
    if (before !== null && !/^\d{1,15}$/.test(before)) return null;
    if (limit !== null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 50)) return null;
    return {curve: lc(curve), before: before === null ? undefined : Number(before), limit: limit === null ? 30 : Number(limit)};
}

// ---------------------------------------------------------------------------------------------
// Follows (decision 53). Anyone with a session may follow; the follower's real-name status at
// follow time is stored, and only verified follows count as followers on profiles.
// ---------------------------------------------------------------------------------------------

export const FOLLOW_LIMIT = 500;

export interface FollowDb {
    /** Whether follower already follows target, and how many wallets follower follows (one query). */
    followState(follower: Address, target: Address): Promise<{exists: boolean; count: number}>;
    insertFollow(follower: Address, target: Address, verified: boolean, ts: number): Promise<void>;
    deleteFollow(follower: Address, target: Address): Promise<void>;
    /** After a write, one query: the target's verified followers, the follower's following count,
     *  and whether the relation exists. Returned by POST so the page never needs the cached GET. */
    afterFollow(follower: Address, target: Address): Promise<FollowAfter>;
}
export type FollowAfter = {isFollowing: boolean; targetFollowers: number; myFollowing: number};
export type FollowDeps = {db: FollowDb; chain: Pick<SocialChain, "isVerified">; nowSec: number};

const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** POST /api/profile/follow {action: "follow" | "unfollow", target, wallet, session, action proof
 *  in `proof`}. Order: shape, session (steps 2-4), self check, then the DB / chain. Idempotent: an
 *  existing follow answers 200 unchanged; unfollowing a missing relation answers 200. A failed
 *  isVerified read throws (the caller answers 503); a follow is never stored as unverified for it. */
export async function handleFollow(body: unknown, deps: FollowDeps): Promise<Result> {
    const b = asObj(body);
    const kind = b?.action;
    if (!b || (kind !== "follow" && kind !== "unfollow") || typeof b.target !== "string" || !ADDR.test(b.target) || !authShapeOk(b.wallet, b.session, b.proof)) {
        return err(400, "bad_request");
    }
    const payload = actionPayload(kind, {wallet: String(b.wallet), target: b.target});
    const r = await verifyAuth({wallet: String(b.wallet), action: kind, payload, session: b.session as SessionProof, proof: b.proof as ActionProof}, deps.nowSec);
    if (!r.ok) return err(401, r.code);
    const target = lc(b.target);
    if (target === r.wallet) return err(400, "self_follow");
    const done = async (): Promise<Result> => {
        const a = await deps.db.afterFollow(r.wallet, target);
        return {status: 200, body: {following: a.isFollowing, ...a}};
    };
    if (kind === "unfollow") {
        await deps.db.deleteFollow(r.wallet, target);
        return done();
    }
    const st = await deps.db.followState(r.wallet, target);
    if (st.exists) return done();
    if (st.count >= FOLLOW_LIMIT) return err(409, "follow_limit", {limit: FOLLOW_LIMIT});
    const verified = await deps.chain.isVerified(r.wallet);
    await deps.db.insertFollow(r.wallet, target, verified, deps.nowSec);
    return done();
}
