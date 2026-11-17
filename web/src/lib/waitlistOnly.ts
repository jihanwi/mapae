// W-T45: "waitlist only" hosts (VITE_WAITLIST_ONLY_HOSTS, comma-separated, set at build time). On
// such a host the router holds only /waitlist and /privacy and every other path goes to /waitlist;
// the testnet app is not even downloaded. An empty or missing list hides nothing.

/** Lowercased, trimmed, non-empty entries. */
export function parseHosts(raw: string | undefined | null): string[] {
    return (raw ?? "")
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h.length > 0);
}

/** True when `host` (window.location.host, which carries a port only when it is not the default)
 *  is in the list: an exact match, or the same name without the port when the entry has none. */
export function isWaitlistOnlyHost(host: string, raw: string | undefined | null): boolean {
    const list = parseHosts(raw);
    if (list.length === 0) return false;
    const h = host.trim().toLowerCase();
    if (!h) return false;
    const name = h.replace(/:\d+$/, "");
    return list.some((e) => e === h || (!/:\d+$/.test(e) && e === name));
}

/** Where a path on a waitlist-only host is sent: /waitlist with ref and lang kept (nothing else). */
export function waitlistTarget(search: string): string {
    const from = new URLSearchParams(search);
    const to = new URLSearchParams();
    for (const k of ["ref", "lang"]) {
        const v = from.get(k);
        if (v) to.set(k, v);
    }
    const q = to.toString();
    return q ? `/waitlist?${q}` : "/waitlist";
}

/** This page's mode, read once at start (the host does not change without a reload). */
export const WAITLIST_ONLY: boolean =
    typeof window !== "undefined" && isWaitlistOnlyHost(window.location.host, import.meta.env.VITE_WAITLIST_ONLY_HOSTS as string | undefined);
