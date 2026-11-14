// Curve metadata (image, description, links) from /api/meta. One request for the whole index
// (cached 60 s), never one per curve. A failed read just means "no metadata": no toast, no fallback.
import {useCallback, useState} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useSignMessage} from "wagmi";
import {buildMetaMessage, bytesToBase64, MetaLinks, NO_IMAGE_SHA, sha256Hex} from "../../api/_lib/message";
import {sanitizeDescription} from "../../api/_lib/validate";
import {classifyConnectError} from "../lib/connectError";
import type {Address} from "./curves";

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

export type CurveMeta = {description: string; links: MetaLinks; imageUrl: string | null};
export type MetaIndex = Record<string, CurveMeta>;

const KEY = ["curve-meta"];

/** Index with `entry` added for `curve` (lowercased). An existing entry is never replaced: metadata
 *  is write-once, so whatever the server already has wins. Returns a new object. */
export function addMetaEntry(index: MetaIndex, curve: string, entry: CurveMeta): MetaIndex {
    const k = curve.toLowerCase();
    return k in index ? index : {...index, [k]: entry};
}

// Entries this browser saved in this session. GET /api/meta is edge-cached (s-maxage + SWR), so a
// refetch right after a save can still return the old index; merging these keeps a just-saved
// image and description on screen until the server index catches up.
const savedHere = new Map<string, CurveMeta>();
const withSavedHere = (index: MetaIndex) => [...savedHere].reduce((acc, [k, e]) => addMetaEntry(acc, k, e), index);

export function useCurveMeta() {
    const q = useQuery({
        queryKey: KEY,
        queryFn: async (): Promise<MetaIndex> => {
            const r = await fetch(`${API_BASE}/api/meta`);
            if (!r.ok) throw new Error(`meta ${r.status}`);
            return withSavedHere((await r.json()) as MetaIndex);
        },
        staleTime: 60_000,
        retry: 1,
    });
    const index = q.data ?? {};
    return {index, loaded: q.isSuccess, get: (curve: string): CurveMeta | undefined => index[curve.toLowerCase()]};
}

export type MetaDraft = {image?: {bytes: Uint8Array; type: string; previewUrl: string}; description: string; links: MetaLinks};
export const emptyDraft = (): MetaDraft => ({description: "", links: {x: "", telegram: "", website: ""}});
export const draftHasContent = (d: MetaDraft) => !!d.image || sanitizeDescription(d.description) !== "" || !!d.links.x || !!d.links.telegram || !!d.links.website;

/** Server error code, "rejected" (wallet signature cancelled), or ok. */
export type SaveState = {phase: "idle"} | {phase: "signing"} | {phase: "uploading"} | {phase: "saved"} | {phase: "failed"; code: string};

/** The exact message to sign and the request body (without the signature) for a draft. Pure, so
 *  the client/server agreement is testable: the server rebuilds the same message from this body. */
export async function prepareMetaRequest(curve: Address, d: MetaDraft, issuedAt: string) {
    const description = sanitizeDescription(d.description);
    const links = {x: d.links.x.trim(), telegram: d.links.telegram.trim(), website: d.links.website.trim()};
    const imageSha256 = d.image ? await sha256Hex(d.image.bytes) : NO_IMAGE_SHA;
    return {
        message: buildMetaMessage({curve, imageSha256, description, links, issuedAt}),
        body: {curve, description, links, imageBase64: d.image ? bytesToBase64(d.image.bytes) : "", imageType: d.image?.type ?? "", issuedAt},
    };
}

/** Sign the fixed message with the Dev wallet (personal_sign, no gas) and POST it. */
export function useSaveMeta() {
    const {signMessageAsync} = useSignMessage();
    const qc = useQueryClient();
    const [state, setState] = useState<SaveState>({phase: "idle"});
    const save = useCallback(
        async (curve: Address, d: MetaDraft) => {
            const req = await prepareMetaRequest(curve, d, new Date().toISOString());
            setState({phase: "signing"});
            let signature: `0x${string}`;
            try {
                signature = await signMessageAsync({message: req.message});
            } catch (e) {
                setState({phase: "failed", code: classifyConnectError(e) === "rejected" ? "rejected" : "bad_signature"});
                return false;
            }
            setState({phase: "uploading"});
            try {
                const r = await fetch(`${API_BASE}/api/meta`, {
                    method: "POST",
                    headers: {"content-type": "application/json"},
                    body: JSON.stringify({...req.body, signature}),
                });
                const body = (await r.json().catch(() => ({}))) as {error?: string; imageUrl?: string | null};
                if (!r.ok) {
                    setState({phase: "failed", code: body.error ?? "temporary"});
                    return false;
                }
                // Show it now: put the saved entry into the cached index instead of refetching
                // (a refetch would likely hit the edge-cached index without it).
                const entry: CurveMeta = {description: req.body.description, links: req.body.links, imageUrl: body.imageUrl ?? null};
                savedHere.set(curve.toLowerCase(), entry);
                qc.setQueryData<MetaIndex>(KEY, (old) => addMetaEntry(old ?? {}, curve, entry));
            } catch {
                setState({phase: "failed", code: "temporary"});
                return false;
            }
            setState({phase: "saved"});
            return true;
        },
        [signMessageAsync, qc]
    );
    return {state, save};
}
