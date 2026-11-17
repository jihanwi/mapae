// KO / EN toggle shared by the app header and the waitlist shell (W-T45: moved out of App.tsx so the
// waitlist-only build does not load the app).
import {useCopy, useLang} from "../copy";

/** KO / EN text toggle: current language in brass-400, the other in hanji-400, no solid background. */
export function LangToggle() {
    const tr = useCopy();
    const {lang, setLang} = useLang();
    const item = (l: "ko" | "en") => (
        <button
            onClick={() => setLang(l)}
            aria-pressed={lang === l}
            className={`min-h-[44px] px-1 text-[13px] ${lang === l ? "text-brass-400 font-semibold" : "text-hanji-400 hover:text-hanji-100"}`}
        >
            {l === "ko" ? tr.lang.ko : tr.lang.en}
        </button>
    );
    return (
        <div className="flex items-center flex-none" role="group" aria-label={tr.lang.label}>
            {item("ko")}
            <span className="text-ink-700 text-[13px] px-0.5">/</span>
            {item("en")}
        </div>
    );
}
