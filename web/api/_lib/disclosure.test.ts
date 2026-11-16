import {describe, expect, it} from "vitest";
import {privateKeyToAccount} from "viem/accounts";
import {
    addendumProblems,
    buildDisclosureMessage,
    canonicalJson,
    DisclosureDoc,
    docProblems,
    EMPTY_DOC,
    FORBIDDEN_PHRASES,
    forbiddenPhrase,
    normalizeDoc,
    sha256Text,
} from "./disclosure.js";
import {
    addendumPath,
    DISCLOSURE_HIDDEN_PATH,
    DisclosureChain,
    handleGetDisclosure,
    handlePostDisclosure,
    lockPath,
    versionPath,
} from "./disclosureHandler.js";
import type {Store} from "./handler.js";

const issuer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const other = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const OFFERING = "0xA1AA8da4Fe05fe0bF51d3d8a464ea0269f39bB9f";
const o = OFFERING.toLowerCase();
const NOW = Date.parse("2026-11-17T03:00:00Z");

const DOC: DisclosureDoc = {
    ...EMPTY_DOC,
    summary: "노들 프로토콜의 정산 레이어 토큰",
    about: "노들 프로토콜은 결제 정산을 위한 레이어예요.\n토큰은 수수료 할인에 쓰여요.",
    utility: "수수료 할인과 거버넌스 투표",
    useOfFunds: {items: [{label: "개발", pct: 60}, {label: "운영", pct: 40}], note: "12개월 운영 기준"},
    issuer: {name: "노들랩스", jurisdiction: "대한민국"},
    priorSales: {exists: false, terms: ""},
    issuerWallets: [],
    risks: "개발이 늦어질 수 있어요.",
    links: {website: "https://nodl.example", docs: "", x: "", github: "", audit: ""},
};

function memStore(init: Record<string, unknown> = {}, fail: {list?: boolean} = {}): Store & {files: Map<string, unknown>} {
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
        async put(p, body, _t, opts) {
            if (!opts.overwrite && files.has(p)) throw new Error("exists");
            files.set(p, body);
            return {url: `https://blob.example/${p}`};
        },
        async list(prefix) {
            if (fail.list) throw new Error("blob down");
            return [...files.keys()].filter((k) => k.startsWith(prefix));
        },
    };
}
const chainOf = (c: {committed?: bigint; creator?: string; isOffering?: boolean; fail?: boolean} = {}): DisclosureChain => ({
    isOffering: async () => {
        if (c.fail) throw new Error("rpc");
        return c.isOffering ?? true;
    },
    creatorOf: async () => (c.creator ?? issuer.address) as `0x${string}`,
    totalCommitted: async () => c.committed ?? 0n,
});

async function signedDoc(doc: unknown = DOC, account = issuer, issuedAt = new Date(NOW).toISOString()) {
    const sha = await sha256Text(canonicalJson(normalizeDoc(doc)));
    const signature = await account.signMessage({message: buildDisclosureMessage({offering: OFFERING, kind: "disclosure", sha256: sha, issuedAt})});
    return {kind: "disclosure", offering: OFFERING, doc, issuedAt, signature};
}
async function signedAddendum(text: string, account = issuer) {
    const issuedAt = new Date(NOW).toISOString();
    const signature = await account.signMessage({message: buildDisclosureMessage({offering: OFFERING, kind: "addendum", sha256: await sha256Text(text), issuedAt})});
    return {kind: "addendum", offering: OFFERING, text, issuedAt, signature};
}
const deps = (store: Store, c: Parameters<typeof chainOf>[0] = {}, indexed = false, indexFail = false) => ({
    sleep: async () => {},
    store,
    chain: chainOf(c),
    indexedCommit: async () => {
        if (indexFail) throw new Error("db");
        return indexed;
    },
    nowMs: NOW,
});

