// W-T75: the band's collapsed state; a throwing storage leaves the band shown.
import {describe, expect, it, vi} from "vitest";
import {GUIDE_COLLAPSED_KEY, readGuideCollapsed, writeGuideCollapsed} from "./guideCollapse";

function memory() {
    const m = new Map<string, string>();
    return {getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m};
}

describe("W-T75 guide collapsed state", () => {
    it("first visit: shown; hide and show round-trip", () => {
        const s = memory();
        expect(readGuideCollapsed(() => s)).toBe(false);
        writeGuideCollapsed(true, () => s);
        expect(s.m.get(GUIDE_COLLAPSED_KEY)).toBe("1");
        expect(readGuideCollapsed(() => s)).toBe(true);
        writeGuideCollapsed(false, () => s);
        expect(readGuideCollapsed(() => s)).toBe(false);
    });
    it("a throwing storage reads as shown and writes nothing (logged, no throw)", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const throwing = {
            getItem: () => {
                throw new Error("SecurityError");
            },
            setItem: () => {
                throw new Error("QuotaExceeded");
            },
        };
        expect(readGuideCollapsed(() => throwing)).toBe(false);
        expect(() => writeGuideCollapsed(true, () => throwing)).not.toThrow();
        // the accessor itself throwing (blocked localStorage)
        expect(
            readGuideCollapsed(() => {
                throw new Error("blocked");
            }),
        ).toBe(false);
        expect(readGuideCollapsed(() => null)).toBe(false);
        expect(warn).toHaveBeenCalledTimes(3);
        warn.mockRestore();
    });
});
