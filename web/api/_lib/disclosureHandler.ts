// Offering disclosures (decision 58, W-T34) behind /api/meta: GET ?disclosure=<offering> and POST
// {kind: "disclosure" | "addendum", ...}. Storage, chain and indexer reads are injected.
//
// Blob layout (per offering, lowercase address):
//   disclosure/91342/<offering>/v0001.json ...  every saved version, never overwritten or removed
//   disclosure/91342/<offering>/lock.json       written once when the first commitment is seen
//   disclosure/91342/<offering>/a0001.json ...  additional disclosures after the lock (max 20)
//   disclosure/91342/hidden.json                operator-hidden offerings (as meta/91342/hidden.json)
//
// Lock: chain totalCommitted > 0, or an indexed Committed event, or an existing lock.json. Once
// written the lock is final (cancels never reopen it). A failed chain or indexer read refuses the
// save (503); it is never read as "no commitment". An offering with no document may save its first
// one even when locked; that version is marked postCommit and is the only one.
import {recoverMessageAddress} from "viem";
import {
    addendumProblems,
    buildDisclosureMessage,
    canonicalJson,
    cleanText,
    DisclosureDoc,
    DisclosureKind,
    docProblems,
    LIMITS,
    normalizeDoc,
    sha256Text,
} from "./disclosure.js";
import type {Result, Store} from "./handler.js";
import {issuedAtValid} from "./validate.js";

export type Address = `0x${string}`;

export interface DisclosureChain {
    /** MapaeFactory(v3.2-L1).redeemManagerOf(offering) != 0 */
    isOffering(offering: Address): Promise<boolean>;
    creatorOf(offering: Address): Promise<Address>;
    totalCommitted(offering: Address): Promise<bigint>;
}

export type DisclosureDeps = {
    store: Store;
    chain: DisclosureChain;
    /** a Committed event of this offering exists in the L1 indexer */
    indexedCommit(offering: Address): Promise<boolean>;
    nowMs: number;
};

export const DISCLOSURE_PREFIX = "disclosure/91342/";
export const DISCLOSURE_HIDDEN_PATH = `${DISCLOSURE_PREFIX}hidden.json`;
const dir = (o: string) => `${DISCLOSURE_PREFIX}${o.toLowerCase()}/`;
const pad = (n: number) => String(n).padStart(4, "0");
export const versionPath = (o: string, n: number) => `${dir(o)}v${pad(n)}.json`;
export const addendumPath = (o: string, n: number) => `${dir(o)}a${pad(n)}.json`;
export const lockPath = (o: string) => `${dir(o)}lock.json`;

export type VersionRecord = {
    offering: Address;
    version: number;
    doc: DisclosureDoc;
    sha256: string;
    signer: Address;
    signature: string;
    issuedAt: string;
    savedAt: string;
    /** written after commitments had started (first save of an offering without a document) */
    postCommit: boolean;
};
export type AddendumRecord = {offering: Address; n: number; text: string; sha256: string; signer: Address; signature: string; issuedAt: string; savedAt: string};
export type LockRecord = {lockedAt: string};

const err = (status: number, error: string, extra: Record<string, unknown> = {}): Result => ({status, body: {error, ...extra}});
const isAddr = (s: unknown): s is string => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);

/** Version and addendum numbers present under the offering's folder. */
async function listState(store: Store, o: string): Promise<{versions: number[]; addenda: number[]; locked: boolean}> {
    const paths = await store.list(dir(o));
    const num = (re: RegExp) => paths.map((p) => re.exec(p)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1])).sort((a, b) => a - b);
    return {
        versions: num(/\/v(\d{4})\.json$/),
        addenda: num(/\/a(\d{4})\.json$/),
        locked: paths.some((p) => p.endsWith("/lock.json")),
    };
}