describe("disclosure document", () => {
    it("a complete document has no problems; required fields are reported when empty", () => {
        expect(docProblems(normalizeDoc(DOC))).toEqual([]);
        const fields = docProblems(normalizeDoc(EMPTY_DOC)).map((p) => `${p.field}:${p.error}`);
        expect(fields).toEqual(expect.arrayContaining(["summary:required", "about:required", "utility:required", "useOfFunds.items.0.label:required", "issuer.name:required", "issuer.jurisdiction:required", "risks:required"]));
    });
    it("use of funds must add up to 100 with integer shares", () => {
        const bad = normalizeDoc({...DOC, useOfFunds: {items: [{label: "a", pct: 60}, {label: "b", pct: 30}], note: ""}});
        expect(docProblems(bad)).toEqual([{field: "useOfFunds.items", error: "pct_sum"}]);
        const frac = normalizeDoc({...DOC, useOfFunds: {items: [{label: "a", pct: 50.5}, {label: "b", pct: 49.5}], note: ""}});
        expect(docProblems(frac).map((p) => p.error)).toContain("bad_value");
    });
    it("lengths, prior sales terms when they exist, https links only", () => {
        expect(docProblems(normalizeDoc({...DOC, summary: "가".repeat(81)}))).toEqual([{field: "summary", error: "too_long"}]);
        expect(docProblems(normalizeDoc({...DOC, priorSales: {exists: true, terms: ""}}))).toEqual([{field: "priorSales.terms", error: "required"}]);
        expect(docProblems(normalizeDoc({...DOC, links: {...DOC.links, docs: "http://nodl.example"}}))).toEqual([{field: "links.docs", error: "bad_link"}]);
        expect(docProblems(normalizeDoc({...DOC, links: {...DOC.links, x: "javascript:alert(1)"}}))).toEqual([{field: "links.x", error: "bad_link"}]);
    });
    it.each(FORBIDDEN_PHRASES)("forbidden phrase %s is named", (p) => {
        expect(docProblems(normalizeDoc({...DOC, risks: `이 토큰은 ${p.toUpperCase()} 상품이에요`}))).toEqual([{field: "doc", error: "forbidden_phrase", phrase: p}]);
        expect(addendumProblems(`추가: ${p}`)).toEqual([{field: "text", error: "forbidden_phrase", phrase: p}]);
    });
    it("phrase check ignores spacing differences and case", () => {
        expect(forbiddenPhrase("원금  보장")).toBe("원금 보장");
        expect(forbiddenPhrase("Risk-Free")).toBe("risk-free");
        expect(forbiddenPhrase("원금 손실 가능")).toBeNull();
    });
    it("normalization is stable: field order and whitespace do not change the hash", async () => {
        const shuffled = {risks: DOC.risks + "  ", links: DOC.links, issuer: DOC.issuer, summary: ` ${DOC.summary}`, about: DOC.about.replace("\n", "\r\n"), utility: DOC.utility, useOfFunds: DOC.useOfFunds, priorSales: DOC.priorSales, issuerWallets: []};
        expect(await sha256Text(canonicalJson(normalizeDoc(shuffled)))).toBe(await sha256Text(canonicalJson(normalizeDoc(DOC))));
    });
    it("the signed message is readable and carries offering, hash and time", () => {
        const m = buildDisclosureMessage({offering: o, kind: "disclosure", sha256: "0xabc", issuedAt: "2026-11-17T03:00:00.000Z"});
        expect(m.split("\n")).toEqual(["MAPAE offering disclosure", "chainId: 91342", `offering: ${OFFERING}`, "kind: disclosure document", "sha256: 0xabc", "issuedAt: 2026-11-17T03:00:00.000Z"]);
    });
});

