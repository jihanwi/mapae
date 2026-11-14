// Signed message for curve metadata. Shared by the browser (what the Dev signs) and the server
// (rebuilt from the request fields and checked against the signature). Keep it a leaf module:
// it is imported by Vercel Functions, so relative imports would need explicit extensions.
import {getAddress} from "viem";

export const META_CHAIN_ID = 91342;
export const NO_IMAGE_SHA = "0x0";

export type MetaLinks = {x: string; telegram: string; website: string};

export type MetaMessageInput = {
    curve: string;
    /** 0x + hex sha256 of the image bytes, or NO_IMAGE_SHA. */
    imageSha256: string;
    description: string;
    links: MetaLinks;
    /** ISO 8601. */
    issuedAt: string;
};

export function buildMetaMessage(m: MetaMessageInput): string {
    return [
        "MAPAE curve metadata",
        `chainId: ${META_CHAIN_ID}`,
        `curve: ${getAddress(m.curve)}`,
        `imageSha256: ${m.imageSha256}`,
        `description: ${m.description}`,
        `x: ${m.links.x}`,
        `telegram: ${m.links.telegram}`,
        `website: ${m.links.website}`,
        `issuedAt: ${m.issuedAt}`,
    ].join("\n");
}

/** 0x-prefixed lowercase hex sha256 (Web Crypto: browser and Node 18+). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
    return "0x" + Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function bytesToBase64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}
