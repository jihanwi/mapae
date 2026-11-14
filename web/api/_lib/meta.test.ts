import {describe, expect, it} from "vitest";
import {privateKeyToAccount} from "viem/accounts";
import {buildMetaMessage, bytesToBase64, MetaLinks, NO_IMAGE_SHA, sha256Hex} from "./message.js";
import {descriptionLength, issuedAtValid, MAX_IMAGE_BYTES, sanitizeDescription, sniffImageType, validLink} from "./validate.js";
import {Address, Chain, handleGetMeta, handlePostMeta, handleReindex, HIDDEN_PATH, imagePath, INDEX_PATH, metaPath, Store} from "./handler.js";
import {cors} from "./http.js";

// Test-only keys (well-known Anvil accounts), never used on a real chain.
const devAcct = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const otherAcct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const CURVE = "0x1111111111111111111111111111111111111111" as Address;
const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const ISSUED = "2026-11-14T11:58:00.000Z";
const NO_LINKS: MetaLinks = {x: "", telegram: "", website: ""};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const GIF = new TextEncoder().encode("GIF89a....");

function memStore(init: Record<string, unknown> = {}, fail: {putIndex?: boolean} = {}): Store & {files: Map<string, unknown>} {
    const files = new Map<string, unknown>(Object.entries(init));
    return {
        files,
        async getJson(p) {
            const v = files.get(p);
            return v === undefined ? null : typeof v === "string" ? JSON.parse(v) : v;
        },
        async exists(p) {
            return files.has(p);
        },
        async put(p, body, _type, opts) {
            if (fail.putIndex && p === INDEX_PATH) throw new Error("index write failed");
            if (!opts.overwrite && files.has(p)) throw new Error("exists");
            files.set(p, body);
            return {url: `https://blob.example/${p}`};
        },
        async list(prefix) {
            return [...files.keys()].filter((k) => k.startsWith(prefix));
        },
    };
}
const chainOf = (o: {isCurve?: boolean; dev?: Address} = {}): Chain => ({
    isCurve: async () => o.isCurve ?? true,
    devOf: async () => o.dev ?? devAcct.address,
});

async function signedBody(o: {account?: typeof devAcct; image?: Uint8Array; imageType?: string; description?: string; links?: MetaLinks; issuedAt?: string} = {}) {
    const account = o.account ?? devAcct;
    const description = o.description ?? "First curve on MAPAE";
    const links = o.links ?? {x: "https://x.com/mapae", telegram: "", website: "https://mapae.example"};
    const issuedAt = o.issuedAt ?? ISSUED;
    const imageSha256 = o.image ? await sha256Hex(o.image) : NO_IMAGE_SHA;
    const signature = await account.signMessage({message: buildMetaMessage({curve: CURVE, imageSha256, description, links, issuedAt})});
    return {
        curve: CURVE,
        description,
        links,
        imageBase64: o.image ? bytesToBase64(o.image) : "",
        imageType: o.image ? (o.imageType ?? "image/png") : "",
        issuedAt,
        signature,
    };
}

