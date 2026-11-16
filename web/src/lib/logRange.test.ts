import {describe, expect, it} from "vitest";
import {FIRST_READ_BLOCKS, LOG_CHUNK, logState, planScan, splitRange} from "./logRange";

const DEPLOY = 41_489_012n;

describe("log scan ranges (W-T32)", () => {
    it("every request is at most 9,000 blocks and the ranges are contiguous", () => {
        const r = splitRange(100n, 30_000n);
        expect(r[0]).toEqual([100n, 9_099n]);
        expect(r.at(-1)).toEqual([27_100n, 30_000n]);
        for (const [a, b] of r) expect(b - a + 1n).toBeLessThanOrEqual(LOG_CHUNK);
        for (let i = 1; i < r.length; i++) expect(r[i][0]).toBe(r[i - 1][1] + 1n);
    });
    it("first read close to the deployment reaches it: complete", () => {
        const p = planScan({deployBlock: DEPLOY, latest: DEPLOY + 20_000n});
        expect(p.reset).toBe(true);
        expect(p.ranges[0][0]).toBe(DEPLOY);
        expect(p.ranges).toHaveLength(3);
        expect(p.window).toEqual({fromBlock: DEPLOY, toBlock: DEPLOY + 20_000n, complete: true});
    });
    it("first read far from the deployment: the newest 12 windows only, partial, says where it started", () => {
        const latest = DEPLOY + 500_000n;
        const p = planScan({deployBlock: DEPLOY, latest});
        expect(p.ranges).toHaveLength(12);
        expect(p.window.complete).toBe(false);
        expect(p.window.fromBlock).toBe(latest - FIRST_READ_BLOCKS + 1n);
        expect(p.ranges[0][0]).toBe(p.window.fromBlock);
        expect(p.ranges.at(-1)![1]).toBe(latest);
        for (const [a, b] of p.ranges) expect(b - a + 1n).toBe(LOG_CHUNK);
    });
    it("exactly 108,000 blocks after the deployment is still complete; one more is not", () => {
        expect(planScan({deployBlock: DEPLOY, latest: DEPLOY + FIRST_READ_BLOCKS - 1n}).window.complete).toBe(true);
        expect(planScan({deployBlock: DEPLOY, latest: DEPLOY + FIRST_READ_BLOCKS}).window.complete).toBe(false);
    });
    it("later reads continue after the last block and keep the start and complete flag", () => {
        const first = planScan({deployBlock: DEPLOY, latest: DEPLOY + 500_000n}).window;
        const next = planScan({deployBlock: DEPLOY, latest: first.toBlock + 15n, prev: first});
        expect(next.reset).toBe(false);
        expect(next.ranges).toEqual([[first.toBlock + 1n, first.toBlock + 15n]]);
        expect(next.window).toEqual({fromBlock: first.fromBlock, toBlock: first.toBlock + 15n, complete: false});
        const done = planScan({deployBlock: DEPLOY, latest: DEPLOY + 10n, prev: {fromBlock: DEPLOY, toBlock: DEPLOY + 5n, complete: true}});
        expect(done.window.complete).toBe(true);
    });
    it("nothing new: no request", () => {
        const w = {fromBlock: DEPLOY, toBlock: DEPLOY + 100n, complete: true};
        expect(planScan({deployBlock: DEPLOY, latest: DEPLOY + 100n, prev: w})).toEqual({ranges: [], window: w, reset: false});
    });
    it("a gap longer than one first read starts over (window stays contiguous)", () => {
        const w = {fromBlock: DEPLOY, toBlock: DEPLOY + 100n, complete: true};
        const p = planScan({deployBlock: DEPLOY, latest: DEPLOY + 100n + FIRST_READ_BLOCKS + 1n, prev: w});
        expect(p.reset).toBe(true);
        expect(p.ranges).toHaveLength(12);
        expect(p.window.complete).toBe(false);
    });
    it("an RPC behind the deployment reads nothing", () => {
        expect(planScan({deployBlock: DEPLOY, latest: DEPLOY - 1n}).ranges).toEqual([]);
    });
    it("screen state: failure is not an empty list", () => {
        expect(logState({isError: true, hasData: false, complete: undefined})).toBe("error");
        expect(logState({isError: false, hasData: false, complete: undefined})).toBe("loading");
        expect(logState({isError: false, hasData: true, complete: false})).toBe("partial");
        expect(logState({isError: false, hasData: true, complete: true})).toBe("complete");
        // a later refresh failing keeps what was read
        expect(logState({isError: true, hasData: true, complete: true})).toBe("complete");
    });
});
