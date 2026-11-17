// W-T49: the size of the big line number on the joined waitlist screen. Up to three digits it is the
// design size (132px desktop, 104px mobile); from four digits on it shrinks so the whole "#1,234" line
// stays as wide as "#999", and on a phone it is also capped by the screen width (no horizontal
// overflow). The "#" is drawn at 45% of the number's size.

/** Estimated width of one character, in em of the number's font size (serif, tabular figures). */
const DIGIT_EM = 0.62;
const SEPARATOR_EM = 0.32; // "," "." or a space from the locale's grouping
export const HASH_SCALE = 0.45;

/** Width of `#` + `text` in em of the number's font size. */
export function positionWidthEm(text: string): number {
    let em = HASH_SCALE * DIGIT_EM;
    for (const ch of text) em += /\d/.test(ch) ? DIGIT_EM : SEPARATOR_EM;
    return em;
}

const BASE_EM = positionWidthEm("999");

/** 1 for up to three digits, below 1 so a longer number is no wider than "#999". */
export function positionScale(text: string): number {
    return Math.min(1, BASE_EM / positionWidthEm(text));
}

export const POSITION_PX = {desktop: 132, mobile: 104} as const;
/** Horizontal space around the number on a phone (page padding, both sides). */
export const MOBILE_GUTTER_PX = 40;

/** CSS font sizes: desktop in px, mobile as min(px, what fits in 100vw minus the gutter). */
export function positionFontSize(text: string): {desktop: string; mobile: string} {
    const s = positionScale(text);
    const em = positionWidthEm(text);
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
        desktop: `${round(POSITION_PX.desktop * s)}px`,
        mobile: `min(${round(POSITION_PX.mobile * s)}px, calc((100vw - ${MOBILE_GUTTER_PX}px) / ${round(em)}))`,
    };
}
