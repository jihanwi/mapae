import {createContext, useCallback, useContext, useState, ReactNode} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {usePublicClient} from "wagmi";
import {explorerTx} from "../config/chain";
import {humanError} from "../lib/errors";
import {copy} from "../copy";
import {PrimaryBtn, SecondaryBtn} from "./ui";

type Toast = {id: number; kind: "pending" | "success" | "error"; text: string; hash?: string};
type Ctx = {
    push: (t: Omit<Toast, "id">) => number;
    update: (id: number, t: Partial<Toast>) => void;
    busyCount: number;
    setBusyCount: (fn: (n: number) => number) => void;
};
const ToastCtx = createContext<Ctx>(null!);

/** 전역 트랜잭션 진행 여부 — 페이지 전체 이중 클릭 가드 */
export function useGlobalTxBusy() {
    return useContext(ToastCtx).busyCount > 0;
}

export function ToastProvider({children}: {children: ReactNode}) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [busyCount, setBusyCount] = useState(0);
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
        <ToastCtx.Provider value={{push, update, busyCount, setBusyCount}}>
            {children}
            <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-[340px]">
                {toasts.map((t) => (
                    <div key={t.id} className="bg-ink-900 border rounded-input px-4 py-3 text-[13px]"
                        style={{borderColor: t.kind === "error" ? "rgba(176,96,79,.5)" : t.kind === "success" ? "rgba(122,155,109,.5)" : "#3A3126"}}>
                        <div className="flex items-center gap-2">
                            {t.kind === "pending" && <span className="w-3 h-3 rounded-full border-2 border-brass-400 border-t-transparent animate-spin flex-none" />}
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

export type TxPhase = "idle" | "wallet" | "confirming";
export type RunFn = (label: string, fn: () => Promise<`0x${string}`>) => Promise<boolean>;

/** 트랜잭션 실행 훅 — 3단계 상태(서명 대기 → 컨펌 대기 → 완료) + 토스트 + 쿼리 무효화 */
export function useTx() {
    const {push, update, setBusyCount} = useContext(ToastCtx);
    const client = usePublicClient();
    const qc = useQueryClient();
    const [busy, setBusy] = useState(false);
    const [phase, setPhase] = useState<TxPhase>("idle");

    const run: RunFn = useCallback(
        async (label, fn) => {
            // H1: 어떤 경로로도 무음 실패 금지. fn은 커넥터 기반
            // writeContractAsync라 wallet client 체크 자체가 불필요 —
            // 영수증 대기용 publicClient만 확인하고, 없으면 안내 토스트.
            if (!client) {
                push({kind: "error", text: copy.tx.notReady});
                return false;
            }
            setBusy(true);
            setBusyCount((n) => n + 1);
            setPhase("wallet"); // ① 지갑 서명 대기
            const id = push({kind: "pending", text: `${label} — ${copy.tx.pendingWallet}`});
            try {
                const hash = await fn();
                setPhase("confirming"); // ② 컨펌 대기
                update(id, {kind: "pending", text: `${label} — ${copy.tx.pendingTx}`, hash});
                const receipt = await client.waitForTransactionReceipt({hash});
                if (receipt.status !== "success") throw new Error("reverted");
                update(id, {kind: "success", text: `${label} — ${copy.tx.success}`, hash}); // ③ 완료 (H3)
                await qc.invalidateQueries();
                return true;
            } catch (e) {
                update(id, {kind: "error", text: humanError(e)}); // ③′ 실패 — 버튼은 finally에서 복원
                return false;
            } finally {
                setPhase("idle");
                setBusy(false);
                setBusyCount((n) => n - 1);
            }
        },
        [client, push, update, qc, setBusyCount]
    );
    return {run, busy, phase};
}

/** 온체인 액션 버튼 — 3단계 라벨 + 전역 이중 클릭 가드 일괄 적용.
 *  action은 run을 받아 필요한 만큼 트랜잭션을 실행한다 (approve→commit 등 복합 가능). */
export function TxButton({
    action,
    variant = "primary",
    disabled,
    className,
    children,
}: {
    action: (run: RunFn) => Promise<unknown>;
    variant?: "primary" | "secondary";
    disabled?: boolean;
    className?: string;
    children: ReactNode;
}) {
    const {run, busy, phase} = useTx();
    const globalBusy = useGlobalTxBusy();
    const label = phase === "wallet" ? copy.tx.pendingWallet : phase === "confirming" ? copy.tx.pendingTx : children;
    const Btn = variant === "primary" ? PrimaryBtn : SecondaryBtn;
    return (
        <Btn className={className} disabled={disabled || busy || globalBusy} onClick={() => void action(run)}>
            {label}
        </Btn>
    );
}
