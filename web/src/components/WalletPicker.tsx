// Wallet chooser shown when EIP-6963 discovery finds two or more wallets.
// Layout note (390px): w-full panel with max width and mx-4 gutter; list scrolls inside.
import {Connector} from "wagmi";
import {useCopy} from "../copy";

export function WalletPicker({choices, onChoose, onClose}: {choices: readonly Connector[]; onChoose: (c: Connector) => void; onClose: () => void}) {
    const tr = useCopy();
    return (
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
