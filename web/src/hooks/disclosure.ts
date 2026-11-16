// Offering disclosures (decision 58, W-T34): read GET /api/meta?disclosure=<offering>, save with the
// issuer's personal_sign (no gas). The document is normalized and hashed by the same module the
// server uses (api/_lib/disclosure), so the signed hash matches what the server rebuilds.
import {useCallback, useState} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useAccount, useSignMessage} from "wagmi";
import {
    buildDisclosureMessage,
    canonicalJson,
    cleanText,
    DisclosureDoc,
    DisclosureKind,
    EMPTY_DOC,
    normalizeDoc,
    sha256Text,
} from "../../api/_lib/disclosure";
import {classifyConnectError} from "../lib/connectError";
import {API_BASE} from "./meta";

export type DisclosureVersion = {
    version: number;
    doc: DisclosureDoc;
    sha256: string;
    signer: string;
    issuedAt: string;
    savedAt: string;
    postCommit: boolean;
    edits: number;
};
export type Addendum = {n: number; text: string; sha256: string; signer: string; issuedAt: string; savedAt: string};
export type DisclosureState = {offering: string; hidden: boolean; disclosure: DisclosureVersion | null; locked: boolean; lockedAt: string | null; addenda: Addendum[]};

const key = (o: string | undefined) => ["disclosure", o?.toLowerCase()];

// ---- right after a save (W-T35) ----
// The GET is CDN-cached (s-maxage=15), so a re-read right after a save can return the old state.
// The POST answer (plus what was just sent) fills the cache at once; for DISCLOSURE_PROTECT_MS the
// cached state is not replaced by a re-read, then it is re-read once (as follow.ts, W-T29).

export const DISCLOSURE_PROTECT_MS = 20_000;
const protectedUntil = new Map<string, number>();

/** True while `offering`'s cached disclosure must not be re-read (pure: map and clock passed in). */
export function disclosureProtected(until: ReadonlyMap<string, number>, offering: string, nowMs: number): boolean {
    return (until.get(offering.toLowerCase()) ?? 0) > nowMs;
}

export type DocAnswer = {version: number; sha256: string; postCommit: boolean; locked: boolean; savedAt: string};
export type AddendumAnswer = {n: number; sha256: string; savedAt: string};

/** Cache state after a document save: the sent document with the answer's version, hash, lock and
 *  server time. Addenda, hidden and lockedAt stay as they were (lockedAt is not in the answer; a
 *  first fetch with no cache yet starts from "none known"). */
export function afterDocSave(
    prev: DisclosureState | undefined,
    offering: string,
    sent: {doc: DisclosureDoc; issuedAt: string; signer: string},
    ans: DocAnswer
): DisclosureState {
    return {
        offering: offering.toLowerCase(),
        hidden: prev?.hidden ?? false,
        disclosure: {
            version: ans.version,
            doc: sent.doc,
            sha256: ans.sha256,
            signer: sent.signer.toLowerCase(),
            issuedAt: sent.issuedAt,
            savedAt: ans.savedAt,
            postCommit: ans.postCommit,
            edits: ans.version - 1,
        },
        locked: ans.locked || (prev?.locked ?? false),
        lockedAt: prev?.lockedAt ?? null,
        addenda: prev?.addenda ?? [],
    };
}

/** Cache state after an additional disclosure: appended by its number (an entry with the same
 *  number is not doubled). undefined without a cached state to append to (then it is re-read). */
export function afterAddendumSave(prev: DisclosureState | undefined, sent: {text: string; issuedAt: string; signer: string}, ans: AddendumAnswer): DisclosureState | undefined {
    if (!prev) return undefined;
    const entry: Addendum = {n: ans.n, text: sent.text, sha256: ans.sha256, signer: sent.signer.toLowerCase(), issuedAt: sent.issuedAt, savedAt: ans.savedAt};
    const addenda = [...prev.addenda.filter((a) => a.n !== ans.n), entry].sort((a, b) => a.n - b.n);
    return {...prev, locked: true, addenda};
}