describe("POST disclosure", () => {
    it("before any commitment: saves version 1, then version 2 (both kept)", async () => {
        const store = memStore();
        const r1 = await handlePostDisclosure(await signedDoc(), deps(store));
        expect(r1).toMatchObject({status: 201, body: {version: 1, postCommit: false, locked: false, savedAt: new Date(NOW).toISOString()}});
        const r2 = await handlePostDisclosure(await signedDoc({...DOC, summary: "고친 요약"}), deps(store));
        expect(r2).toMatchObject({status: 201, body: {version: 2}});
        expect(store.files.has(versionPath(o, 1))).toBe(true);
        expect(store.files.has(versionPath(o, 2))).toBe(true);
        expect(store.files.has(lockPath(o))).toBe(false);
    });
    it("another wallet's signature is refused", async () => {
        const r = await handlePostDisclosure(await signedDoc(DOC, other), deps(memStore()));
        expect(r).toEqual({status: 403, body: {error: "not_issuer"}});
    });
    it("a signature over different content does not verify as the issuer", async () => {
        const body = await signedDoc();
        const r = await handlePostDisclosure({...body, doc: {...DOC, summary: "바뀐 내용"}}, deps(memStore()));
        expect(r).toEqual({status: 403, body: {error: "not_issuer"}});
    });
    it("W-T36: an offering the RPC does not see yet is read again (4 tries, 1.5 s apart) before not_offering", async () => {
        const slept: number[] = [];
        let calls = 0;
        const late: DisclosureChain = {...chainOf(), isOffering: async () => ++calls >= 3};
        const r = await handlePostDisclosure(await signedDoc(), {...deps(memStore()), chain: late, sleep: async (ms: number) => void slept.push(ms)});
        expect(r.status).toBe(201);
        expect(calls).toBe(3);
        expect(slept).toEqual([1500, 1500]);
        const never: DisclosureChain = {...chainOf(), isOffering: async () => (calls++, false)};
        calls = 0;
        slept.length = 0;
        expect(await handlePostDisclosure(await signedDoc(), {...deps(memStore()), chain: never, sleep: async (ms: number) => void slept.push(ms)})).toEqual({status: 404, body: {error: "not_offering"}});
        expect(calls).toBe(4);
        expect(slept).toEqual([1500, 1500, 1500]);
    });
    it("an offering of another factory is refused", async () => {
        expect(await handlePostDisclosure(await signedDoc(), deps(memStore(), {isOffering: false}))).toEqual({status: 404, body: {error: "not_offering"}});
    });
    it("after the first commitment the document is locked: an edit is refused and the lock stays after cancels", async () => {
        const store = memStore();
        await handlePostDisclosure(await signedDoc(), deps(store));
        expect(await handlePostDisclosure(await signedDoc({...DOC, summary: "고침"}), deps(store, {committed: 300_000n}))).toEqual({status: 409, body: {error: "locked"}});
        expect(store.files.has(lockPath(o))).toBe(true);
        // every commitment cancelled (chain 0, indexer still has it or not): still locked by lock.json
        expect(await handlePostDisclosure(await signedDoc({...DOC, summary: "고침"}), deps(store, {committed: 0n}, false))).toEqual({status: 409, body: {error: "locked"}});
    });
    it("the indexer's commit record alone locks", async () => {
        const store = memStore();
        await handlePostDisclosure(await signedDoc(), deps(store));
        expect(await handlePostDisclosure(await signedDoc({...DOC, summary: "고침"}), deps(store, {committed: 0n}, true))).toEqual({status: 409, body: {error: "locked"}});
    });
    it("a chain or indexer read failure refuses the save (never read as no commitment)", async () => {
        expect(await handlePostDisclosure(await signedDoc(), deps(memStore(), {fail: true}))).toEqual({status: 503, body: {error: "temporary"}});
        expect(await handlePostDisclosure(await signedDoc(), deps(memStore(), {}, false, true))).toEqual({status: 503, body: {error: "temporary"}});
        expect(await handlePostDisclosure(await signedDoc(), deps(memStore({}, {list: true})))).toEqual({status: 503, body: {error: "temporary"}});
    });
    it("no document yet and commitments exist: the first save is allowed once, marked postCommit, then locked", async () => {
        const store = memStore();
        const r = await handlePostDisclosure(await signedDoc(), deps(store, {committed: 300_000n}));
        expect(r).toMatchObject({status: 201, body: {version: 1, postCommit: true, locked: true}});
        expect(await handlePostDisclosure(await signedDoc({...DOC, summary: "고침"}), deps(store, {committed: 300_000n}))).toEqual({status: 409, body: {error: "locked"}});
    });
    it("additional disclosures: only after the lock, appended, never replaced, at most 20", async () => {
        const store = memStore();
        await handlePostDisclosure(await signedDoc(), deps(store));
        expect(await handlePostDisclosure(await signedAddendum("일정 변경 안내"), deps(store))).toEqual({status: 409, body: {error: "not_locked"}});
        const a1 = await handlePostDisclosure(await signedAddendum("일정 변경 안내"), deps(store, {committed: 1n}));
        expect(a1).toMatchObject({status: 201, body: {n: 1, savedAt: new Date(NOW).toISOString()}});
        const a2 = await handlePostDisclosure(await signedAddendum("두 번째 안내"), deps(store, {committed: 1n}));
        expect(a2).toMatchObject({status: 201, body: {n: 2}});
        expect(JSON.parse(store.files.get(addendumPath(o, 1)) as string).text).toBe("일정 변경 안내");
        for (let i = 3; i <= 20; i++) await handlePostDisclosure(await signedAddendum(`안내 ${i}`), deps(store, {committed: 1n}));
        expect(await handlePostDisclosure(await signedAddendum("21번째"), deps(store, {committed: 1n}))).toEqual({status: 409, body: {error: "addenda_full"}});
        expect(await handlePostDisclosure(await signedAddendum("다른 지갑", other), deps(store, {committed: 1n}))).toEqual({status: 403, body: {error: "not_issuer"}});
    });
    it("forbidden phrases and missing fields are refused by the server with the reason", async () => {
        const r = await handlePostDisclosure(await signedDoc({...DOC, about: "원금 보장 상품이에요"}), deps(memStore()));
        expect(r).toEqual({status: 400, body: {error: "forbidden_phrase", problems: [{field: "doc", error: "forbidden_phrase", phrase: "원금 보장"}]}});
        const r2 = await handlePostDisclosure(await signedDoc({...DOC, risks: ""}), deps(memStore()));
        expect(r2).toMatchObject({status: 400, body: {error: "invalid_document", problems: [{field: "risks", error: "required"}]}});
        const r3 = await handlePostDisclosure(await signedAddendum("수익 보장"), deps(memStore(), {committed: 1n}));
        expect(r3).toMatchObject({status: 400, body: {error: "forbidden_phrase"}});
    });
    it("an expired signature time is refused", async () => {
        const r = await handlePostDisclosure(await signedDoc(DOC, issuer, new Date(NOW - 60 * 60 * 1000).toISOString()), deps(memStore()));
        expect(r).toEqual({status: 400, body: {error: "expired"}});
    });
});

