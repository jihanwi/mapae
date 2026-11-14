// UTF-8 byte length helpers. CurveFactory checks name/symbol by bytes(string).length, so the UI
// counts bytes the same way (Korean syllables are 3 bytes, most emoji 4).
const enc = new TextEncoder();

export function utf8ByteLength(s: string): number {
    return enc.encode(s).length;
}

/** True when 1 <= byte length <= max (the CurveFactory rule for name and symbol). */
export function withinByteLimit(s: string, max: number): boolean {
    const n = utf8ByteLength(s);
    return n >= 1 && n <= max;
}
