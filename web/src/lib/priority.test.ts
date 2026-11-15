import {describe, expect, it} from "vitest";
import {fmtMmSs, inPriorityWindow, minSec, priorityRemaining} from "./priority";

describe("priority window", () => {
    it("counts down, is 0 at the boundary and never negative", () => {
        expect(priorityRemaining(1_000n, 400)).toBe(600);
        expect(priorityRemaining(1_000n, 999)).toBe(1);
        expect(priorityRemaining(1_000n, 1_000)).toBe(0);
        expect(priorityRemaining(1_000n, 5_000)).toBe(0);
        expect(priorityRemaining(1_000, 999.7)).toBe(1);
        expect(inPriorityWindow(1_000n, 999)).toBe(true);
        expect(inPriorityWindow(1_000n, 1_000)).toBe(false);
    });
    it("formats mm:ss and minutes/seconds", () => {
        expect(fmtMmSs(600)).toBe("10:00");
        expect(fmtMmSs(65)).toBe("01:05");
        expect(fmtMmSs(0)).toBe("00:00");
        expect(fmtMmSs(-3)).toBe("00:00");
        expect(fmtMmSs(3665)).toBe("61:05");
        expect(minSec(125)).toEqual({m: 2, s: 5});
    });
});
