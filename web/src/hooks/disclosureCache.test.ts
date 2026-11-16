import {describe, expect, it} from "vitest";
import {afterAddendumSave, afterDocSave, DISCLOSURE_PROTECT_MS, disclosureProtected, DisclosureState, olderThanCache, onFetched, resendable, STALE_RETRY_MAX} from "./disclosure";
import {EMPTY_DOC} from "../../api/_lib/disclosure";

const O = "0xA1AA8da4Fe05fe0bF51d3d8a464ea0269f39bB9f";
const ME = "0xC0FFEE00000000000000000000000000000000AA";
const doc = {...EMPTY_DOC, summary: "노들 프로토콜"};
const NONE: DisclosureState = {offering: O.toLowerCase(), hidden: false, disclosure: null, locked: true, lockedAt: "2026-11-16T11:00:00.000Z", addenda: []};

describe("disclosure cache right after a save (W-T35)", () => {
    it("a first save on a locked offering without a document: the body shows, marked postCommit", () => {
        const s = afterDocSave(NONE, O, {doc, issuedAt: "2026-11-17T01:00:00.000Z", signer: ME}, {version: 1, sha256: "0xabc", postCommit: true, locked: true, savedAt: "2026-11-17T01:00:01.000Z"});
        expect(s.disclosure).toMatchObject({version: 1, edits: 0, sha256: "0xabc", postCommit: true, savedAt: "2026-11-17T01:00:01.000Z", signer: ME.toLowerCase()});
        expect(s.disclosure!.doc.summary).toBe("노들 프로토콜");
        expect(s.locked).toBe(true);
        expect(s.lockedAt).toBe(NONE.lockedAt);
    });
    it("a new offering with no cached state yet (saved from the create page): built from the answer alone", () => {
        const s = afterDocSave(undefined, O, {doc, issuedAt: "t", signer: ME}, {version: 1, sha256: "0x1", postCommit: false, locked: false, savedAt: "t2"});
        expect(s).toMatchObject({offering: O.toLowerCase(), hidden: false, locked: false, lockedAt: null, addenda: []});
        expect(s.disclosure?.version).toBe(1);
    });
    it("an edit before the lock: version and edit count from the answer", () => {
        const first = afterDocSave(undefined, O, {doc, issuedAt: "t", signer: ME}, {version: 1, sha256: "0x1", postCommit: false, locked: false, savedAt: "a"});
        const second = afterDocSave(first, O, {doc: {...doc, summary: "고침"}, issuedAt: "t", signer: ME}, {version: 2, sha256: "0x2", postCommit: false, locked: false, savedAt: "b"});
        expect(second.disclosure).toMatchObject({version: 2, edits: 1, sha256: "0x2", savedAt: "b"});
        expect(second.locked).toBe(false);
    });
    it("an additional disclosure is appended once, in number order; nothing to append to -> re-read", () => {
        const base = afterDocSave(NONE, O, {doc, issuedAt: "t", signer: ME}, {version: 1, sha256: "0x1", postCommit: true, locked: true, savedAt: "a"});
        const a1 = afterAddendumSave(base, {text: "일정 안내", issuedAt: "t", signer: ME}, {n: 1, sha256: "0xa1", savedAt: "s1"})!;
        const again = afterAddendumSave(a1, {text: "일정 안내", issuedAt: "t", signer: ME}, {n: 1, sha256: "0xa1", savedAt: "s1"})!;
        expect(again.addenda.map((a) => [a.n, a.text, a.savedAt])).toEqual([[1, "일정 안내", "s1"]]);
        const a2 = afterAddendumSave(again, {text: "두 번째", issuedAt: "t", signer: ME}, {n: 2, sha256: "0xa2", savedAt: "s2"})!;
        expect(a2.addenda.map((a) => a.n)).toEqual([1, 2]);
        expect(afterAddendumSave(undefined, {text: "x", issuedAt: "t", signer: ME}, {n: 1, sha256: "0x", savedAt: "s"})).toBeUndefined();
    });
    it("protection lasts 20 s per offering (case-insensitive), then a re-read is allowed", () => {
        const until = new Map([[O.toLowerCase(), 1_000 + DISCLOSURE_PROTECT_MS]]);
        expect(disclosureProtected(until, O, 1_000)).toBe(true);
        expect(disclosureProtected(until, O.toUpperCase().replace("0X", "0x"), 1_000 + DISCLOSURE_PROTECT_MS - 1)).toBe(true);
        expect(disclosureProtected(until, O, 1_000 + DISCLOSURE_PROTECT_MS)).toBe(false);
        expect(disclosureProtected(until, "0x0000000000000000000000000000000000000001", 1_000)).toBe(false);
    });
});

describe("older CDN copies are dropped (W-T36)", () => {
    const v = (version: number, addenda = 0, hidden = false): DisclosureState => ({
        ...NONE,
        hidden,
        disclosure: {version, doc, sha256: "0x", signer: ME, issuedAt: "t", savedAt: "s", postCommit: false, edits: version - 1},
        addenda: Array.from({length: addenda}, (_, i) => ({n: i + 1, text: "x", sha256: "0x", signer: ME, issuedAt: "t", savedAt: "s"})),
    });
    it("lower version, same version with fewer addenda, or no document where the cache has one", () => {
        expect(olderThanCache(v(2), v(1))).toBe(true);
        expect(olderThanCache(v(1, 2), v(1, 1))).toBe(true);
        expect(olderThanCache(v(1), NONE)).toBe(true);
    });
    it("same or newer answers are taken; no cache takes anything; hidden is always taken", () => {
        expect(olderThanCache(v(1, 1), v(1, 1))).toBe(false);
        expect(olderThanCache(v(1), v(2))).toBe(false);
        expect(olderThanCache(v(1, 1), v(2, 0))).toBe(false);
        expect(olderThanCache(undefined, NONE)).toBe(false);
        expect(olderThanCache(NONE, v(1))).toBe(false);
        expect(olderThanCache(v(3), {...NONE, hidden: true})).toBe(false);
    });
    it("a dropped answer is retried, at most 3 times", () => {
        expect(onFetched(v(2), v(1), 0)).toEqual({use: "cache", retry: true});
        expect(onFetched(v(2), v(1), STALE_RETRY_MAX - 1)).toEqual({use: "cache", retry: true});
        expect(onFetched(v(2), v(1), STALE_RETRY_MAX)).toEqual({use: "cache", retry: false});
        expect(onFetched(v(1), v(2), 3)).toEqual({use: "fresh", retry: false});
    });
});

describe("resending the same signed save (W-T36)", () => {
    it("not_offering, gateway / temporary errors and network errors are resent; refusals are not", () => {
        expect(resendable(404, "not_offering")).toBe(true);
        expect(resendable(503, "temporary")).toBe(true);
        expect(resendable(null, undefined)).toBe(true);
        expect(resendable(403, "not_issuer")).toBe(false);
        expect(resendable(409, "locked")).toBe(false);
        expect(resendable(400, "forbidden_phrase")).toBe(false);
        expect(resendable(404, "not_found")).toBe(false);
    });
});
