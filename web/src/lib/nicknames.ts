// Bulk nickname lookup helpers (pure).
import {shortAddr} from "./format";

/** Lowercase, deduped, sorted: the same set of addresses always gives the same key. */
export const nicknameKey = (addresses: readonly string[]): string[] => [...new Set(addresses.map((a) => a.toLowerCase()))].sort();

/** Groups of at most 100 (the API limit). */
export function chunk100<T>(list: readonly T[]): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += 100) out.push(list.slice(i, i + 100));
    return out;
}

/** The nickname when there is one, else the short address. */
export const displayName = (nickname: string | null | undefined, address: string): string => (nickname ? nickname : shortAddr(address));
