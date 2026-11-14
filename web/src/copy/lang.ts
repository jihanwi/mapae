// Language resolution (pure, testable). Order: saved choice → ?lang= query → browser language.
export type Lang = "ko" | "en";
export const LANG_KEY = "mapae.lang";

const isLang = (v: unknown): v is Lang => v === "ko" || v === "en";

export function resolveLang(input: {stored: string | null | undefined; search: string; navigatorLang: string | undefined}): Lang {
    if (isLang(input.stored)) return input.stored;
    const q = new URLSearchParams(input.search.startsWith("?") ? input.search : `?${input.search}`).get("lang");
    if (isLang(q)) return q;
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