/** POST body: {kind, offering, issuedAt, signature, doc | text}. */
export async function handlePostDisclosure(body: unknown, deps: DisclosureDeps): Promise<Result> {
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const kind = b.kind as DisclosureKind;
    if ((kind !== "disclosure" && kind !== "addendum") || !isAddr(b.offering) || typeof b.issuedAt !== "string" || typeof b.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(b.signature)) {
        return err(400, "bad_request");
    }
    const offering = b.offering.toLowerCase() as Address;

    // 1) content: the canonical form is what gets hashed, signed and stored
    let doc: DisclosureDoc | null = null;
    let text = "";
    let sha256: string;
    if (kind === "disclosure") {
        doc = normalizeDoc(b.doc);
        const problems = docProblems(doc);
        if (problems.length > 0) return err(400, problems[0].error === "forbidden_phrase" ? "forbidden_phrase" : "invalid_document", {problems});
        sha256 = await sha256Text(canonicalJson(doc));
    } else {
        text = cleanText(b.text, true);
        const problems = addendumProblems(text);
        if (problems.length > 0) return err(400, problems[0].error === "forbidden_phrase" ? "forbidden_phrase" : "invalid_document", {problems});
        sha256 = await sha256Text(text);
    }

    // 2) signature over the message rebuilt from the request
    if (!issuedAtValid(b.issuedAt, deps.nowMs)) return err(400, "expired");
    let signer: Address;
    try {
        signer = (await recoverMessageAddress({message: buildDisclosureMessage({offering, kind, sha256, issuedAt: b.issuedAt}), signature: b.signature as `0x${string}`})).toLowerCase() as Address;
    } catch {
        return err(401, "bad_signature");
    }

    // 3) chain + indexer: this factory's offering, signed by its creator, commitment status. Any
    //    read failure refuses the save; it is never taken as "no commitment".
    let committed: boolean;
    try {
        if (!(await deps.chain.isOffering(offering))) return err(404, "not_offering");
        const [creator, total, indexed] = await Promise.all([deps.chain.creatorOf(offering), deps.chain.totalCommitted(offering), deps.indexedCommit(offering)]);
        if (creator.toLowerCase() !== signer) return err(403, "not_issuer");
        committed = total > 0n || indexed;
    } catch (e) {
        console.error("disclosure: chain or indexer read failed", e);
        return err(503, "temporary");
    }

    // 4) stored state; the lock is written once and then is the only thing that counts
    let state: Awaited<ReturnType<typeof listState>>;
    try {
        state = await listState(deps.store, offering);
        if (!state.locked && committed) {
            await deps.store.put(lockPath(offering), JSON.stringify({lockedAt: new Date(deps.nowMs).toISOString()} satisfies LockRecord), "application/json", {overwrite: false});
            state = {...state, locked: true};
        }
    } catch (e) {
        // a concurrent lock write loses the race but the lock exists: re-read
        try {
            state = await listState(deps.store, offering);
            if (!state.locked) throw e;
        } catch (e2) {
            console.error("disclosure: storage failed", e2);
            return err(503, "temporary");
        }
    }

    const savedAt = new Date(deps.nowMs).toISOString();
    const base = {offering, sha256, signer, signature: b.signature, issuedAt: b.issuedAt, savedAt};
    if (kind === "disclosure") {
        if (state.locked && state.versions.length > 0) return err(409, "locked");
        const version = (state.versions.at(-1) ?? 0) + 1;
        const record: VersionRecord = {...base, version, doc: doc!, postCommit: state.locked};
        try {
            await deps.store.put(versionPath(offering, version), JSON.stringify(record), "application/json", {overwrite: false});
        } catch (e) {
            const exists = await deps.store.exists(versionPath(offering, version)).catch(() => false);
            if (exists) return err(409, "conflict");
            console.error("disclosure: storage failed", e);
            return err(503, "temporary");
        }
        return {status: 201, body: {ok: true, offering, version, sha256, postCommit: record.postCommit, locked: state.locked}};
    }

    if (!state.locked) return err(409, "not_locked");
    if (state.versions.length === 0) return err(409, "no_disclosure");
    if (state.addenda.length >= LIMITS.addenda) return err(409, "addenda_full");
    const n = (state.addenda.at(-1) ?? 0) + 1;
    const record: AddendumRecord = {...base, n, text};
    try {
        await deps.store.put(addendumPath(offering, n), JSON.stringify(record), "application/json", {overwrite: false});
    } catch (e) {
        const exists = await deps.store.exists(addendumPath(offering, n)).catch(() => false);
        if (exists) return err(409, "conflict");
        console.error("disclosure: storage failed", e);
        return err(503, "temporary");
    }
    return {status: 201, body: {ok: true, offering, n, sha256}};
}

export type DisclosureOut = {
    offering: Address;
    hidden: boolean;
    disclosure: (VersionRecord & {edits: number}) | null;
    locked: boolean;
    lockedAt: string | null;
    addenda: AddendumRecord[];
};

/** GET ?disclosure=<offering>: latest version, edit count, lock and additional disclosures.
 *  Hidden offerings answer {hidden: true} with no content. */
export async function handleGetDisclosure(raw: string, deps: {store: Store}): Promise<Result> {
    if (!isAddr(raw)) return err(400, "bad_request");
    const offering = raw.toLowerCase() as Address;
    try {
        const [state, hidden] = await Promise.all([listState(deps.store, offering), deps.store.getJson(DISCLOSURE_HIDDEN_PATH)]);
        const isHidden = Array.isArray(hidden) && hidden.some((h) => typeof h === "string" && h.toLowerCase() === offering);
        if (isHidden) return {status: 200, body: {offering, hidden: true, disclosure: null, locked: state.locked, lockedAt: null, addenda: []} satisfies DisclosureOut};
        const last = state.versions.at(-1);
        const [latest, lock, ...addenda] = await Promise.all([
            last === undefined ? Promise.resolve(null) : deps.store.getJson(versionPath(offering, last)),
            state.locked ? deps.store.getJson(lockPath(offering)) : Promise.resolve(null),
            ...state.addenda.map((n) => deps.store.getJson(addendumPath(offering, n))),
        ]);
        const out: DisclosureOut = {
            offering,
            hidden: false,
            disclosure: latest ? {...(latest as VersionRecord), edits: state.versions.length - 1} : null,
            locked: state.locked,
            lockedAt: (lock as LockRecord | null)?.lockedAt ?? null,
            addenda: (addenda.filter(Boolean) as AddendumRecord[]).sort((a, b) => a.n - b.n),
        };
        return {status: 200, body: out};
    } catch (e) {
        console.error("disclosure: read failed", e);
        return err(503, "temporary");
    }
}
