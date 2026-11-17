import {describe, expect, it} from "vitest";
import {POSITION_PX, positionFontSize, positionScale, positionWidthEm} from "./positionSize";

describe("waitlist position size (W-T49)", () => {
    it("full size up to three digits", () => {
        for (const t of ["1", "12", "999"]) expect(positionScale(t)).toBe(1);
        expect(positionFontSize("1").desktop).toBe(`${POSITION_PX.desktop}px`);
        expect(positionFontSize("1").mobile).toContain(`${POSITION_PX.mobile}px`);
    });
    it("shrinks from four digits so the line is never wider than #999", () => {
        const base = positionWidthEm("999");
        for (const t of ["1,234", "12,345", "123,456", "1,234,567"]) {
            const s = positionScale(t);
            expect(s).toBeLessThan(1);
            expect(positionWidthEm(t) * s).toBeCloseTo(base, 6);
        }
        expect(positionScale("12,345")).toBeLessThan(positionScale("1,234"));
    });
    it("on a 390px phone the number fits in the screen minus the gutter", () => {
        for (const t of ["1", "999", "12,345", "1,234,567"]) {
            const px = POSITION_PX.mobile * positionScale(t);
            expect(px * positionWidthEm(t)).toBeLessThanOrEqual(390 - 40);
            expect(positionFontSize(t).mobile).toMatch(/^min\(.+px, calc\(\(100vw - 40px\) \/ [\d.]+\)\)$/);
        }
    });
});
