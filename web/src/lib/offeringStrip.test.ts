import {describe, expect, it} from "vitest";
import {hms, pickStrip, StripOffering} from "./offeringStrip";

const NOW = 1_000_000;
type O = StripOffering & {settledBlock?: bigint};
const o = (address: string, p: Partial<O>): O => ({address, settled: false, refunding: false, phase: 0, deadline: BigInt(NOW + 3600), ...p});
const sb = (x: O) => x.settledBlock;
const ids = (r: {o: O; kind: string}[]) => r.map((x) => `${x.o.address}:${x.kind}`);

describe("pickStrip", () => {
    it("no committing offering: trading ones only, newest settle first", () => {
        const list = [o("a", {settled: true, settledBlock: 10n}), o("b", {settled: true, settledBlock: 30n}), o("c", {settled: true, settledBlock: 20n})];
        expect(ids(pickStrip(list, NOW, sb))).toEqual(["b:trading", "c:trading", "a:trading"]);
    });
    it("four or more: committing first by nearest deadline, then trading, capped at 3", () => {
        const list = [
            o("t1", {settled: true, settledBlock: 5n}),
            o("c3", {deadline: BigInt(NOW + 900)}),
            o("c1", {deadline: BigInt(NOW + 100)}),
            o("c2", {deadline: BigInt(NOW + 500)}),
            o("c4", {deadline: BigInt(NOW + 9000)}),
        ];
        expect(ids(pickStrip(list, NOW, sb))).toEqual(["c1:committing", "c2:committing", "c3:committing"]);
        expect(ids(pickStrip(list.slice(0, 3), NOW, sb))).toEqual(["c1:committing", "c3:committing", "t1:trading"]);
    });
    it("settled only, with an unknown settle block: known first, unknown by later deadline", () => {
        const list = [o("u1", {settled: true, deadline: 50n}), o("k", {settled: true, settledBlock: 7n}), o("u2", {settled: true, deadline: 80n})];
        expect(ids(pickStrip(list, NOW, sb))).toEqual(["k:trading", "u2:trading", "u1:trading"]);
    });
    it("all in refunds: nothing (refunding flag or phase 4)", () => {
        const list = [o("r1", {refunding: true}), o("r2", {phase: 4}), o("r3", {refunding: true, deadline: BigInt(NOW - 10)})];
        expect(pickStrip(list, NOW, sb)).toEqual([]);
    });
    it("past the deadline and not settled: not shown", () => {
        expect(pickStrip([o("e", {deadline: BigInt(NOW - 1)}), o("d", {deadline: BigInt(NOW)})], NOW, sb)).toEqual([]);
    });
});

describe("hms", () => {
    it("formats seconds, hours past 24 kept", () => {
        expect(hms(0)).toBe("00:00:00");
        expect(hms(3661)).toBe("01:01:01");
        expect(hms(90_000)).toBe("25:00:00");
        expect(hms(-5)).toBe("00:00:00");
    });
});
