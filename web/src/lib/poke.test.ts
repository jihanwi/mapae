import {describe, expect, it} from "vitest";
import {POKE_LAG_BLOCKS, POKE_MIN_GAP_MS, shouldPoke} from "./poke";

const base = {visible: true, indexedBlock: "1000", newestLiveBlock: 1000n + POKE_LAG_BLOCKS + 1n, lastPokeMs: 0, nowMs: POKE_MIN_GAP_MS};

describe("shouldPoke", () => {
    it("asks when the visible tab sees browser trades more than 60 blocks past the indexer, once a minute", () => {
        expect(shouldPoke(base)).toBe(true);
    });
    it("not when hidden", () => {
        expect(shouldPoke({...base, visible: false})).toBe(false);
    });
    it("not at exactly 60 blocks behind, nor with no browser trades", () => {
        expect(shouldPoke({...base, newestLiveBlock: 1000n + POKE_LAG_BLOCKS})).toBe(false);
        expect(shouldPoke({...base, newestLiveBlock: 999n})).toBe(false);
        expect(shouldPoke({...base, newestLiveBlock: undefined})).toBe(false);
    });
    it("not within 60 s of the last ask", () => {
        expect(shouldPoke({...base, lastPokeMs: 1, nowMs: POKE_MIN_GAP_MS})).toBe(false);
        expect(shouldPoke({...base, lastPokeMs: 1, nowMs: POKE_MIN_GAP_MS + 1})).toBe(true);
    });
    it("summary not loaded: no basis to ask; server without a position yet: ask", () => {
        expect(shouldPoke({...base, indexedBlock: undefined})).toBe(false);
        expect(shouldPoke({...base, indexedBlock: null})).toBe(true);
    });
});
