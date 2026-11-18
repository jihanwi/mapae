// The enforced CSP (web/vercel.json) and the inline-code guard that runs after every build
// (scripts/checkInline.mjs as npm's postbuild).
import {describe, expect, it} from "vitest";
import VERCEL from "../../vercel.json";
import INDEX_HTML from "../../index.html?raw";
import {inlineViolations} from "../../scripts/checkInline.mjs";
import {shareHtml} from "./share";

const headers = VERCEL.headers[0].headers;
const csp = headers.filter((h) => h.key.toLowerCase() === "content-security-policy");

describe("enforced CSP", () => {
    it("exactly one Content-Security-Policy, no Report-Only, every path", () => {
        expect(VERCEL.headers[0].source).toBe("/(.*)");
        expect(csp).toHaveLength(1);
        expect(headers.some((h) => h.key.toLowerCase() === "content-security-policy-report-only")).toBe(false);
    });
    it("the full policy, with frame-ancestors 'none' and nothing unsafe", () => {
        const v = csp[0].value;
        expect(v).toBe(
            "default-src 'self'; script-src 'self'; style-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com; img-src 'self' data: blob: https://*.public.blob.vercel-storage.com; connect-src 'self' https://sepolia-rpc.giwa.io; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
        );
        expect(v).not.toMatch(/unsafe-inline|unsafe-eval/);
    });
    it("the other security headers are unchanged", () => {
        const get = (k: string) => headers.find((h) => h.key === k)?.value;
        expect(get("X-Frame-Options")).toBe("DENY");
        expect(get("X-Content-Type-Options")).toBe("nosniff");
        expect(get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
        expect(get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
    });
});

describe("inline-code guard (postbuild)", () => {
    it("flags inline scripts, style tags, style attributes and handler attributes", () => {
        expect(inlineViolations(`<script>alert(1)</script>`)).toHaveLength(1);
        expect(inlineViolations(`<script type="module">import "x"</script>`)).toHaveLength(1);
        expect(inlineViolations(`<script src="/a.js">x</script>`)).toHaveLength(1);
        expect(inlineViolations(`<style>body{}</style>`)).toHaveLength(1);
        expect(inlineViolations(`<div style="color:red"></div>`)).toHaveLength(1);
        expect(inlineViolations(`<img src="a.png" onerror="x()">`)).toHaveLength(1);
    });
    it("passes external scripts and stylesheets", () => {
        expect(inlineViolations(`<script type="module" crossorigin src="/assets/index.js"></script><link rel="stylesheet" href="/a.css">`)).toEqual([]);
    });
    it("the source index.html and the share page are clean", () => {
        expect(inlineViolations(INDEX_HTML)).toEqual([]);
        expect(inlineViolations(shareHtml("https://m.example", {curve: "0x" + "c1".repeat(20), name: `<style>"x"</style>`, symbol: "S", meta: undefined}))).toEqual([]);
    });
});

describe("W-T54: the review host is kept out of search engines", () => {
    it("X-Robots-Tag noindex only when the host is mapae-gasok-7k2.vercel.app; the CSP block is unchanged", () => {
        expect(VERCEL.headers).toHaveLength(2);
        const robots = VERCEL.headers[1] as {source: string; has?: {type: string; value: string}[]; headers: {key: string; value: string}[]};
        expect(robots.source).toBe("/(.*)");
        expect(robots.has).toEqual([{type: "host", value: "mapae-gasok-7k2.vercel.app"}]);
        expect(robots.headers).toEqual([{key: "X-Robots-Tag", value: "noindex, nofollow"}]);
        expect(JSON.stringify(VERCEL.headers[0])).not.toContain("X-Robots-Tag");
    });
});
