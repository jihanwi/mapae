// Nickname modal (set or change). Opened from the comments composer and from the header.
// Layout note (390px): same panel pattern as the onboarding modal (w-full, max width, mx-4).
import {createContext, ReactNode, useCallback, useContext, useState} from "react";
import {useAccount} from "wagmi";
import {useCopy} from "../copy";
import {ApiError, useNickname, useSocialActions} from "../hooks/comments";
import {nicknameProblem, normalizeNickname} from "../../api/_lib/social";
import {fmtDateTime} from "../lib/format";
import {PrimaryBtn} from "./ui";

const Ctx = createContext<() => void>(() => {});
export const useNicknameModal = () => useContext(Ctx);

export function NicknameProvider({children}: {children: ReactNode}) {
    const [open, setOpen] = useState(false);
    const show = useCallback(() => setOpen(true), []);
    return (
        <Ctx.Provider value={show}>
            {children}
            {open && <NicknameModal onClose={() => setOpen(false)} />}
        </Ctx.Provider>
    );
}

function NicknameModal({onClose}: {onClose: () => void}) {
    const tr = useCopy();
    const {address} = useAccount();
    const current = useNickname(address);
    const actions = useSocialActions();
    const [value, setValue] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const problem = value.trim() === "" ? null : nicknameProblem(value);

    const save = async () => {
        if (!address || problem || value.trim() === "") return;
        setBusy(true);
        setError(null);
        try {
            await actions.setNickname(address, normalizeNickname(value));
            setSaved(true);
        } catch (e) {
            const code = e instanceof ApiError ? e.code : "unavailable";
            if (code === "nickname_cooldown" && e instanceof ApiError && typeof e.extra.nextAt === "number") {
                setError(tr.nickname.errors.nickname_cooldown(fmtDateTime(e.extra.nextAt, tr.locale)));
            } else {
                const m = tr.nickname.errors as Record<string, unknown>;
                setError(typeof m[code] === "string" ? (m[code] as string) : tr.nickname.errors.unavailable);
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/80" role="dialog" aria-modal="true" onClick={onClose}>
            <div className="w-full max-w-[440px] mx-4 bg-ink-800 border border-ink-700 rounded-card p-5 sm:p-7" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3 mb-2">
                    <h2 className="m-0 text-[19px] font-bold">{tr.nickname.title}</h2>
                    <button onClick={onClose} aria-label={tr.nickname.close} className="text-hanji-400 hover:text-hanji-100 text-[18px] leading-none min-h-[32px] px-1">
                        ✕
                    </button>
                </div>
                {current.data && <p className="m-0 mb-2 text-[13px] text-hanji-100 break-all">{tr.nickname.current(current.data)}</p>}
                <p className="m-0 mb-1 text-[13px] text-hanji-400">{tr.nickname.rules}</p>
                <p className="m-0 mb-4 text-[12px] text-brass-400">{tr.nickname.cooldown}</p>
                <input
                    value={value}
                    onChange={(e) => {
                        setValue(e.target.value);
                        setSaved(false);
                        setError(null);
                    }}
                    maxLength={32}
                    placeholder={tr.nickname.placeholder}
                    className="w-full min-w-0 bg-ink-900 border border-ink-700 rounded-input px-4 py-3 text-[15px] text-hanji-100 outline-none focus:border-brass-400"
                />
                {problem && <p className="m-0 mt-1 text-[12px] text-error">{tr.nickname.problems[problem]}</p>}
                {error && <p className="m-0 mt-2 text-[13px] text-error">{error}</p>}
                {saved && <p className="m-0 mt-2 text-[13px] text-success">{tr.nickname.saved}</p>}
                <PrimaryBtn className="w-full mt-4" disabled={busy || !!problem || value.trim() === "" || !address} onClick={() => void save()}>
                    {busy ? tr.nickname.saving : tr.nickname.save}
                </PrimaryBtn>
            </div>
        </div>
    );
}
