// W-T52: the card's number size rule, its words, and one real render (PNG 1200x630).
import {describe, expect, it} from "vitest";
import {CARD_H, CARD_NUMBER_MAX_W, CARD_NUMBER_PX, CARD_TEXT, CARD_W, cardElement, cardNumberPx, cardNumberText, renderCard} from "./waitlistCard.js";
import {positionWidthEm} from "../../src/lib/positionSize.js";

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
    });
});

describe("render", () => {
    it("a 1200x630 PNG with the repo fonts and logo", async () => {
        const png = await renderCard(42);
        expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const v = new DataView(png.buffer, png.byteOffset);
        expect([v.getUint32(16), v.getUint32(20)]).toEqual([CARD_W, CARD_H]);
    }, 30_000);
});
