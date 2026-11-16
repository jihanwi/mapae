// WCAG 2.x text contrast of the color tokens (tailwind.config.js) used for text on the dark
// surfaces: error (decision 52), success and the body text must reach 4.5:1 (AA) on ink-950, 900
// and 800. up / down are chart-only and not checked here.
import {describe, expect, it} from "vitest";
import CONFIG from "../../tailwind.config.js?raw";

/** "#RRGGBB" of a token in the config source, e.g. token("error"), token("ink", "950"). */
function token(name: string, shade?: string): string {
    const re = shade
        ? new RegExp(`${name}:\\s*\\{[^}]*\\b${shade}:\\s*"(#[0-9A-Fa-f]{6})"`)
        : new RegExp(`\\b${name}:\\s*"(#[0-9A-Fa-f]{6})"`);
    const m = re.exec(CONFIG);
    if (!m) throw new Error(`token ${name}${shade ? "-" + shade : ""} not found`);
    return m[1];
}

const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = [token("ink", "950"), token("ink", "900"), token("ink", "800")];

describe("token text contrast (WCAG AA 4.5:1)", () => {
    it("the formula matches known pairs", () => {
        expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
        expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
    });
    it("reads the decision 52 error value", () => {
        expect(token("error")).toBe("#C97A68");
        expect(SURFACES).toEqual(["#1A1510", "#221C15", "#2A231A"]);
    });
    it.each([
        ["error", token("error")],
        ["success", token("success")],
        ["body text (hanji-100)", token("hanji", "100")],
    ])("%s is at least 4.5:1 on ink-950, ink-900 and ink-800", (_name, fg) => {
        for (const bg of SURFACES) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
});
