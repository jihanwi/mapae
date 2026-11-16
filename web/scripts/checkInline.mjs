// Post-build guard for the enforced CSP (web/vercel.json: script-src 'self', style-src without
// 'unsafe-inline'): the built index.html must load scripts and styles from files only. Any inline
// <script> (no src), <style> tag, style="" attribute or on*="" handler would be blocked in
// production, so the build fails here instead. Run as npm's postbuild: node scripts/checkInline.mjs dist/index.html
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";

/** Inline code the CSP would block, as short descriptions; [] when the page is clean. */
export function inlineViolations(html) {
    const out = [];
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const attrs = m[1];
        if (!/\ssrc\s*=/i.test(attrs)) out.push(`inline <script${attrs}>`);
        else if (m[2].trim() !== "") out.push(`<script${attrs}> with an inline body`);
    }
    for (const m of html.matchAll(/<style\b[^>]*>/gi)) out.push(`inline ${m[0]}`);
    for (const m of html.matchAll(/<[a-z][^>]*\sstyle\s*=\s*["'][^"']*["'][^>]*>/gi)) out.push(`style attribute in ${m[0].slice(0, 80)}`);
    for (const m of html.matchAll(/<[a-z][^>]*\son[a-z]+\s*=[^>]*>/gi)) out.push(`event handler attribute in ${m[0].slice(0, 80)}`);
    return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    const file = process.argv[2] ?? "dist/index.html";
    const found = inlineViolations(readFileSync(file, "utf8"));
    if (found.length > 0) {
        console.error(`${file}: inline code the CSP blocks (script-src 'self', no 'unsafe-inline'):\n  ${found.join("\n  ")}`);
        process.exit(1);
    }
    console.log(`${file}: no inline script or style`);
}
