// Browser side of the 7-day delegated session: a throwaway key in localStorage (memory when
// storage is unavailable), delegated once by a wallet signature (EIP-191, no gas). Requests are
// then signed by that key, so posting a comment never opens the wallet again.
import {useCallback} from "react";
import {useSignMessage} from "wagmi";
import {generatePrivateKey, privateKeyToAccount} from "viem/accounts";
import {actionPayload, ActionProof, buildActionMessage, buildSessionMessage, payloadHash, SESSION_TTL_SEC, SessionProof, SocialAction} from "../../api/_lib/session";

export type StoredSession = {wallet: string; key: `0x${string}`; delegate: string; expires: number; signature: `0x${string}`; mine: number[]};

const KEY = (wallet: string) => `mapae.session.${wallet.toLowerCase()}`;
const memory = new Map<string, StoredSession>();
/** A session must have at least this long left to be used (seconds). */
export const SESSION_MIN_LEFT = 60;

export function sessionUsable(s: StoredSession | null | undefined, wallet: string, nowSec: number): s is StoredSession {
    return !!s && s.wallet === wallet.toLowerCase() && s.expires > nowSec + SESSION_MIN_LEFT;
}

export function loadSession(wallet: string): StoredSession | null {
    const k = KEY(wallet);
    try {
        const raw = window.localStorage.getItem(k);
        if (raw) return JSON.parse(raw) as StoredSession;
    } catch {
        // storage blocked or corrupt: fall back to memory
    }
    return memory.get(k) ?? null;
}

export function saveSession(s: StoredSession): void {
    const k = KEY(s.wallet);
    memory.set(k, s);
    try {
        window.localStorage.setItem(k, JSON.stringify(s));
    } catch {
        // memory only for this tab
    }
}

export function dropSession(wallet: string): void {
    const k = KEY(wallet);
    memory.delete(k);
    try {
        window.localStorage.removeItem(k);
    } catch {
        // nothing stored
    }
}

/** Comment ids this browser posted with this wallet (the API never returns author addresses). */
export function rememberMine(wallet: string, id: number): void {
    const s = loadSession(wallet);
    if (s && !s.mine.includes(id)) saveSession({...s, mine: [id, ...s.mine].slice(0, 500)});
}
export const isMine = (wallet: string | undefined, id: number) => !!wallet && !!loadSession(wallet)?.mine.includes(id);

export type Signed = {wallet: string; session: SessionProof; action: ActionProof};

/** Proofs for one request, signed by the session key. */
export async function signWithSession(s: StoredSession, action: SocialAction, payload: string, nowSec: number): Promise<Signed> {
    const acct = privateKeyToAccount(s.key);
    const signature = await acct.signMessage({message: buildActionMessage({action, payloadHash: payloadHash(payload), issuedAt: nowSec})});
    return {wallet: s.wallet, session: {delegate: s.delegate, expires: s.expires, signature: s.signature}, action: {issuedAt: nowSec, signature}};
}

export function useSession() {
    const {signMessageAsync} = useSignMessage();
    /** A usable session for `wallet`, asking the wallet to sign a new delegation when needed. */
    const ensure = useCallback(
        async (wallet: string): Promise<StoredSession> => {
            const now = Math.floor(Date.now() / 1000);
            const cur = loadSession(wallet);
            const prevMine = cur?.wallet === wallet.toLowerCase() ? cur.mine : [];
            if (sessionUsable(cur, wallet, now)) return cur;
            if (cur) dropSession(wallet);
            const key = generatePrivateKey();
            const delegate = privateKeyToAccount(key).address.toLowerCase();
            const expires = now + SESSION_TTL_SEC;
            const w = wallet.toLowerCase();
            const signature = await signMessageAsync({message: buildSessionMessage({wallet: w, delegate, expires})});
            const s: StoredSession = {wallet: w, key, delegate, expires, signature, mine: prevMine};
            saveSession(s);
            return s;
        },
        [signMessageAsync]
    );
    return {ensure, has: (wallet: string | undefined) => !!wallet && sessionUsable(loadSession(wallet), wallet, Math.floor(Date.now() / 1000))};
}

export {actionPayload};
