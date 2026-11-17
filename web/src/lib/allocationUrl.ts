// W-T44: the allocation file of a settled offering (public/allocations/<lowercase address>.json).
// Static paths are case-sensitive, so the address is always lowercased: a checksummed address in the
// URL bar and the lowercase one from the chain read the same file.
export function allocationUrl(offering: string, base: string = import.meta.env.BASE_URL): string {
    return `${base}allocations/${offering.toLowerCase()}.json`;
}
