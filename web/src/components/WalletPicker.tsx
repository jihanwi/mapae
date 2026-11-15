// Wallet chooser shown when EIP-6963 discovery finds two or more wallets.
// Layout note (390px): w-full panel with max width and mx-4 gutter; list scrolls inside.
// Both dialogs render into document.body: the nav header has a backdrop-filter, which makes it the
// containing block of `fixed` children (the dialog was centered on the header and cut off).
import {ReactNode, useState} from "react";
import {createPortal} from "react-dom";
import {Connector} from "wagmi";
import {useCopy} from "../copy";
import {useLocation} from "react-router-dom";
import {SecondaryBtn} from "./ui";
import {API_BASE} from "../hooks/meta";
import {metamaskDappUrl} from "../lib/share";

const toBody = (node: ReactNode) => (typeof document === "undefined" ? node : createPortal(node, document.body));

export function WalletPicker({choices, onChoose, onClose}: {choices: readonly Connector[]; onChoose: (c: Connector) => void; onClose: () => void}) {
    const tr = useCopy();
    return toBody(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80" role="dialog" aria-modal="true" onClick={onClose}>
            <div
                className="w-full max-w-[360px] mx-4 max-h-[80dvh] overflow-y-auto bg-ink-800 border border-ink-700 rounded-card p-5"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3 mb-3">
                    <h2 className="m-0 text-[17px] font-bold">{tr.wallet.chooseTitle}</h2>
                    <button onClick={onClose} aria-label={tr.onboardingV3.close} className="text-hanji-400 hover:text-hanji-100 text-[18px] leading-none min-h-[32px] px-1">
                        ✕
                    </button>
                </div>
                <div className="flex flex-col gap-2">
                    {choices.map((c) => (
                        <button
                            key={c.uid}
                            onClick={() => onChoose(c)}
                            className="flex items-center gap-3 min-h-[48px] px-4 py-2.5 border border-ink-700 rounded-input text-[14px] text-hanji-100 text-left hover:border-brass-600"
                        >
                            {c.icon ? (
                                <img src={c.icon} alt="" className="w-6 h-6 rounded flex-none" />
                            ) : (
                                <span className="w-6 h-6 rounded bg-ink-700 flex-none" />
                            )}
                            <span className="min-w-0 truncate">{c.name}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

/** Mobile browser without a wallet (W-T17): open this page in MetaMask (deep link, same tab so the
 *  OS hands it to the app) or copy the address for another wallet app's browser. */
export function OpenInWalletApp({onClose}: {onClose: () => void}) {
    const tr = useCopy();
    const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
    const href = typeof window !== "undefined" ? window.location.href : "";
    const {pathname} = useLocation();
    const mm = metamaskDappUrl(pathname, API_BASE, typeof window !== "undefined" ? window.location.origin : "");
    const copy = async () => {
        try {
            if (!navigator.clipboard) throw new Error("no clipboard");
            await navigator.clipboard.writeText(href);
            setCopied("copied");
        } catch (e) {
            console.error("copy failed", e);
            setCopied("failed");
        }
    };
    return toBody(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80" role="dialog" aria-modal="true" aria-labelledby="open-in-app-title" onClick={onClose}>
            <div className="w-full max-w-[360px] mx-4 bg-ink-800 border border-ink-700 rounded-card p-5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3 mb-3">
                    <h2 id="open-in-app-title" className="m-0 text-[17px] font-bold">
                        {tr.wallet.openInAppTitle}
                    </h2>
                    <button onClick={onClose} aria-label={tr.onboardingV3.close} className="text-hanji-400 hover:text-hanji-100 text-[18px] leading-none min-h-[32px] px-1">
                        ✕
                    </button>
                </div>
                <p className="m-0 mb-1 text-[13px] text-hanji-400 leading-relaxed">{tr.wallet.openInAppNote}</p>
                <p className="m-0 mb-4 text-[12px] text-hanji-400 leading-relaxed">{tr.wallet.inAppBrowserNote}</p>
                <a
                    href={mm}
                    className="block w-full mb-2 text-center no-underline rounded-input bg-brass-400 text-ink-950 text-[14px] font-bold px-5 py-3 hover:bg-brass-500"
                >
                    {tr.wallet.openInMetaMask}
                </a>
                {copied === "failed" ? (
                    <p className="m-0 text-[12px] text-hanji-100 break-all select-all">{href}</p>
                ) : (
                    <SecondaryBtn className="w-full" onClick={() => void copy()}>
                        {copied === "copied" ? tr.wallet.pageLinkCopied : tr.wallet.copyPageLink}
                    </SecondaryBtn>
                )}
            </div>
        </div>
    );
}
