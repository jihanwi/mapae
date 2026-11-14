// Language resolution (pure, testable). Order: ?lang= query → saved choice → browser language.
// A language chosen by the query is also saved (see LangProvider), so it sticks after navigation.
export type Lang = "ko" | "en";
export const LANG_KEY = "mapae.lang";

const isLang = (v: unknown): v is Lang => v === "ko" || v === "en";

/** Valid ?lang= value in a query string ("?a=b&lang=en" or "lang=en"), else undefined. */
export function queryLang(search: string): Lang | undefined {
    const q = new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get("lang");
    return isLang(q) ? q : undefined;
}

export function resolveLang(input: {stored: string | null | undefined; search: string; navigatorLang: string | undefined}): Lang {
    const q = queryLang(input.search);
    if (q) return q;
    if (isLang(input.stored)) return input.stored;
    return (input.navigatorLang ?? "").toLowerCase().startsWith("ko") ? "ko" : "en";
}

/** Query string of the current URL. With the hash router the query may sit inside the hash. */
export function currentSearch(loc: {search: string; hash: string}): string {
    if (loc.search) return loc.search;
    const i = loc.hash.indexOf("?");
    return i >= 0 ? loc.hash.slice(i) : "";
}

export function readStoredLang(): string | null {
    try {
        return window.localStorage.getItem(LANG_KEY);
    } catch {
        return null;
    }
}

export function writeStoredLang(lang: Lang): void {
    try {
        window.localStorage.setItem(LANG_KEY, lang);
    } catch {
        // storage unavailable (private mode / blocked): the choice still applies for this session
    }
}
