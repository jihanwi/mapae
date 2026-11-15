// Address copy chip: shortened address + "Copy", 2 s "Copied", and the full selectable address when
// the clipboard is missing or fails. Same behavior and copy as the token page's chip.
import {useEffect, useState} from "react";
import {useCopy} from "../copy";
import {shortAddr} from "../lib/format";

export function CopyAddress({address, label}: {address: string; label: string}) {
    const tr = useCopy();
    const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
    useEffect(() => {
        if (state !== "copied") return;
        const id = setTimeout(() => setState("idle"), 2000);
        return () => clearTimeout(id);
    }, [state]);
    const copy = async () => {
        try {
            if (!navigator.clipboard) throw new Error("no clipboard");
            await navigator.clipboard.writeText(address);
            setState("copied");
        } catch (e) {
            console.error("copy failed", e);
            setState("failed");
        }
    };
    if (state === "failed") {
        return <span className="inline-flex items-center min-h-[36px] px-3 rounded-full border border-ink-700 text-[12px] text-hanji-100 tabular-nums break-all select-all">{address}</span>;
    }
    return (
        <button
            type="button"
            aria-label={label}
            onClick={() => void copy()}
            className="inline-flex items-center gap-2 min-h-[36px] px-3 rounded-full border border-ink-700 text-[12px] text-hanji-100 tabular-nums hover:border-brass-600"
        >
            <span>{shortAddr(address)}</span>
            <span className={state === "copied" ? "text-brass-400" : "text-hanji-400"}>{state === "copied" ? tr.tokenPage.copied : tr.tokenPage.copy}</span>
        </button>
    );
}
