// Pure request validation for POST /api/meta (no I/O).
import {isAddress} from "viem";
import {MetaLinks} from "./message.js";

export const MAX_DESCRIPTION = 160;
export const MAX_LINK = 200;
export const MAX_IMAGE_BYTES = 400 * 1024;
export const ISSUED_AT_WINDOW_MS = 10 * 60 * 1000;

export const IMAGE_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"} as const;
export type ImageType = keyof typeof IMAGE_TYPES;

/** One line of plain text: control characters (C0, DEL, C1, incl. newlines) removed, trimmed. */
export function sanitizeDescription(s: string): string {
    // eslint-disable-next-line no-control-regex
    return s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
}

export const descriptionLength = (s: string) => [...s].length;

const LINK_HOSTS: Record<keyof MetaLinks, string[] | null> = {
    x: ["x.com", "twitter.com"],
    telegram: ["t.me"],
    website: null,
};

/** "" is allowed (no link). Otherwise https://, at most MAX_LINK chars, no credentials, and for
 *  x / telegram one of the allowed hosts (a leading "www." is accepted). */
export function validLink(kind: keyof MetaLinks, s: string): boolean {
    if (s === "") return true;
    if (s.length > MAX_LINK || !s.startsWith("https://") || /\s/.test(s)) return false;
    let u: URL;
    try {
        u = new URL(s);
    } catch {
        return false;
    }
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return false;
    const hosts = LINK_HOSTS[kind];
    if (!hosts) return true;
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    return hosts.includes(h);
}

/** Image type from the leading magic bytes; undefined for anything else (SVG, GIF, ...). */
export function sniffImageType(b: Uint8Array): ImageType | undefined {
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
    if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
    return undefined;
}

export const isImageType = (t: unknown): t is ImageType => typeof t === "string" && t in IMAGE_TYPES;

/** issuedAt must parse as a date and be within the window of `nowMs` (either side). */
export function issuedAtValid(issuedAt: string, nowMs: number): boolean {
    const t = Date.parse(issuedAt);
    return Number.isFinite(t) && Math.abs(nowMs - t) <= ISSUED_AT_WINDOW_MS;
}

export const isCurveAddress = (s: unknown): s is string => typeof s === "string" && isAddress(s, {strict: false});
