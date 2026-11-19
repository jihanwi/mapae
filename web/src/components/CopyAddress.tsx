// Address copy chip: shortened address + "Copy", 2 s "Copied", and the full selectable address when
// the clipboard is missing or fails. Same behavior and copy as the token page's chip.
import {useEffect, useState} from "react";
import {useCopy} from "../copy";
import {shortAddr} from "../lib/format";
import {Icon} from "./ui";

/** `text` replaces the short address inside the button (e.g. "Copy address" where the address is
 *  already shown right above). */
/** `variant="outline"` (token page header): radius-8 bordered button, 44px high, the address in
 *  .num and a copy icon. `variant="plain"` (wallet profile, W-T65): no border, the short address in
 *  .num hanji-100 (or `text`) and a copy icon, for a line of 13px text. The default pill is
 *  unchanged for the other pages. */
export function CopyAddress({address, label, text, variant = "chip"}: {address: string; label: string; text?: string; variant?: "chip" | "outline" | "plain"}) {
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
    if (variant === "outline") {
        if (state === "failed") {
            return <span className="inline-flex items-center min-h-[44px] px-3 rounded-[8px] border border-ink-700 text-[13px] text-hanji-100 num break-all select-all">{address}</span>;
        }
        return (
            <button
                type="button"
                aria-label={label}
                onClick={() => void copy()}
                className="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-[8px] border border-ink-700 text-[13px] text-hanji-100 hover:border-brass-600"
            >
                <span className="num">{shortAddr(address)}</span>
                {state === "copied" ? <span className="text-brass-400">{tr.tokenPage.copied}</span> : <Icon name="copy" className="w-4 h-4 text-hanji-400" />}
            </button>
        );
    }
    if (variant === "plain") {
        if (state === "failed") return <span className="num text-hanji-100 break-all select-all min-w-0">{address}</span>;
        return (
            <button type="button" aria-label={label} onClick={() => void copy()} className="inline-flex items-center gap-1.5 min-h-[36px] text-hanji-100 hover:text-brass-400">
                {text === undefined ? <span className="num">{shortAddr(address)}</span> : <span>{text}</span>}
                {state === "copied" ? <span className="text-brass-400">{tr.tokenPage.copied}</span> : <Icon name="copy" className="w-3.5 h-3.5 text-hanji-400" />}
            </button>
        );
    }
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
            {text === undefined ? (
                <>
                    <span>{shortAddr(address)}</span>
                    <span className={state === "copied" ? "text-brass-400" : "text-hanji-400"}>{state === "copied" ? tr.tokenPage.copied : tr.tokenPage.copy}</span>
                </>
            ) : (
                <span className={state === "copied" ? "text-brass-400" : "text-hanji-100"}>{state === "copied" ? tr.tokenPage.copied : text}</span>
            )}
        </button>
    );
}
