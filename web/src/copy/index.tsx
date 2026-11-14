// i18n entry. LangProvider holds the current language in React state (no module-global language);
// useCopy() returns the dictionary for it. Legacy v2 pages keep `import {copy}` (Korean only).
import {createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState} from "react";
import {ko, Copy} from "./ko";
import {en} from "./en";
import {currentSearch, Lang, readStoredLang, resolveLang, writeStoredLang} from "./lang";

export type {Copy} from "./ko";
export type {Lang} from "./lang";

/** Korean dictionary for the legacy v2 section (Korean only). v3 screens use useCopy(). */
export const copy = ko;

export const dictionaries: Record<Lang, Copy> = {ko, en};

type Ctx = {lang: Lang; setLang: (l: Lang) => void};
const LangCtx = createContext<Ctx>({lang: "ko", setLang: () => {}});

function initialLang(): Lang {
    if (typeof window === "undefined") return "ko";
    return resolveLang({stored: readStoredLang(), search: currentSearch(window.location), navigatorLang: window.navigator?.language});
}

export function LangProvider({children}: {children: ReactNode}) {
    const [lang, setLangState] = useState<Lang>(initialLang);
    const setLang = useCallback((l: Lang) => {
        writeStoredLang(l);
        setLangState(l);
    }, []);
    useEffect(() => {
        document.documentElement.lang = lang;
    }, [lang]);
    const value = useMemo(() => ({lang, setLang}), [lang, setLang]);
    return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
    return useContext(LangCtx);
}

export function useCopy(): Copy {
    return dictionaries[useContext(LangCtx).lang];
}