describe("signed message", () => {
    it("has the fixed layout with a checksum curve address", () => {
        const m = buildMetaMessage({curve: CURVE.toLowerCase(), imageSha256: NO_IMAGE_SHA, description: "hi", links: NO_LINKS, issuedAt: ISSUED});
        expect(m).toBe(
            ["MAPAE curve metadata", "chainId: 91342", "curve: 0x1111111111111111111111111111111111111111", "imageSha256: 0x0", "description: hi", "x: ", "telegram: ", "website: ", `issuedAt: ${ISSUED}`].join("\n")
        );
    });
    it("client and server build the same string (server rebuilds from the request fields)", async () => {
        const body = await signedBody({image: PNG});
        const res = await handlePostMeta(body, {store: memStore(), chain: chainOf(), nowMs: NOW});
        expect(res.status).toBe(201);
    });
    it("sha256 is 0x + 64 hex", async () => {
        expect(await sha256Hex(new Uint8Array([]))).toBe("0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });
});

describe("validation", () => {
    it("sniffs png, jpeg, webp and rejects svg and gif", () => {
        expect(sniffImageType(PNG)).toBe("image/png");
        expect(sniffImageType(JPEG)).toBe("image/jpeg");
        expect(sniffImageType(WEBP)).toBe("image/webp");
        expect(sniffImageType(SVG)).toBeUndefined();
        expect(sniffImageType(GIF)).toBeUndefined();
    });
    it("links: https only, host rules for x and telegram, length limit", () => {
        expect(validLink("x", "")).toBe(true);
        expect(validLink("x", "https://x.com/mapae")).toBe(true);
        expect(validLink("x", "https://twitter.com/mapae")).toBe(true);
        expect(validLink("x", "https://x.com.evil.io/a")).toBe(false);
        expect(validLink("x", "http://x.com/mapae")).toBe(false);
        expect(validLink("telegram", "https://t.me/mapae")).toBe(true);
        expect(validLink("telegram", "https://telegram.org/mapae")).toBe(false);
        expect(validLink("website", "https://mapae.example/a?b=c")).toBe(true);
        expect(validLink("website", "javascript:alert(1)")).toBe(false);
        expect(validLink("website", "https://user:pw@mapae.example")).toBe(false);
        expect(validLink("website", "https://a.io/" + "a".repeat(200))).toBe(false);
    });
    it("description: control characters removed, 160 characters max", () => {
        expect(sanitizeDescription(" a\nb\u0000c\u0085 ")).toBe("abc");
        expect(descriptionLength("가".repeat(160))).toBe(160);
    });
    it("issuedAt must be within 10 minutes", () => {
        expect(issuedAtValid(ISSUED, NOW)).toBe(true);
        expect(issuedAtValid("2026-11-14T11:49:59.000Z", NOW)).toBe(false);
        expect(issuedAtValid("2026-11-14T12:10:01.000Z", NOW)).toBe(false);
        expect(issuedAtValid("yesterday", NOW)).toBe(false);
    });
});

describe("POST /api/meta handler", () => {
    it("saves image, record and index", async () => {
        const store = memStore();
        const res = await handlePostMeta(await signedBody({image: PNG}), {store, chain: chainOf(), nowMs: NOW});
        expect(res).toEqual({status: 201, body: {ok: true, curve: CURVE, imageUrl: `https://blob.example/${imagePath(CURVE, "png")}`, indexUpdated: true}});
        const rec = JSON.parse(store.files.get(metaPath(CURVE)) as string);
        expect(rec.dev).toBe(devAcct.address);
        const idx = JSON.parse(store.files.get(INDEX_PATH) as string);
        expect(idx[CURVE.toLowerCase()].description).toBe("First curve on MAPAE");
    });
    it("rejects a signer who is not the dev", async () => {
        const res = await handlePostMeta(await signedBody({account: otherAcct}), {store: memStore(), chain: chainOf(), nowMs: NOW});
        expect(res).toEqual({status: 403, body: {error: "not_dev"}});
    });
    it("rejects an address that is not a CurveFactory curve", async () => {
        const sleeps: number[] = [];
        let calls = 0;
        const chain: Chain = {isCurve: async () => (calls++, false), devOf: async () => devAcct.address};
        const res = await handlePostMeta(await signedBody(), {store: memStore(), chain, nowMs: NOW, sleep: async (ms) => void sleeps.push(ms)});
        expect(res).toEqual({status: 404, body: {error: "not_curve"}});
        expect(calls).toBe(4); // 1 read + 3 retries
        expect(sleeps).toEqual([1500, 1500, 1500]);
    });
    it("retries isCurve while the RPC has not seen the launch block yet", async () => {
        const seq = [false, false, true];
        let calls = 0;
        const chain: Chain = {isCurve: async () => seq[calls++] ?? true, devOf: async () => devAcct.address};
        const res = await handlePostMeta(await signedBody(), {store: memStore(), chain, nowMs: NOW, sleep: async () => {}});
        expect(res.status).toBe(201);
        expect(calls).toBe(3);
    });
    it("never reads the chain for a malformed signature or bad input", async () => {
        let calls = 0;
        const chain: Chain = {isCurve: async () => (calls++, true), devOf: async () => devAcct.address};
        const deps = {store: memStore(), chain, nowMs: NOW, sleep: async () => {}};
        expect((await handlePostMeta({...(await signedBody()), signature: "0x1234"}, deps)).body).toEqual({error: "bad_signature"});
        expect((await handlePostMeta(await signedBody({issuedAt: "2026-11-14T11:00:00.000Z"}), deps)).body).toEqual({error: "expired"});
        expect((await handlePostMeta({...(await signedBody()), curve: "0x12"}, deps)).body).toEqual({error: "bad_request"});
        expect(calls).toBe(0);
    });
    it("returns 409 and keeps the existing record", async () => {
        const store = memStore({[metaPath(CURVE)]: '{"keep":true}'});
        const res = await handlePostMeta(await signedBody(), {store, chain: chainOf(), nowMs: NOW});
        expect(res).toEqual({status: 409, body: {error: "already_saved"}});
        expect(store.files.get(metaPath(CURVE))).toBe('{"keep":true}');
    });
    it("still succeeds with indexUpdated false when the index write fails", async () => {
        const store = memStore({}, {putIndex: true});
        const res = await handlePostMeta(await signedBody(), {store, chain: chainOf(), nowMs: NOW});
        expect(res.status).toBe(201);
        expect((res.body as {indexUpdated: boolean}).indexUpdated).toBe(false);
        expect(store.files.has(metaPath(CURVE))).toBe(true);
    });
    it("rejects a tampered field (signature no longer matches the dev)", async () => {
        const body = {...(await signedBody()), description: "changed"};
        const res = await handlePostMeta(body, {store: memStore(), chain: chainOf(), nowMs: NOW});
        expect(res).toEqual({status: 403, body: {error: "not_dev"}});
    });
    it("rejects a malformed signature, an expired issuedAt and a disguised svg", async () => {
        const deps = {store: memStore(), chain: chainOf(), nowMs: NOW};
        expect((await handlePostMeta({...(await signedBody()), signature: "0x1234"}, deps)).body).toEqual({error: "bad_signature"});
        expect((await handlePostMeta(await signedBody({issuedAt: "2026-11-14T11:00:00.000Z"}), deps)).body).toEqual({error: "expired"});
        expect((await handlePostMeta(await signedBody({image: SVG, imageType: "image/png"}), deps)).body).toEqual({error: "bad_image"});
        expect((await handlePostMeta(await signedBody({image: GIF, imageType: "image/gif"}), deps)).body).toEqual({error: "bad_image"});
    });
    it("rejects an oversized image and bad links", async () => {
        const deps = {store: memStore(), chain: chainOf(), nowMs: NOW};
        const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
        big.set(PNG);
        expect((await handlePostMeta(await signedBody({image: big}), deps)).status).toBe(413);
        expect((await handlePostMeta(await signedBody({links: {x: "https://evil.io/x", telegram: "", website: ""}}), deps)).body).toEqual({error: "bad_request"});
        expect((await handlePostMeta(await signedBody({description: "a".repeat(161)}), deps)).body).toEqual({error: "bad_request"});
    });
    it("maps chain errors to temporary", async () => {
        const chain: Chain = {isCurve: async () => Promise.reject(new Error("rpc")), devOf: async () => devAcct.address};
        expect((await handlePostMeta(await signedBody(), {store: memStore(), chain, nowMs: NOW})).body).toEqual({error: "temporary"});
    });
});

describe("GET /api/meta and reindex", () => {
    const entry = {description: "d", links: NO_LINKS, imageUrl: null};
    it("returns {} for an empty store", async () => {
        expect(await handleGetMeta({store: memStore()})).toEqual({status: 200, body: {}});
    });
    it("removes hidden curves", async () => {
        const a = "0x" + "a".repeat(40);
        const b = "0x" + "b".repeat(40);
        const store = memStore({[INDEX_PATH]: {[a]: entry, [b]: entry}, [HIDDEN_PATH]: ["0x" + "A".repeat(40)]});
        expect((await handleGetMeta({store})).body).toEqual({[b]: entry});
    });
    it("reindex needs ADMIN_TOKEN and rebuilds from records", async () => {
        const a = "0x" + "a".repeat(40);
        const store = memStore({[metaPath(a)]: {curve: a, ...entry}, [HIDDEN_PATH]: []});
        expect((await handleReindex("t", undefined, {store})).status).toBe(403);
        expect((await handleReindex("wrong", "t", {store})).status).toBe(403);
        expect(await handleReindex("t", "t", {store})).toEqual({status: 200, body: {ok: true, count: 1}});
        expect(JSON.parse(store.files.get(INDEX_PATH) as string)).toEqual({[a]: entry});
    });
});

describe("CORS", () => {
    const req = (origin?: string) => new Request("https://mapae-snowy.vercel.app/api/meta", {headers: origin ? {origin, host: "mapae-snowy.vercel.app"} : {host: "mapae-snowy.vercel.app"}});
    it("allows same origin, no origin and GitHub Pages only", () => {
        expect(cors(req()).allowed).toBe(true);
        expect(cors(req("https://mapae-snowy.vercel.app")).allowed).toBe(true);
        expect(cors(req("https://jihanwi.github.io")).headers["Access-Control-Allow-Origin"]).toBe("https://jihanwi.github.io");
        expect(cors(req("https://evil.example")).allowed).toBe(false);
    });
});
