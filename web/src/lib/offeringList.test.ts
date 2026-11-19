import {describe, expect, it} from "vitest";
import {offeringSections, quickCommits} from "./offeringList";

const NOW = 1_800_000_000_000;
const sec = (s: number) => BigInt(Math.floor(NOW / 1000) + s);
type O = {id: string; settled: boolean; refunding: boolean; phase?: number; deadline: bigint};
const o = (id: string, p: Partial<O>): O => ({id, settled: false, refunding: false, phase: 1, deadline: sec(3600), ...p});
const ids = (xs: O[]) => xs.map((x) => x.id);

describe("offeringSections", () => {
    it("no open offering", () => {
        const s = offeringSections([o("s", {settled: true, phase: 3}), o("r", {refunding: true, phase: 4})], NOW);
        expect(s.open).toEqual([]);
        expect(ids(s.closed).sort()).toEqual(["r", "s"]);
    });
    it("open only, nearest deadline first (the frozen last hours count as open)", () => {
        const s = offeringSections([o("far", {deadline: sec(86_400)}), o("frozen", {deadline: sec(600)}), o("mid", {deadline: sec(7200)})], NOW);
        expect(ids(s.open)).toEqual(["frozen", "mid", "far"]);
        expect(s.closed).toEqual([]);
    });
    it("closed only, latest deadline first", () => {
        const s = offeringSections([o("old", {settled: true, deadline: sec(-90_000)}), o("ended", {deadline: sec(-60)}), o("ref", {refunding: true, deadline: sec(-5000)})], NOW);
        expect(s.open).toEqual([]);
        expect(ids(s.closed)).toEqual(["ended", "ref", "old"]);
    });
    it("mixed: refund state by phase 4 alone is closed too", () => {
        const s = offeringSections([o("live", {}), o("p4", {phase: 4}), o("set", {settled: true, deadline: sec(-10)})], NOW);
        expect(ids(s.open)).toEqual(["live"]);
        expect(ids(s.closed)).toEqual(["p4", "set"]);
    });
});

describe("quickCommits", () => {
    const E = 10n ** 18n;
    it("min and the rest of the wallet limit", () => {
        expect(quickCommits(10_000n * E, 5_000_000n * E, 1_000_000n * E)).toEqual({min: 10_000n * E, upTo: 4_000_000n * E});
    });
    it("nothing left under the limit: both off", () => {
        expect(quickCommits(10_000n * E, 5_000_000n * E, 5_000_000n * E)).toEqual({min: null, upTo: null});
    });
    it("less than the minimum left: min off, the rest still offered", () => {
        expect(quickCommits(10_000n * E, 5_000_000n * E, 4_995_000n * E)).toEqual({min: null, upTo: 5_000n * E});
    });
    it("no wallet limit: min only", () => {
        expect(quickCommits(10_000n * E, 0n, 0n)).toEqual({min: 10_000n * E, upTo: null});
    });
});
