import {describe, expect, it} from "vitest";
import {proceedsStatus, spanParts, vestedAt} from "./proceeds";

const DAY = 86_400n;
const start = 1_800_000_000n; // the offering deadline
const terms = {start, duration: 365n * DAY, cliff: start + 30n * DAY};
const E = 10n ** 18n;

describe("proceeds schedule (ProceedsLock = VestingWalletCliff)", () => {
    it("before the start: nothing unlocked, next point is the cliff", () => {
        const s = proceedsStatus(terms, {balance: 700n * E, released: 0n}, start - 100n);
        expect(s.phase).toBe("beforeCliff");
        expect(s.unlocked).toBe(0n);
        expect(s.remaining).toBe(700n * E);
        expect(s.nextAt).toBe(terms.cliff);
    });
    it("before the cliff (after the start): still nothing", () => {
        const s = proceedsStatus(terms, {balance: 700n * E, released: 0n}, start + 29n * DAY);
        expect(s.phase).toBe("beforeCliff");
        expect(s.releasable).toBe(0n);
    });
    it("at the cliff the linear part from the start becomes releasable at once", () => {
        const s = proceedsStatus(terms, {balance: 365n * E, released: 0n}, terms.cliff);
        expect(s.phase).toBe("vesting");
        expect(s.releasable).toBe(30n * E);
        expect(s.nextAt).toBe(start + 365n * DAY);
    });
    it("during the period: released + releasable = vested, remaining is the rest", () => {
        // half way, 100 already released
        const s = proceedsStatus(terms, {balance: 265n * E, released: 100n * E}, start + (365n * DAY) / 2n);
        expect(s.total).toBe(365n * E);
        expect(s.unlocked).toBe(vestedAt(terms, 365n * E, start + (365n * DAY) / 2n));
        expect(s.releasable).toBe(s.unlocked - 100n * E);
        expect(s.released + s.releasable + s.remaining).toBe(s.total);
        expect(s.unlockedBps).toBe(5000);
    });
    it("at and after the end everything is unlocked and there is no next point", () => {
        for (const now of [start + 365n * DAY, start + 400n * DAY]) {
            const s = proceedsStatus(terms, {balance: 50n * E, released: 315n * E}, now);
            expect(s.phase).toBe("done");
            expect(s.releasable).toBe(50n * E);
            expect(s.remaining).toBe(0n);
            expect(s.nextAt).toBeUndefined();
        }
    });
    it("settle later than the deadline: the proceeds arrive with part already unlocked", () => {
        // no cliff, settled 10 days after the deadline: 10/365 of the lock is releasable right away
        const t = {start, duration: 365n * DAY, cliff: start};
        const s = proceedsStatus(t, {balance: 365n * E, released: 0n}, start + 10n * DAY);
        expect(s.phase).toBe("vesting");
        expect(s.releasable).toBe(10n * E);
    });
    it("released never exceeds vested in the output (no negative releasable)", () => {
        const s = proceedsStatus(terms, {balance: 0n, released: 0n}, start);
        expect(s.releasable).toBe(0n);
        expect(s.unlockedBps).toBe(0);
    });
    it("uses the chain releasable when given", () => {
        const s = proceedsStatus(terms, {balance: 365n * E, released: 0n, releasable: 31n * E}, terms.cliff);
        expect(s.releasable).toBe(31n * E);
        expect(s.unlocked + s.remaining).toBe(s.total);
    });
    it("lock length: days by default, hours under a day", () => {
        expect(spanParts(365n * DAY)).toEqual({n: 365, unit: "day"});
        expect(spanParts(1095n * DAY)).toEqual({n: 1095, unit: "day"});
        expect(spanParts(3_600n)).toEqual({n: 1, unit: "hour"});
        expect(spanParts(5_400n)).toEqual({n: 2, unit: "hour"});
        expect(spanParts(0)).toEqual({n: 1, unit: "hour"});
    });
});

describe("proceeds text", async () => {
    const {bpsPct, spanText} = await import("./proceedsText");
    it("percent and span strings", () => {
        expect(bpsPct(3000)).toBe("30");
        expect(bpsPct(2550)).toBe("25.5");
        expect(bpsPct(15)).toBe("0.15");
        expect(spanText(1095n * DAY)).toBe("1,095일");
        expect(spanText(3_600n)).toBe("1시간");
    });
});
