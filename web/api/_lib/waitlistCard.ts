// W-T52: the waitlist card, a 1200x630 PNG with the line number of one referral code
// (GET /api/waitlist?card=<code>). Rendered with @vercel/og (satori + resvg) from the fonts in
// ./fonts and public/logo.png, read with fs on the first card. Only a successful read is kept in
// memory: a failed read throws (the handler logs it and redirects to /og-waitlist.png) and the next
// request tries again. Nothing here describes the product, and there is no handle, wallet, date or
// signup count on the card.
// W-T69: the owner's picture (public/waitlist-bg.jpg) under two ink-950 veils and a thin inner
// frame. Without the picture (a failed read is logged and retried on the next card) the card is the
// plain ink-950 one. The content row (logo, MAPAE, rule, WAITLIST, number, line) is unchanged.
import {readFile} from "node:fs/promises";
import {ImageResponse} from "@vercel/og";
import {positionWidthEm, HASH_SCALE} from "../../src/lib/positionSize.js";
import {SHARE_DESCRIPTION} from "./waitlist.js";

export const CARD_W = 1200;
export const CARD_H = 630;
/** Every word drawn on the card besides the number (the forbidden-word test reads these). */
export const CARD_TEXT = {brand: "MAPAE", label: "WAITLIST", line: SHARE_DESCRIPTION} as const;

/** The number's design size and the widest the "#1,234" line may be (right column). */
export const CARD_NUMBER_PX = 200;
export const CARD_NUMBER_MAX_W = 620;

/** "#" + the number with en-US grouping, e.g. 12345 -> "12,345" (the "#" is drawn apart). */
export const cardNumberText = (position: number) => Math.max(1, Math.floor(position)).toLocaleString("en-US");

/** Font size of the number: 200px while "#" + number fits in CARD_NUMBER_MAX_W, smaller after
 *  (from five digits), so it always stays on one line. Same width model as the joined screen. */
export function cardNumberPx(text: string): number {
    return Math.min(CARD_NUMBER_PX, Math.floor(CARD_NUMBER_MAX_W / positionWidthEm(text)));
}

type Assets = {serif600: ArrayBuffer; serif700: ArrayBuffer; sans400: ArrayBuffer; sans600: ArrayBuffer; logo: string};

const toArrayBuffer = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

function base64(u: Uint8Array): string {
    let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(s);
}
let assets: Assets | undefined;

/** W-T69: the backdrop picture as a data URI, kept only once a read succeeded. */
let backdrop: string | undefined;

const readBackdrop = () => readFile(new URL("../../public/waitlist-bg.jpg", import.meta.url));

/** null when the picture cannot be read: logged, not remembered (the next card reads it again).
 *  `read` is the file read (a test passes a failing one). */
export async function loadBackdrop(read: () => Promise<Uint8Array> = readBackdrop): Promise<string | null> {
    if (backdrop) return backdrop;
    try {
        const jpg = await read();
        backdrop = `data:image/jpeg;base64,${base64(jpg)}`;
        return backdrop;
    } catch (e) {
        console.error("waitlist card: backdrop picture not read; drawing the plain card", e);
        return null;
    }
}

async function loadAssets(): Promise<Assets> {
    if (assets) return assets;
    const f = (name: string) => readFile(new URL(`./fonts/${name}`, import.meta.url));
    const [serif600, serif700, sans400, sans600, logo] = await Promise.all([
        f("NotoSerifKR-600.woff"),
        f("NotoSerifKR-700.woff"),
        f("Pretendard-400.otf"),
        f("Pretendard-600.otf"),
        readFile(new URL("../../public/logo.png", import.meta.url)),
    ]);
    assets = {
        serif600: toArrayBuffer(serif600),
        serif700: toArrayBuffer(serif700),
        sans400: toArrayBuffer(sans400),
        sans600: toArrayBuffer(sans600),
        logo: `data:image/png;base64,${base64(logo)}`,
    };
    return assets;
}

type El = {type: string; props: Record<string, unknown> & {children?: unknown}};
const h = (type: string, style: Record<string, unknown>, ...children: unknown[]): El => ({
    type,
    // satori wants an explicit display on every div
    props: {style: type === "div" ? {display: "flex", ...style} : style, children: children.length === 1 ? children[0] : children},
});

const INK_950 = "#1A1510";
const HANJI_100 = "#F2EAD9";
/** W-T69: the line under the number, lifted from hanji-400 for contrast on the picture. */
const LINE_COLOR = "#CFC3AC";
const BRASS_400 = "#C39A3B";
const LOGO_H = 380;
const LOGO_W = Math.round((LOGO_H * 896) / 1200);
const BRAND_TRACKING = 20;
/** W-T53: the text column's inked area sits lower than its box (the serif's line gap above MAPAE,
 *  no descender under the last line); this lifts it so the drawn content is centred vertically.
 *  Measured with the pixel test in waitlistCard.test.ts. */
const TEXT_NUDGE_Y = -6;
/** logo.png has transparent margins: 88px of 896 on each side (measured from its alpha). The left
 *  one would count as empty space at the row's left edge, so a negative margin takes it out. */
const LOGO_INSET_X = Math.round((88 * LOGO_W) / 896);

/** W-T69: the picture covers the card. Scaled to the card's width (1920x1200 -> 1200x750) and
 *  aligned to the bottom, the picture's 58% line (435 of 750) sits on the card's middle (315). */
