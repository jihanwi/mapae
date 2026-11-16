import {describe, expect, it} from "vitest";
import {FEED_PAGE, nextFeedBefore} from "./follow";

describe("feed paging", () => {
    const page = (n: number) => Array.from({length: n}, (_, i) => ({ts: String(1_000 - i)}));
    it("a full page continues before its oldest ts; a short page ends", () => {
        expect(FEED_PAGE).toBe(50);
        expect(nextFeedBefore(page(50))).toBe("951");
        expect(nextFeedBefore(page(49))).toBeUndefined();
        expect(nextFeedBefore([])).toBeUndefined();
    });
});