// ---- an older CDN copy never replaces a newer cached state (W-T36) ----
// The GET is s-maxage=15, stale-while-revalidate=60: for up to ~75 s after a save a request can get
// the previous answer. Such an answer is dropped and the GET is retried 15 s later (at most 3 times).

export const STALE_RETRY_MS = 15_000;
export const STALE_RETRY_MAX = 3;
const staleRetries = new Map<string, number>();

/** True when `fresh` is older than what the screen already has: a lower version, the same version
 *  with fewer additional disclosures, or no document where the cache has one. A hidden answer is
 *  always taken. */
export function olderThanCache(cached: DisclosureState | undefined, fresh: DisclosureState): boolean {
    if (!cached || fresh.hidden) return false;
    if (cached.disclosure && !fresh.disclosure) return true;
    if (!cached.disclosure || !fresh.disclosure) return false;
    if (fresh.disclosure.version < cached.disclosure.version) return true;
    return fresh.disclosure.version === cached.disclosure.version && fresh.addenda.length < cached.addenda.length;
}

/** What to do with a GET answer: keep the cache (and whether to retry) or take the answer. */
export function onFetched(cached: DisclosureState | undefined, fresh: DisclosureState, retriesSoFar: number): {use: "cache" | "fresh"; retry: boolean} {
    if (!olderThanCache(cached, fresh)) return {use: "fresh", retry: false};
    return {use: "cache", retry: retriesSoFar < STALE_RETRY_MAX};
}

/** The offering's disclosure; an error state on failure (never read as "no disclosure"). */
export function useDisclosure(offering: string | undefined) {
    const qc = useQueryClient();
    return useQuery({
        queryKey: key(offering),
        enabled: !!offering,
        retry: 1,
        queryFn: async () => {
            // just after a save: keep the saved state instead of a possibly old CDN copy
            const cached = qc.getQueryData<DisclosureState>(key(offering));
            if (cached && disclosureProtected(protectedUntil, offering!, Date.now())) return cached;
            const r = await fetch(`${API_BASE}/api/meta?disclosure=${offering!.toLowerCase()}`);
            if (!r.ok) {
                const e = new Error(`disclosure ${r.status}`);
                console.warn("disclosure read failed", e);
                throw e;
            }
            const fresh = (await r.json()) as DisclosureState;
            const o = offering!.toLowerCase();
            const decision = onFetched(cached, fresh, staleRetries.get(o) ?? 0);
            if (decision.use === "fresh") {
                staleRetries.delete(o);
                return fresh;
            }
            console.warn("disclosure: dropped an older CDN copy", {cached: cached?.disclosure?.version, fresh: fresh.disclosure?.version});
            if (decision.retry) {
                staleRetries.set(o, (staleRetries.get(o) ?? 0) + 1);
                setTimeout(() => void qc.invalidateQueries({queryKey: key(offering)}), STALE_RETRY_MS);
            }
            return cached!;
        },
    });
}

export type SaveResult = {ok: true} | {ok: false; code: string; problems?: {field: string; error: string; phrase?: string}[]};

/** Resends of the SAME signed request (no new wallet signature): right after OfferingCreated the
 *  server's RPC may not see the offering yet (not_offering) or answer a temporary error. */
export type SaveOpts = {resends?: number; resendGapMs?: number};
export const RESEND_GAP_MS = 2_000;

/** Whether a failed POST is worth sending again as is. */
export function resendable(status: number | null, code: string | undefined): boolean {
    if (status === null) return true; // network error
    if (status === 404 && code === "not_offering") return true;
    return status === 503 || status === 502 || status === 504;
}