describe("GET disclosure", () => {
    it("latest version, edit count, lock time and additional disclosures in order", async () => {
        const store = memStore();
        await handlePostDisclosure(await signedDoc(), deps(store));
        await handlePostDisclosure(await signedDoc({...DOC, summary: "두 번째 판"}), deps(store));
        await handlePostDisclosure(await signedAddendum("안내"), deps(store, {committed: 1n}));
        const r = await handleGetDisclosure(OFFERING, {store});
        expect(r.status).toBe(200);
        const b = r.body as {disclosure: {version: number; edits: number; doc: DisclosureDoc; sha256: string}; locked: boolean; lockedAt: string; addenda: {n: number; text: string}[]};
        expect(b.disclosure.version).toBe(2);
        expect(b.disclosure.edits).toBe(1);
        expect(b.disclosure.doc.summary).toBe("두 번째 판");
        expect(b.disclosure.sha256).toMatch(/^0x[0-9a-f]{64}$/);
        expect(b.locked).toBe(true);
        expect(b.lockedAt).toBe(new Date(NOW).toISOString());
        expect(b.addenda.map((a) => [a.n, a.text])).toEqual([[1, "안내"]]);
    });
    it("no document: disclosure null; operator-hidden: no content", async () => {
        expect((await handleGetDisclosure(OFFERING, {store: memStore()})).body).toMatchObject({disclosure: null, locked: false, addenda: []});
        const store = memStore({[DISCLOSURE_HIDDEN_PATH]: [OFFERING]});
        await handlePostDisclosure(await signedDoc(), deps(store));
        expect((await handleGetDisclosure(OFFERING, {store})).body).toMatchObject({hidden: true, disclosure: null});
        expect((await handleGetDisclosure("nope", {store})).status).toBe(400);
    });
});
