// Browser-only image preparation for curve metadata: centered square crop, 512x512, WebP at 0.85
// (JPEG when the browser can't encode WebP), lowering quality until it fits MAX_IMAGE_BYTES.
import {MAX_IMAGE_BYTES} from "../../api/_lib/validate";

export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const SOURCE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const SIDE = 512;
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];

export type PreparedImage = {bytes: Uint8Array; type: "image/webp" | "image/jpeg"; previewUrl: string};
export type PrepareError = "tooBig" | "badType" | "failed";

/** Center square of a w x h source: [sx, sy, side]. */
export function centerSquare(w: number, h: number): [number, number, number] {
    const side = Math.min(w, h);
    return [Math.floor((w - side) / 2), Math.floor((h - side) / 2), side];
}

function toBlob(canvas: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
    return new Promise((res) => canvas.toBlob(res, type, q));
}

export async function prepareImage(file: File): Promise<PreparedImage | PrepareError> {
    if (!(SOURCE_TYPES as readonly string[]).includes(file.type)) return "badType";
    if (file.size > MAX_SOURCE_BYTES) return "tooBig";
    try {
        const bmp = await createImageBitmap(file);
        const [sx, sy, side] = centerSquare(bmp.width, bmp.height);
        const canvas = document.createElement("canvas");
        canvas.width = SIDE;
        canvas.height = SIDE;
        const ctx = canvas.getContext("2d");
        if (!ctx) return "failed";
        ctx.drawImage(bmp, sx, sy, side, side, 0, 0, SIDE, SIDE);
        bmp.close();
        for (const type of ["image/webp", "image/jpeg"] as const) {
            for (const q of QUALITIES) {
                const blob = await toBlob(canvas, type, q);
                // Some browsers silently fall back to PNG for unsupported types: try the next type.
                if (!blob || blob.type !== type) break;
                if (blob.size <= MAX_IMAGE_BYTES) {
                    return {bytes: new Uint8Array(await blob.arrayBuffer()), type, previewUrl: URL.createObjectURL(blob)};
                }
            }
        }
        return "failed";
    } catch {
        return "failed";
    }
}
