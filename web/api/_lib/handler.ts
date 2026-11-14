// Request handlers for /api/meta. Storage and chain reads are injected (see blobStore.ts and
// chain.ts for the real ones) so every branch is testable. Errors are short codes only; no
// secrets, tokens or upstream messages are ever put in a response.
import {getAddress, recoverMessageAddress} from "viem";
import {base64ToBytes, buildMetaMessage, MetaLinks, NO_IMAGE_SHA, sha256Hex} from "./message.js";
import {
    descriptionLength,
    IMAGE_TYPES,
    isCurveAddress,
    isImageType,
    issuedAtValid,
    MAX_DESCRIPTION,
    MAX_IMAGE_BYTES,
    sanitizeDescription,
    sniffImageType,
    validLink,
} from "./validate.js";

export type Address = `0x${string}`;

export interface Store {
    /** Parsed JSON at `path`, or null when it does not exist. Throws on storage errors. */
    getJson(path: string): Promise<unknown | null>;
    exists(path: string): Promise<boolean>;
    /** Writes and returns the public URL. With overwrite false, an existing path makes it throw. */
    put(path: string, body: Uint8Array | string, contentType: string, opts: {overwrite: boolean; maxAge?: number}): Promise<{url: string}>;
    /** Pathnames under `prefix`. */
    list(prefix: string): Promise<string[]>;
}

export interface Chain {
    isCurve(curve: Address): Promise<boolean>;
    devOf(curve: Address): Promise<Address>;
}

export type Result = {status: number; body: unknown};

export const ErrorCode = {
    badRequest: "bad_request",
    imageTooLarge: "image_too_large",
    badImage: "bad_image",
    expired: "expired",
    badSignature: "bad_signature",
    notCurve: "not_curve",
    notDev: "not_dev",
    alreadySaved: "already_saved",
    temporary: "temporary",
    forbidden: "forbidden",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const err = (status: number, error: ErrorCode): Result => ({status, body: {error}});

export const PREFIX = "meta/91342/";
export const INDEX_PATH = `${PREFIX}index.json`;
export const HIDDEN_PATH = `${PREFIX}hidden.json`;
export const metaPath = (curve: string) => `${PREFIX}${curve.toLowerCase()}.json`;
export const imagePath = (curve: string, ext: string) => `img/91342/${curve.toLowerCase()}.${ext}`;

export type IndexEntry = {description: string; links: MetaLinks; imageUrl: string | null};
export type MetaIndex = Record<string, IndexEntry>;
export type MetaRecord = IndexEntry & {curve: Address; dev: Address; imageSha256: string; issuedAt: string; signature: string};

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
/** Base64 length bound so an oversized image is rejected before decoding. */
const MAX_BASE64 = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4;

export async function handlePostMeta(body: unknown, deps: {store: Store; chain: Chain; nowMs: number}): Promise<Result> {
    const {store, chain} = deps;
    if (typeof body !== "object" || body === null) return err(400, ErrorCode.badRequest);
    const b = body as Record<string, unknown>;

    // 1) format
    const curveIn = str(b.curve);
    const descIn = str(b.description) ?? "";
    const linksIn = (typeof b.links === "object" && b.links !== null ? b.links : {}) as Record<string, unknown>;
    const links: MetaLinks = {x: str(linksIn.x) ?? "", telegram: str(linksIn.telegram) ?? "", website: str(linksIn.website) ?? ""};
    const issuedAt = str(b.issuedAt);
    const signature = str(b.signature);
    if (!curveIn || !isCurveAddress(curveIn) || !issuedAt || !signature || !/^0x[0-9a-fA-F]+$/.test(signature)) return err(400, ErrorCode.badRequest);
    const description = sanitizeDescription(descIn);
    if (descriptionLength(description) > MAX_DESCRIPTION) return err(400, ErrorCode.badRequest);
    if (!validLink("x", links.x) || !validLink("telegram", links.telegram) || !validLink("website", links.website)) return err(400, ErrorCode.badRequest);
    const curve = getAddress(curveIn) as Address;

    // 2) image (optional)
    const imageB64 = str(b.imageBase64) ?? "";
    let image: {bytes: Uint8Array; type: keyof typeof IMAGE_TYPES} | undefined;
    if (imageB64 !== "") {
        if (!isImageType(b.imageType)) return err(400, ErrorCode.badImage);
        if (imageB64.length > MAX_BASE64) return err(413, ErrorCode.imageTooLarge);
        let bytes: Uint8Array;
        try {
            bytes = base64ToBytes(imageB64);
        } catch {
            return err(400, ErrorCode.badImage);
        }
        if (bytes.length > MAX_IMAGE_BYTES) return err(413, ErrorCode.imageTooLarge);
        if (sniffImageType(bytes) !== b.imageType) return err(400, ErrorCode.badImage);
        image = {bytes, type: b.imageType};
    }
    if (!image && description === "" && !links.x && !links.telegram && !links.website) return err(400, ErrorCode.badRequest);

    // 3) signature over the message rebuilt from the request fields
    if (!issuedAtValid(issuedAt, deps.nowMs)) return err(400, ErrorCode.expired);
    const imageSha256 = image ? await sha256Hex(image.bytes) : NO_IMAGE_SHA;
    const message = buildMetaMessage({curve, imageSha256, description, links, issuedAt});
    let signer: Address;
    try {
        signer = await recoverMessageAddress({message, signature: signature as `0x${string}`});
    } catch {
        return err(401, ErrorCode.badSignature);
    }

    // 4) on chain: a CurveFactory curve whose dev is the signer
    let dev: Address;
    try {
        if (!(await chain.isCurve(curve))) return err(404, ErrorCode.notCurve);
        dev = getAddress(await chain.devOf(curve)) as Address;
    } catch {
        return err(503, ErrorCode.temporary);
    }
    if (dev !== getAddress(signer)) return err(403, ErrorCode.notDev);

    // 5) never overwrite
    try {
        if (await store.exists(metaPath(curve))) return err(409, ErrorCode.alreadySaved);
    } catch {
        return err(503, ErrorCode.temporary);
    }

    // 6) save image, then the record (the record write refuses to overwrite: a concurrent save loses)
    let imageUrl: string | null = null;
    try {
        if (image) imageUrl = (await store.put(imagePath(curve, IMAGE_TYPES[image.type]), image.bytes, image.type, {overwrite: true})).url;
    } catch {
        return err(503, ErrorCode.temporary);
    }
    const record: MetaRecord = {curve, dev, description, links, imageUrl, imageSha256, issuedAt, signature};
    try {
        await store.put(metaPath(curve), JSON.stringify(record), "application/json", {overwrite: false});
    } catch {
        // Either a concurrent save won the race or storage failed; tell them apart by re-checking.
        const exists = await store.exists(metaPath(curve)).catch(() => false);
        return exists ? err(409, ErrorCode.alreadySaved) : err(503, ErrorCode.temporary);
    }

    // 7) index (best effort; the record above is already the source of truth, see reindex)
    let indexUpdated = true;
    try {
        const idx = asIndex(await store.getJson(INDEX_PATH));
        idx[curve.toLowerCase()] = {description, links, imageUrl};
        await store.put(INDEX_PATH, JSON.stringify(idx), "application/json", {overwrite: true, maxAge: 60});
    } catch {
        indexUpdated = false;
    }
    return {status: 201, body: {ok: true, curve, imageUrl, indexUpdated}};
}

function asIndex(v: unknown): MetaIndex {
    return typeof v === "object" && v !== null && !Array.isArray(v) ? {...(v as MetaIndex)} : {};
}

function asHidden(v: unknown): Set<string> {
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()) : []);
}

