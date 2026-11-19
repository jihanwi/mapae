// W-T44: the allocation file of a settled offering (public/allocations/<lowercase address>.json).
// Static paths are case-sensitive, so the address is always lowercased: a checksummed address in the
// URL bar and the lowercase one from the chain read the same file.
export function allocationUrl(offering: string, base: string = import.meta.env.BASE_URL): string {
    return `${base}allocations/${offering.toLowerCase()}.json`;
}

/** How the allocation is computed and rechecked (linked from the offering list and detail). */
export const ALLOC_README = "https://github.com/jihanwi/mapae/blob/main/script/allocation/README.md";
