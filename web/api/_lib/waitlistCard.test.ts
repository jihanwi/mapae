// W-T52: the card's number size rule, its words, and one real render (PNG 1200x630).
import {readFile} from "node:fs/promises";
import {describe, expect, it, vi} from "vitest";
import {BG_H, BG_TOP, CARD_H, CARD_NUMBER_MAX_W, CARD_NUMBER_PX, CARD_TEXT, CARD_W, cardElement, cardNumberPx, cardNumberText, loadBackdrop, renderCard} from "./waitlistCard.js";
import {positionWidthEm} from "../../src/lib/positionSize.js";

// W-T69 first in the file: the failure case needs the picture not loaded yet
describe("W-T69: the backdrop picture", () => {
    it("covers the card with the picture's 58% line on the card's middle", () => {
        expect(BG_H).toBe(750);
        expect(BG_TOP).toBe(-120);
        expect(Math.abs(BG_TOP + 0.58 * BG_H - CARD_H / 2)).toBeLessThanOrEqual(1);
    });
    it("a failed read is logged, not remembered; the next read succeeds", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await loadBackdrop(() => Promise.reject(new Error("ENOENT")))).toBeNull();
        expect(err).toHaveBeenCalledTimes(1);
        // the real picture on the next call (no failure memo)
        expect(await loadBackdrop(() => readFile(new URL("../../public/waitlist-bg.jpg", import.meta.url)))).toMatch(/^data:image\/jpeg;base64,\/9j\//);
        err.mockRestore();
    });
    it("renders a 1200x630 PNG with the picture", async () => {
        const png = await renderCard(42);
        const v = new DataView(png.buffer, png.byteOffset);
        expect([v.getUint32(16), v.getUint32(20)]).toEqual([CARD_W, CARD_H]);
    }, 30_000);
});

describe("card number size", () => {
    it("full size up to four digits, smaller from five, always within the column", () => {
        for (const n of [1, 42, 999, 1234]) expect(cardNumberPx(cardNumberText(n)), String(n)).toBe(CARD_NUMBER_PX);
        let prev = CARD_NUMBER_PX;
        for (const n of [12345, 123456, 1234567, 12345678]) {
            const t = cardNumberText(n);
            const px = cardNumberPx(t);
            expect(px, t).toBeLessThan(CARD_NUMBER_PX);
            expect(px, t).toBeLessThanOrEqual(prev);
            expect(px * positionWidthEm(t), t).toBeLessThanOrEqual(CARD_NUMBER_MAX_W);
            prev = px;
        }
    });
    it("en-US grouping, never below 1", () => {
        expect(cardNumberText(12345)).toBe("12,345");
        expect(cardNumberText(0)).toBe("1");
    });
});

describe("card words", () => {
    it("only MAPAE, WAITLIST and the line; nothing about the product, tokens, points or rewards", () => {
        expect(CARD_TEXT).toEqual({brand: "MAPAE", label: "WAITLIST", line: "Everyone starts from the same line."});
        const FORBIDDEN = [/런치패드/, /launchpad/i, /실명/, /bonding/i, /공모/, /토큰/, /포인트/, /보상/, /에어드[랍롭]/, /token/i, /\bpoints?\b/i, /reward/i, /airdrop/i];
        for (const s of Object.values(CARD_TEXT)) for (const w of FORBIDDEN) expect(s, `${w}`).not.toMatch(w);
        // the element tree carries no other text than these and the number
        const texts: string[] = [];
        const walk = (n: unknown) => {
            if (typeof n === "string") texts.push(n);
            else if (Array.isArray(n)) n.forEach(walk);
            else if (n && typeof n === "object" && "props" in n) walk((n as {props: {children?: unknown}}).props.children);
        };
        walk(cardElement(42, "data:image/png;base64,"));
        expect(texts).toEqual(["MAPAE", "WAITLIST", "#", "42", "Everyone starts from the same line."]);
        // W-T69: the backdrop adds no words
        texts.length = 0;
        walk(cardElement(42, "data:image/png;base64,", "data:image/jpeg;base64,"));
        expect(texts).toEqual(["MAPAE", "WAITLIST", "#", "42", "Everyone starts from the same line."]);
    });
});

/** Decodes an 8-bit RGB/RGBA non-interlaced PNG (what resvg writes) with the web-standard
 *  DecompressionStream, so the test needs no image library. */
async function decodePng(png: Uint8Array): Promise<{w: number; h: number; bpp: number; px: Uint8Array}> {
    const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const w = v.getUint32(16), h = v.getUint32(20), depth = png[24], color = png[25], interlace = png[28];
    if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) throw new Error(`unsupported png ${depth}/${color}/${interlace}`);
    const bpp = color === 6 ? 4 : 3;
    const parts: Uint8Array[] = [];
    for (let o = 8; o < png.length; ) {
        const len = v.getUint32(o);
        const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
        if (type === "IDAT") parts.push(png.subarray(o + 8, o + 8 + len));
        o += 12 + len;
    }
    const stream = new Blob(parts as BlobPart[]).stream().pipeThrough(new DecompressionStream("deflate"));
    const raw = new Uint8Array(await new Response(stream).arrayBuffer());
    const stride = w * bpp;
    const px = new Uint8Array(h * stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)];
        const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const cur = px.subarray(y * stride, (y + 1) * stride);
        const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
        for (let i = 0; i < stride; i++) {
            const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
            let p = 0;
            if (f === 1) p = a;
            else if (f === 2) p = b;
            else if (f === 3) p = (a + b) >> 1;
            else if (f === 4) {
                const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
                p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            cur[i] = (src[i] + p) & 0xff;
        }
    }
    return {w, h, bpp, px};
}

/** The box of pixels that differ from the ink-950 background (#1A1510). */
export async function contentBox(png: Uint8Array) {
    const {w, h, bpp, px} = await decodePng(png);
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * bpp;
            if (Math.abs(px[i] - 0x1a) + Math.abs(px[i + 1] - 0x15) + Math.abs(px[i + 2] - 0x10) > 24) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    return {x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2};
}

describe("render", () => {
    it("a 1200x630 PNG with the repo fonts and logo", async () => {
        const png = await renderCard(42);
        expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const v = new DataView(png.buffer, png.byteOffset);
        expect([v.getUint32(16), v.getUint32(20)]).toEqual([CARD_W, CARD_H]);
    }, 30_000);
});

describe("W-T53: the content sits in the middle of the card", () => {
    for (const n of [1, 42, 1234, 12345]) {
        // W-T69: measured on the plain card (the picture would count as content); the content row is
        // the same element with and without the picture
        it(`#${n}: content centre within 8px of (600, 315)`, async () => {
            const b = await contentBox(await renderCard(n, {backdrop: false}));
            console.log(`card #${n}: x ${b.x0}-${b.x1} (centre ${b.cx}), y ${b.y0}-${b.y1} (centre ${b.cy})`);
            expect(Math.abs(b.cx - CARD_W / 2), `x centre ${b.cx}`).toBeLessThanOrEqual(8);
            expect(Math.abs(b.cy - CARD_H / 2), `y centre ${b.cy}`).toBeLessThanOrEqual(8);
        }, 30_000);
    }
});