/** Signs and saves a document or an additional disclosure. Refetches the disclosure on success. */
export function useSaveDisclosure() {
    const {signMessageAsync} = useSignMessage();
    const {address} = useAccount();
    const qc = useQueryClient();
    const [busy, setBusy] = useState(false);
    const save = useCallback(
        async (offering: string, kind: DisclosureKind, content: DisclosureDoc | string, opts: SaveOpts = {}): Promise<SaveResult> => {
            setBusy(true);
            try {
                const issuedAt = new Date().toISOString();
                const doc = kind === "disclosure" ? normalizeDoc(content) : null;
                const text = kind === "addendum" ? cleanText(content, true) : "";
                const sha256 = await sha256Text(doc ? canonicalJson(doc) : text);
                let signature: `0x${string}`;
                try {
                    signature = await signMessageAsync({message: buildDisclosureMessage({offering, kind, sha256, issuedAt})});
                } catch (e) {
                    return {ok: false, code: classifyConnectError(e) === "rejected" ? "rejected" : "bad_signature"};
                }
                const payload = JSON.stringify({kind, offering, issuedAt, signature, ...(doc ? {doc} : {text})});
                type Body = {error?: string; problems?: {field: string; error: string; phrase?: string}[]} & Partial<DocAnswer & AddendumAnswer>;
                let status: number | null = null;
                let body: Body = {};
                for (let attempt = 0; ; attempt++) {
                    try {
                        const r = await fetch(`${API_BASE}/api/meta`, {method: "POST", headers: {"content-type": "application/json"}, body: payload});
                        status = r.status;
                        body = (await r.json().catch(() => ({}))) as Body;
                    } catch (e) {
                        console.warn("disclosure save: network error", e);
                        status = null;
                        body = {};
                    }
                    if (status !== null && status >= 200 && status < 300) break;
                    console.warn("disclosure save refused", status, body.error);
                    if (attempt >= (opts.resends ?? 0) || !resendable(status, body.error)) {
                        return {ok: false, code: body.error ?? "temporary", problems: body.problems};
                    }
                    await new Promise((res) => setTimeout(res, opts.resendGapMs ?? RESEND_GAP_MS));
                }
                // show the save at once and hold it against old CDN copies, then re-read once
                const k = key(offering);
                const prev = qc.getQueryData<DisclosureState>(k);
                const signer = address ?? "";
                const next =
                    kind === "disclosure" && body.version !== undefined && body.sha256 && body.savedAt
                        ? afterDocSave(prev, offering, {doc: doc!, issuedAt, signer}, {version: body.version, sha256: body.sha256, postCommit: body.postCommit === true, locked: body.locked === true, savedAt: body.savedAt})
                        : kind === "addendum" && body.n !== undefined && body.sha256 && body.savedAt
                          ? afterAddendumSave(prev, {text, issuedAt, signer}, {n: body.n, sha256: body.sha256, savedAt: body.savedAt})
                          : undefined;
                if (next) {
                    protectedUntil.set(offering.toLowerCase(), Date.now() + DISCLOSURE_PROTECT_MS);
                    qc.setQueryData(k, next);
                    setTimeout(() => void qc.invalidateQueries({queryKey: k}), DISCLOSURE_PROTECT_MS + 100);
                } else {
                    // nothing to show from (no cached state, or an older server answer): re-read
                    console.warn("disclosure save: no cache update, re-reading", body);
                    await qc.invalidateQueries({queryKey: k});
                }
                return {ok: true};
            } catch (e) {
                console.warn("disclosure save failed", e);
                return {ok: false, code: "temporary"};
            } finally {
                setBusy(false);
            }
        },
        [signMessageAsync, qc, address]
    );
    return {save, busy};
}

// ---- drafts (this browser only; storage may be unavailable) ----

const draftKey = (id: string) => `mapae.disclosureDraft.${id.toLowerCase()}`;

export function loadDraft(id: string): DisclosureDoc | null {
    try {
        const raw = localStorage.getItem(draftKey(id));
        return raw ? ({...EMPTY_DOC, ...(JSON.parse(raw) as Partial<DisclosureDoc>)} as DisclosureDoc) : null;
    } catch (e) {
        console.warn("draft read failed", e);
        return null;
    }
}

export function saveDraft(id: string, doc: DisclosureDoc): void {
    try {
        localStorage.setItem(draftKey(id), JSON.stringify(doc));
    } catch (e) {
        console.warn("draft write failed", e);
    }
}

export function clearDraft(id: string): void {
    try {
        localStorage.removeItem(draftKey(id));
    } catch (e) {
        console.warn("draft clear failed", e);
    }
}
