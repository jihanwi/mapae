// Address helpers. Rule: maps keyed by an address use the lowercase form (addrKey), and every
// comparison lowercases both sides, so a lowercase, uppercase or checksummed URL behaves the same.
import {getAddress, isAddress} from "viem";

type Address = `0x${string}`;

export const addrKey = (a: string) => a.toLowerCase() as Address;
export const sameAddr = (a: string | undefined | null, b: string | undefined | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Route param -> checksummed address, or null when it is not an address (any letter case accepted). */
export function normalizeAddressParam(raw: string | undefined): Address | null {
    if (!raw || !isAddress(raw, {strict: false})) return null;
    return getAddress(raw) as Address;
}