export const BG_W = CARD_W;
export const BG_H = Math.round((CARD_W * 1200) / 1920);
export const BG_TOP = CARD_H - BG_H;
/** Veils over the picture (ink-950): across, then down. */
export const VEIL_X = "linear-gradient(to right, rgba(26,21,16,0.55) 0%, rgba(26,21,16,0.3) 45%, rgba(26,21,16,0.78) 100%)";
export const VEIL_Y = "linear-gradient(to bottom, rgba(26,21,16,0.55) 0%, rgba(26,21,16,0.15) 50%, rgba(26,21,16,0.88) 100%)";
export const FRAME_INSET = 14;
const layer = (style: Record<string, unknown>, ...children: unknown[]) => h("div", {position: "absolute", left: 0, top: 0, width: CARD_W, height: CARD_H, ...style}, ...children);

/** W-T69: the picture, the veils and the frame (no text). */
export function cardBackdrop(bg: string): El[] {
    return [
        {type: "img", props: {src: bg, width: BG_W, height: BG_H, style: {position: "absolute", left: 0, top: BG_TOP, width: BG_W, height: BG_H}}},
        layer({backgroundImage: VEIL_X}),
        layer({backgroundImage: VEIL_Y}),
        h("div", {
            position: "absolute",
            left: FRAME_INSET,
            top: FRAME_INSET,
            width: CARD_W - 2 * FRAME_INSET,
            height: CARD_H - 2 * FRAME_INSET,
            border: "1px solid rgba(195,154,59,0.35)",
            borderRadius: 10,
        }),
    ];
}

/** The card element tree (satori takes plain {type, props} objects). With `bg` (a picture data
 *  URI) the picture, the veils and the frame sit under the unchanged content row. */
export function cardElement(position: number, logo: string, bg?: string | null): El {
    const content = contentRow(position, logo, !bg);
    if (!bg) return content;
    return h("div", {width: CARD_W, height: CARD_H, position: "relative", background: INK_950}, ...cardBackdrop(bg), layer({}, content));
}

/** The W-T52 / W-T53 content row: logo and text centred on the card (on ink-950 when it is the
 *  whole card, transparent over the backdrop). */
function contentRow(position: number, logo: string, solid: boolean): El {
    const num = cardNumberText(position);
    const px = cardNumberPx(num);
    return h(
        "div",
        // W-T53: logo + text are one row centred on the card; the text column is as wide as its
        // widest line (so the row's width, and its centre, follow the number's length)
        {width: CARD_W, height: CARD_H, display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 88, ...(solid ? {background: INK_950} : {})},
        {type: "img", props: {src: logo, width: LOGO_W, height: LOGO_H, style: {width: LOGO_W, height: LOGO_H, marginLeft: -LOGO_INSET_X}}},
        h(
            "div",
            {display: "flex", flexDirection: "column", alignItems: "flex-start", maxWidth: CARD_NUMBER_MAX_W, position: "relative", top: TEXT_NUDGE_Y},
            // the letter spacing also follows the last letter; a negative margin takes it out of the width
            h("div", {fontFamily: "Noto Serif KR", fontWeight: 700, fontSize: 60, letterSpacing: BRAND_TRACKING, marginRight: -BRAND_TRACKING, color: HANJI_100, lineHeight: 1.1}, CARD_TEXT.brand),
            h("div", {width: 56, height: 1, background: "rgba(195,154,59,.45)", marginTop: 24, marginBottom: 22}),
            h("div", {fontFamily: "Pretendard", fontWeight: 600, fontSize: 22, letterSpacing: 9.24, color: BRASS_400}, CARD_TEXT.label),
            h(
                "div",
                {display: "flex", alignItems: "baseline", marginTop: 30, fontFamily: "Noto Serif KR", fontWeight: 600, fontSize: px, lineHeight: 1, color: HANJI_100},
                h("span", {fontSize: Math.round(px * HASH_SCALE), color: BRASS_400}, "#"),
                h("span", {}, num),
            ),
            h("div", {fontFamily: "Pretendard", fontWeight: 400, fontSize: 26, color: LINE_COLOR, marginTop: 30}, CARD_TEXT.line),
        ),
    );
}

/** The PNG bytes. Throws when the fonts or the logo cannot be read or the render fails; a missing
 *  backdrop picture only drops the picture (logged). `opts.backdrop: false` draws the plain card
 *  (the centring test measures that one). */
export async function renderCard(position: number, opts: {backdrop?: boolean} = {}): Promise<Uint8Array> {
    const a = await loadAssets();
    const bg = opts.backdrop === false ? null : await loadBackdrop();
    return renderElement(cardElement(position, a.logo, bg), a);
}

/** Renders an element tree with the card fonts (the card, or a check's variant of it). */
export async function renderElement(el: El, a?: Assets): Promise<Uint8Array> {
    a = a ?? (await loadAssets());
    const res = new ImageResponse(el as unknown as React.ReactElement, {
        width: CARD_W,
        height: CARD_H,
        fonts: [
            {name: "Noto Serif KR", data: a.serif600, weight: 600, style: "normal"},
            {name: "Noto Serif KR", data: a.serif700, weight: 700, style: "normal"},
            {name: "Pretendard", data: a.sans400, weight: 400, style: "normal"},
            {name: "Pretendard", data: a.sans600, weight: 600, style: "normal"},
        ],
    });
    // read the whole body here, so a render error throws now and not inside a streamed response
    return new Uint8Array(await res.arrayBuffer());
}
