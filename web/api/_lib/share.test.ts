import {describe, expect, it} from "vitest";
import {escapeHtml, handleShare, parseShareCurve, SHARE_CACHE, shareHtml} from "./share";

const C = "0x00000000000000000000000000000000000000C1";
const c = C.toLowerCase();
const ORIGIN = "https://mapae.example";
const entry = (over = {}) => ({description: "Horse <b>\"fast\"</b> & 'proud'", links: {x: "", telegram: "", website: ""}, imageUrl: "https://blob.example/a.png", ...over});

describe("share page", () => {
    it("escapes & < > \" '", () => {
        expect(escapeHtml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&#39;f");
        expect(parseShareCurve(C)).toBe(c);
        expect(parseShareCurve("0x123")).toBeNull();
        expect(parseShareCurve(null)).toBeNull();
    });
    it("HTML: og/twitter tags, escaped values, refresh into the app, no script", () => {
        const html = shareHtml(ORIGIN, {curve: c, name: `<img src=x onerror=alert(1)>`, symbol: "H\"N", meta: entry()});
        expect(html).not.toMatch(/<script/i);
        expect(html).not.toContain("<img src=x");
        expect(html).toContain(`<meta property="og:title" content="&lt;img src=x onerror=alert(1)&gt; (H&quot;N) | MAPAE" />`);
        expect(html).toContain(`<meta property="og:description" content="Horse &lt;b&gt;&quot;fast&quot;&lt;/b&gt; &amp; &#39;proud&#39;" />`);
        expect(html).toContain(`<meta property="og:image" content="https://blob.example/a.png" />`);
        expect(html).toContain(`<meta property="og:url" content="${ORIGIN}/t/${c}" />`);
        expect(html).toContain(`<meta name="twitter:card" content="summary" />`);
        expect(html).toContain(`<meta http-equiv="refresh" content="0;url=/#/t/${c}" />`);
    });
    it("no metadata (or a hidden curve): site description and logo", () => {
        const html = shareHtml(ORIGIN, {curve: c, name: "Horse", symbol: "HRN", meta: undefined});
        expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/logo.png" />`);
        expect(html).toContain("첫 10분은 실명 지갑만 삽니다");
    });
    it("handler: 302 to / when malformed or unknown; 200 HTML with the cache header", async () => {
        const deps = {curveName: async (x: string) => (x === c ? {name: "Horse", symbol: "HRN"} : null), metaIndex: async () => ({[c]: entry()})};
        const bad = await handleShare("nope", ORIGIN, deps);
        expect(bad.status).toBe(302);
        expect(bad.headers.get("location")).toBe("/");
        const unknown = await handleShare("0x" + "d".repeat(40), ORIGIN, deps);
        expect(unknown.status).toBe(302);
        expect(unknown.headers.get("location")).toBe("/");
        const ok = await handleShare(C, ORIGIN, deps);
        expect(ok.status).toBe(200);
        expect(ok.headers.get("content-type")).toContain("text/html");
        expect(ok.headers.get("cache-control")).toBe(SHARE_CACHE);
        expect(SHARE_CACHE).toBe("s-maxage=300, stale-while-revalidate=3600");
        expect(await ok.text()).toContain("Horse (HRN) | MAPAE");
    });
    it("handler: hidden curve (not in the public index) has no description or image; a store failure too", async () => {
        const hidden = await handleShare(C, ORIGIN, {curveName: async () => ({name: "Horse", symbol: "HRN"}), metaIndex: async () => ({})});
        expect(await hidden.text()).not.toContain("blob.example");
        const failing = await handleShare(C, ORIGIN, {curveName: async () => ({name: "Horse", symbol: "HRN"}), metaIndex: async () => Promise.reject(new Error("x"))});
        expect(failing.status).toBe(200);
    });
    it("handler: DB failure sends the visitor into the app without a preview", async () => {
        const r = await handleShare(C, ORIGIN, {curveName: async () => Promise.reject(new Error("db")), metaIndex: async () => ({})});
        expect(r.status).toBe(302);
        expect(r.headers.get("location")).toBe(`/#/t/${c}`);
    });
});
