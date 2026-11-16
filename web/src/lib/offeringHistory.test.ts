import {describe, expect, it} from "vitest";
import {liveStart, mergeHistory, participantCount} from "./offeringHistory";

const k = (tx: string, logIndex: number, block: bigint) => ({tx, logIndex, block});

describe("offering history (API + live tail)", () => {
    it("live reading starts after the indexer, or at the deployment without one", () => {
        expect(liveStart("41491999", 41_489_012n)).toBe(41_492_000n);
        expect(liveStart(null, 41_489_012n)).toBe(41_489_012n);
        expect(liveStart(undefined, 41_489_012n)).toBe(41_489_012n);
        expect(liveStart("1", 41_489_012n)).toBe(41_489_012n);
    });
    it("an event in both is counted once; newest first", () => {
        const api = [k("0xAA", 0, 10n), k("0xbb", 1, 11n)];
        const live = [k("0xaa", 0, 10n), k("0xcc", 0, 12n)];
        expect(mergeHistory(api, live).map((x) => x.tx.toLowerCase())).toEqual(["0xcc", "0xbb", "0xaa"]);
    });
    it("participants: API last commitments, then live commits and cancels by chain order", () => {
        const W = "0x2D6E234037Da0180be8e4B905f3baA6C544b391d";
        const api = [{...k("0x1", 0, 10n), wallet: W.toLowerCase(), cumulative: 300_000n}];
        expect(participantCount(api, [])).toBe(1);
        // the same wallet commits again live: still one
        expect(participantCount(api, [{...k("0x2", 0, 20n), wallet: W, cumulative: 400_000n}])).toBe(1);
        // a new wallet commits live: two; the first cancels everything: one
        const bob = {...k("0x3", 0, 21n), wallet: "0xb0b", cumulative: 1n};
        expect(participantCount(api, [bob])).toBe(2);
        expect(participantCount(api, [bob, {...k("0x4", 0, 22n), wallet: W, cumulative: 0n}])).toBe(1);
        // an older live event never overrides a newer API one
        expect(participantCount(api, [{...k("0x0", 0, 5n), wallet: W, cumulative: 0n}])).toBe(1);
    });
});
