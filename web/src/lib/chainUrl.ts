// URLs of the indexed-data API (/api/chain/*). Every call except summary carries v=<indexedBlock>,
// the "chain data version": when the indexer moves forward the URL changes, so CDN and browser
// caches are skipped without shortening their lifetimes.

/** `/api/chain/{path}?{params}&v={version}`; undefined params and a missing version are left out. */
export function chainUrl(path: string, params: Record<string, string | number | undefined>, version: string | null | undefined): string {
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries(params)) if (val !== undefined) q.set(k, String(val));
    if (version) q.set("v", version);
    const s = q.toString();
    return `/api/chain/${path}${s ? `?${s}` : ""}`;
}
