// 7-day delegated sessions for social actions (nickname, comments). No server secret:
// the wallet signs (EIP-191) a delegation to a browser-generated key once; each request is then
// signed by that key. Shared by the browser and the Vercel Functions (keep it a leaf module, like
// message.ts: relative imports here would need explicit .js extensions).
import {keccak256, recoverMessageAddress, toBytes} from "viem";

export const SESSION_CHAIN_ID = 91342;
export const SESSION_TTL_SEC = 7 * 24 * 3600;
export const ACTION_SKEW_SEC = 5 * 60;
/** Clock tolerance when checking that a delegation does not exceed 7 days from now. */
export const SESSION_SKEW_SEC = 5 * 60;

export type SocialAction = "set-nickname" | "post-comment" | "delete-comment" | "follow" | "unfollow";

export type SessionProof = {delegate: string; expires: number; signature: string};
export type ActionProof = {issuedAt: number; signature: string};

export function buildSessionMessage(m: {wallet: string; delegate: string; expires: number}): string {
    return ["MAPAE session", `chain: ${SESSION_CHAIN_ID}`, `wallet: ${m.wallet.toLowerCase()}`, `delegate: ${m.delegate.toLowerCase()}`, `expires: ${m.expires}`].join("\n");
}

/** The signed payload of each action, with a fixed key order (both sides build it the same way). */
export function actionPayload(action: "set-nickname", f: {wallet: string; nickname: string}): string;
export function actionPayload(action: "post-comment", f: {wallet: string; curve: string; body: string}): string;
export function actionPayload(action: "delete-comment", f: {wallet: string; id: number}): string;
export function actionPayload(action: "follow" | "unfollow", f: {wallet: string; target: string}): string;
export function actionPayload(action: SocialAction, f: Record<string, unknown>): string {
    const wallet = String(f.wallet).toLowerCase();
    if (action === "set-nickname") return JSON.stringify({wallet, nickname: f.nickname});
    if (action === "post-comment") return JSON.stringify({wallet, curve: String(f.curve).toLowerCase(), body: f.body});
    if (action === "follow" || action === "unfollow") return JSON.stringify({wallet, target: String(f.target).toLowerCase()});
    return JSON.stringify({wallet, id: f.id});
}

export const payloadHash = (payload: string) => keccak256(toBytes(payload));

export function buildActionMessage(m: {action: SocialAction; payloadHash: string; issuedAt: number}): string {
    return ["MAPAE action", `action: ${m.action}`, `payload: ${m.payloadHash}`, `issuedAt: ${m.issuedAt}`].join("\n");
}

export type AuthFailure = "bad_session";
export type AuthResult = {ok: true; wallet: `0x${string}`} | {ok: false; code: AuthFailure; step: 2 | 3 | 4};

const isHexSig = (s: unknown): s is `0x${string}` => typeof s === "string" && /^0x[0-9a-fA-F]{130}$/.test(s);
const isAddr = (s: unknown): s is string => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);

/** Shape check of the auth fields (step 1 for the auth part). */
export function authShapeOk(wallet: unknown, session: unknown, action: unknown): boolean {
    const s = session as SessionProof | null;
    const a = action as ActionProof | null;
    return (
        isAddr(wallet) &&
        !!s && isAddr(s.delegate) && Number.isSafeInteger(s.expires) && isHexSig(s.signature) &&
        !!a && Number.isSafeInteger(a.issuedAt) && isHexSig(a.signature)
    );
}

async function recover(message: string, signature: string): Promise<string | null> {
    try {
        return (await recoverMessageAddress({message, signature: signature as `0x${string}`})).toLowerCase();
    } catch {
        return null;
    }
}

/** Steps 2 to 4 (pure crypto, no RPC or DB): issuedAt window, action signer == delegate,
 *  delegation signer == wallet with a future expiry no more than 7 days ahead. */
export async function verifyAuth(
    req: {wallet: string; action: SocialAction; payload: string; session: SessionProof; proof: ActionProof},
    nowSec: number
): Promise<AuthResult> {
    // 2) issuedAt within +-5 minutes
    if (Math.abs(nowSec - req.proof.issuedAt) > ACTION_SKEW_SEC) return {ok: false, code: "bad_session", step: 2};
    // 3) action signature by the delegate
    const msg = buildActionMessage({action: req.action, payloadHash: payloadHash(req.payload), issuedAt: req.proof.issuedAt});
    if ((await recover(msg, req.proof.signature)) !== req.session.delegate.toLowerCase()) return {ok: false, code: "bad_session", step: 3};
    // 4) delegation by the wallet, still valid, at most 7 days long
    const exp = req.session.expires;
    if (exp <= nowSec || exp > nowSec + SESSION_TTL_SEC + SESSION_SKEW_SEC) return {ok: false, code: "bad_session", step: 4};
    const smsg = buildSessionMessage({wallet: req.wallet, delegate: req.session.delegate, expires: exp});
    if ((await recover(smsg, req.session.signature)) !== req.wallet.toLowerCase()) return {ok: false, code: "bad_session", step: 4};
    return {ok: true, wallet: req.wallet.toLowerCase() as `0x${string}`};
}
