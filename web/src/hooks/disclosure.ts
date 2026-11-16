// Offering disclosures (decision 58, W-T34): read GET /api/meta?disclosure=<offering>, save with the
// issuer's personal_sign (no gas). The document is normalized and hashed by the same module the
// server uses (api/_lib/disclosure), so the signed hash matches what the server rebuilds.
import {useCallback, useState} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useSignMessage} from "wagmi";
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

/** The offering's disclosure; an error state on failure (never read as "no disclosure"). */
export function useDisclosure(offering: string | undefined) {
    return useQuery({
        queryKey: key(offering),
        enabled: !!offering,
        retry: 1,
        queryFn: async () => {
            const r = await fetch(`${API_BASE}/api/meta?disclosure=${offering!.toLowerCase()}`);
            if (!r.ok) {
                const e = new Error(`disclosure ${r.status}`);
                console.warn("disclosure read failed", e);
                throw e;
            }
            return (await r.json()) as DisclosureState;
        },
    });
}

export type SaveResult = {ok: true} | {ok: false; code: string; problems?: {field: string; error: string; phrase?: string}[]};

/** Signs and saves a document or an additional disclosure. Refetches the disclosure on success. */
export function useSaveDisclosure() {
    const {signMessageAsync} = useSignMessage();
    const qc = useQueryClient();
    const [busy, setBusy] = useState(false);
    const save = useCallback(
        async (offering: string, kind: DisclosureKind, content: DisclosureDoc | string): Promise<SaveResult> => {
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
                const r = await fetch(`${API_BASE}/api/meta`, {
                    method: "POST",
                    headers: {"content-type": "application/json"},
                    body: JSON.stringify({kind, offering, issuedAt, signature, ...(doc ? {doc} : {text})}),
                });
                const body = (await r.json().catch(() => ({}))) as {error?: string; problems?: {field: string; error: string; phrase?: string}[]};
                if (!r.ok) {
                    console.warn("disclosure save refused", r.status, body.error);
                    return {ok: false, code: body.error ?? "temporary", problems: body.problems};
                }
                await qc.invalidateQueries({queryKey: key(offering)});
                return {ok: true};
            } catch (e) {
                console.warn("disclosure save failed", e);
                return {ok: false, code: "temporary"};
            } finally {
                setBusy(false);
            }
        },
        [signMessageAsync, qc]
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