/** GET /api/meta: the index without hidden curves. Missing files read as empty. */
export async function handleGetMeta(deps: {store: Store}): Promise<Result> {
    try {
        const [idx, hidden] = await Promise.all([deps.store.getJson(INDEX_PATH), deps.store.getJson(HIDDEN_PATH)]);
        const out = asIndex(idx);
        for (const h of asHidden(hidden)) delete out[h];
        return {status: 200, body: out};
    } catch {
        return err(503, ErrorCode.temporary);
    }
}

/** Constant-time string comparison (length is not secret). */
function sameToken(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
}

/** POST /api/meta/reindex: rebuild index.json from every meta record. Needs ADMIN_TOKEN. */
export async function handleReindex(token: string | null, adminToken: string | undefined, deps: {store: Store}): Promise<Result> {
    if (!adminToken || !token || !sameToken(token, adminToken)) return err(403, ErrorCode.forbidden);
    try {
        const paths = (await deps.store.list(PREFIX)).filter((p) => /^meta\/91342\/0x[0-9a-f]{40}\.json$/.test(p));
        const idx: MetaIndex = {};
        for (const p of paths) {
            const r = (await deps.store.getJson(p)) as Partial<MetaRecord> | null;
            if (!r || typeof r.curve !== "string") continue;
            idx[r.curve.toLowerCase()] = {description: r.description ?? "", links: r.links ?? {x: "", telegram: "", website: ""}, imageUrl: r.imageUrl ?? null};
        }
        await deps.store.put(INDEX_PATH, JSON.stringify(idx), "application/json", {overwrite: true, maxAge: 60});
        return {status: 200, body: {ok: true, count: Object.keys(idx).length}};
    } catch {
        return err(503, ErrorCode.temporary);
    }
}
