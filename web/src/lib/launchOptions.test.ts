import {describe, expect, it} from "vitest";
import {checkStart, earliestMinutes, launchArgs, parseLocalDateTime, SUBMIT_MARGIN_SEC, toLocalInput, utcOffsetLabel} from "./launchOptions";

const NOW = 1_800_000_000;
const MIN = 600;
const MAX = 604_800;

describe("checkStart (factory bounds + submit margin)", () => {
    it("9 minutes ahead is too soon, 8 days too late, inside the band ok", () => {
        expect(checkStart(NOW + 9 * 60, NOW, MIN, MAX)).toEqual({ok: false, reason: "tooSoon"});
        expect(checkStart(NOW + 8 * 86_400, NOW, MIN, MAX)).toEqual({ok: false, reason: "tooLate"});
        expect(checkStart(NOW + 3600, NOW, MIN, MAX)).toEqual({ok: true});
        expect(checkStart(NOW + MAX, NOW, MIN, MAX)).toEqual({ok: true});
    });
    it("the minimum needs the 2-minute margin", () => {
        expect(checkStart(NOW + MIN, NOW, MIN, MAX)).toEqual({ok: false, reason: "tooSoon"});
        expect(checkStart(NOW + MIN + SUBMIT_MARGIN_SEC - 1, NOW, MIN, MAX)).toEqual({ok: false, reason: "tooSoon"});
        expect(checkStart(NOW + MIN + SUBMIT_MARGIN_SEC, NOW, MIN, MAX)).toEqual({ok: true});
        expect(earliestMinutes(MIN)).toBe(12);
    });
    it("a pick that was fine goes stale as time passes", () => {
        const pick = NOW + MIN + SUBMIT_MARGIN_SEC;
        expect(checkStart(pick, NOW + 1, MIN, MAX)).toEqual({ok: false, reason: "tooSoon"});
    });
    it("nothing picked", () => {
        expect(checkStart(null, NOW, MIN, MAX)).toEqual({ok: false, reason: "pick"});
    });
});

describe("launchArgs", () => {
    it("now: startTime 0, the Dev buy as typed", () => {
        expect(launchArgs("now", NOW + 3600, 5n, false)).toEqual({options: {startTime: 0n, verifiedOnly: false}, devBuy: 5n});
    });
    it("scheduled: the start time and a Dev buy of 0, whatever was typed", () => {
        expect(launchArgs("scheduled", NOW + 3600, 5n, true)).toEqual({options: {startTime: BigInt(NOW + 3600), verifiedOnly: true}, devBuy: 0n});
    });
});

describe("local date-time input", () => {
    it("round-trips minutes and rejects junk", () => {
        const sec = Math.floor(new Date(2026, 10, 21, 21, 0).getTime() / 1000);
        expect(toLocalInput(sec)).toBe("2026-11-21T21:00");
        expect(parseLocalDateTime("2026-11-21T21:00")).toBe(sec);
        expect(parseLocalDateTime("")).toBeNull();
        expect(parseLocalDateTime("tomorrow")).toBeNull();
    });
    it("offset label has the UTC prefix", () => {
        expect(utcOffsetLabel(NOW)).toMatch(/^UTC([+-]\d{1,2}(:\d{2})?)?$/);
    });
});
