// Ticker rule (decision 54): A–Z, 0–9 and precomposed Hangul syllables (U+AC00–U+D7A3) only,
// Latin letters upper-cased, at most 10 UTF-8 bytes (the contract's limit). Against look-alike
// impersonation (Cyrillic, full-width and invisible characters). The v3.2 contract does not check
// characters, so tokens launched outside the form can carry any ticker (isStandardTicker false).
import {utf8ByteLength} from "./bytes";

export const TICKER_MAX_BYTES = 10;
const ALLOWED = /^[A-Z0-9가-힣]+$/;

const upperAscii = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase());

/** What the launch form shows while typing: NFKC (full-width Ａ -> A) and a–z -> A–Z. Spaces are
 *  kept so a typed space stays visible (and blocks the launch) instead of vanishing. */
export const displayTicker = (input: string): string => upperAscii(input.normalize("NFKC"));

/** The ticker as submitted: NFKC, trimmed, a–z -> A–Z. */
export const normalizeTicker = (input: string): string => upperAscii(input.normalize("NFKC").trim());

/** Only A–Z, 0–9 and Hangul syllables (no length check). */
export const tickerCharsOk = (s: string): boolean => ALLOWED.test(s);

/** True when `symbol` is already in normal form and follows the rule (1–10 UTF-8 bytes). */
export function isStandardTicker(symbol: string): boolean {
    const n = utf8ByteLength(symbol);
    return normalizeTicker(symbol) === symbol && tickerCharsOk(symbol) && n >= 1 && n <= TICKER_MAX_BYTES;
}

/** Comparison key for "same ticker": NFKC, trimmed, case folded. */
export const tickerKey = (s: string): string => s.normalize("NFKC").trim().toUpperCase();

/** Tokens in `list` whose ticker matches `symbol` (tickerKey), leaving out `exceptCurve`. */
export function sameTickerCount(symbol: string, list: readonly {curve: string; symbol: string}[], exceptCurve?: string): number {
    const k = tickerKey(symbol);
    if (k === "") return 0;
    const except = exceptCurve?.toLowerCase();
    return list.filter((r) => r.curve.toLowerCase() !== except && tickerKey(r.symbol) === k).length;
}
