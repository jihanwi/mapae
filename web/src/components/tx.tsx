import {createContext, useCallback, useContext, useState, ReactNode} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {usePublicClient, useWalletClient} from "wagmi";
import {explorerTx} from "../config/chain";
import {humanError} from "../lib/errors";
import {copy} from "../copy";

type Toast = {id: number; kind: "pending" | "success" | "error"; text: string; hash?: string};
const ToastCtx = createContext<{push: (t: Omit<Toast, "id">) => number; update: (id: number, t: Partial<Toast>) => void}>(null!);

export function ToastProvider({children}: {children: ReactNode}) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const push = useCallback((t: Omit<Toast, "id">) => {
        const id = Date.now() + Math.random();
        setToasts((s) => [...s, {...t, id}]);
        return id;
    }, []);
    const update = useCallback((id: number, patch: Partial<Toast>) => {
        setToasts((s) => s.map((t) => (t.id === id ? {...t, ...patch} : t)));
        setTimeout(() => setToasts((s) => s.filter((t) => t.id !== id)), 6000);
    }, []);
    return (
        <ToastCtx.Provider value={{push, update}}>
            {children}
            <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-[340px]">
                {toasts.map((t) => (
                    <div key={t.id} className="bg-ink-900 border rounded-input px-4 py-3 text-[13px]"
                        style={{borderColor: t.kind === "error" ? "rgba(176,96,79,.5)" : t.kind === "success" ? "rgba(122,155,109,.5)" : "#3A3126"}}>
                        <div className="flex items-center gap-2">
                            {t.kind === "pending" && <span className="w-3 h-3 rounded-full border-2 border-brass-400 border-t-transparent animate-spin" />}
                            {t.kind === "success" && <span className="text-success">✓</span>}
                            {t.kind === "error" && <span className="text-error">✕</span>}
                            <span className="text-hanji-100">{t.text}</span>
                        </div>
                        {t.hash && (
                            <a href={explorerTx(t.hash)} target="_blank" rel="noreferrer" className="text-brass-400 text-[12px] hover:text-hanji-100">
                                {copy.tx.viewOnChain}
                            </a>
                        )}
                    </div>
                ))}
            </div>
        </ToastCtx.Provider>
    );
}

/** 트랜잭션 실행 훅 — 진행/성공/실패 토스트 + 완료 시 쿼리 무효화 */
export function useTx() {
    const {push, update} = useContext(ToastCtx);
    const {data: wallet} = useWalletClient();
    const client = usePublicClient();
    const qc = useQueryClient();
    const [busy, setBusy] = useState(false);

    const run = useCallback(
        async (label: string, fn: () => Promise<`0x${string}`>) => {
            if (!wallet || !client) return false;
            setBusy(true);
            const id = push({kind: "pending", text: `${label} — ${copy.tx.pending}`});
            try {
                const hash = await fn();
                update(id, {hash});
                const receipt = await client.waitForTransactionReceipt({hash});
                if (receipt.status !== "success") throw new Error("reverted");
                update(id, {kind: "success", text: `${label} ${copy.tx.success}`, hash});
                await qc.invalidateQueries();
                return true;
            } catch (e) {
                update(id, {kind: "error", text: humanError(e)});
                return false;
            } finally {
                setBusy(false);
            }
        },
        [wallet, client, push, update, qc]
    );
    return {run, busy};
}
